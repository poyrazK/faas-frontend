/* ==========================================================================
   Status page authoring — the decidable half, kept pure for node tests.

   Rules mirror faas origin/main pkg/publicstatus/model.go (ValidateEvent,
   ValidateMessage, ValidateTitle, ValidateAttribution, ValidateTransition)
   and the bucketing in pkg/apid/apidserver/status.go. The preview mirrors
   faas-web src/components/status/status-page.tsx — wording, component names,
   UTC timestamps — so it reads the way gregale.dev/status will.
   ========================================================================== */

import type {
  AdminStatusEventCreateRequest,
  AdminStatusEventUpdateRequest,
  IncidentImpact,
  PublicStatusEvent,
  StatusComponent,
  StatusEventKind,
  StatusImpact,
  StatusLifecycle,
} from './status';

export const TITLE_MAX = 160;
export const MESSAGE_MAX = 1024;

/** apid's publicStatusComponentNames, also faas-web's componentLabels. */
export const STATUS_COMPONENTS: readonly { id: StatusComponent; name: string }[] = [
  { id: 'api_console', name: 'API & Console' },
  { id: 'deployments', name: 'Deployments' },
  { id: 'app_execution', name: 'App execution' },
  { id: 'networking', name: 'Networking' },
  { id: 'observability', name: 'Observability' },
];

/** faas-web stateLabels. */
export const IMPACT_LABELS: Record<StatusImpact, string> = {
  operational: 'Operational',
  maintenance: 'Maintenance',
  degraded: 'Degraded performance',
  partial_outage: 'Partial outage',
  major_outage: 'Major outage',
  unknown: 'Unknown',
};

export const INCIDENT_IMPACTS: readonly IncidentImpact[] = ['degraded', 'partial_outage', 'major_outage'];
export const INCIDENT_OPEN_STATES: readonly StatusLifecycle[] = ['investigating', 'identified', 'monitoring'];
const TERMINAL: readonly StatusLifecycle[] = ['resolved', 'completed', 'cancelled'];

export const PUBLIC_STATUS_URL = 'https://gregale.dev/status';

/** The page customers read for one event (faas-web route /status/incidents/$id). */
export const statusPermalink = (publicId: string) => `${PUBLIC_STATUS_URL}/incidents/${encodeURIComponent(publicId)}`;

export function isTerminalState(state: StatusLifecycle): boolean {
  return TERMINAL.includes(state);
}

export function defaultStateFor(kind: StatusEventKind): StatusLifecycle {
  return kind === 'incident' ? 'investigating' : 'scheduled';
}

/** faas-web humanize: "partial_outage" → "Partial outage". */
export function humanizeState(value: string): string {
  return value.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

/** faas-web formatDateTime: medium date, short time, always UTC. */
export function formatPublicDateTime(iso: string): string {
  return (
    new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(iso)) +
    ' UTC'
  );
}

export function componentNames(ids: readonly string[], live: readonly { id: string; name: string }[] = []): string[] {
  return ids.map(
    (id) => live.find((component) => component.id === id)?.name ?? STATUS_COMPONENTS.find((component) => component.id === id)?.name ?? id,
  );
}

/** Code points, as Go's utf8.RuneCountInString counts them. */
const runes = (value: string) => [...value].length;

/**
 * The states an event may move to from `from` (ValidateTransition). Staying
 * in a non-terminal state is allowed: it posts a progress update.
 */
export function nextStates(kind: StatusEventKind, from: StatusLifecycle): StatusLifecycle[] {
  if (isTerminalState(from)) return [];
  if (kind === 'incident') return INCIDENT_OPEN_STATES.includes(from) ? [...INCIDENT_OPEN_STATES, 'resolved'] : [];
  if (from === 'scheduled') return ['scheduled', 'in_progress', 'cancelled'];
  if (from === 'in_progress') return ['in_progress', 'completed'];
  return [];
}

export function titleError(title: string): string | undefined {
  const trimmed = title.trim();
  if (!trimmed) return 'A title is required.';
  if (runes(trimmed) > TITLE_MAX) return `Titles are at most ${TITLE_MAX} characters.`;
  return undefined;
}

export function messageError(message: string): string | undefined {
  const trimmed = message.trim();
  if (!trimmed) return 'A message is required.';
  if (runes(trimmed) > MESSAGE_MAX) return `Messages are at most ${MESSAGE_MAX} characters.`;
  return undefined;
}

/* ─────────────────────────────── Create ───────────────────────────────── */

export interface StatusDraft {
  kind: StatusEventKind;
  title: string;
  components: StatusComponent[];
  message: string;
  state: StatusLifecycle;
  /** Incidents only; required before publishing. */
  impact?: IncidentImpact;
  /** Incidents only, optional backdate. Local datetime from <input type="datetime-local">. */
  startsAt?: string;
  /** Maintenance only, local datetimes. */
  scheduledStartAt?: string;
  scheduledEndAt?: string;
}

export type DraftErrors = Partial<
  Record<'title' | 'components' | 'message' | 'impact' | 'state' | 'startsAt' | 'scheduledStartAt' | 'scheduledEndAt', string>
>;

export function emptyDraft(kind: StatusEventKind): StatusDraft {
  return { kind, title: '', components: [], message: '', state: defaultStateFor(kind) };
}

/** Switching kind keeps the shared text and drops what the other kind may not send. */
export function switchDraftKind(draft: StatusDraft, kind: StatusEventKind): StatusDraft {
  return { ...emptyDraft(kind), title: draft.title, components: draft.components, message: draft.message };
}

const parseLocal = (value?: string) => (value ? Date.parse(value) : NaN);

function componentsError(components: readonly string[]): string | undefined {
  if (components.length === 0) return 'Select at least one affected component.';
  if (new Set(components).size !== components.length) return 'A component is listed twice.';
  if (components.some((id) => !STATUS_COMPONENTS.some((component) => component.id === id))) return 'Unknown component.';
  return undefined;
}

export function validateDraft(draft: StatusDraft, now: Date = new Date()): DraftErrors {
  const errors: DraftErrors = {};
  const title = titleError(draft.title);
  if (title) errors.title = title;
  const components = componentsError(draft.components);
  if (components) errors.components = components;
  const message = messageError(draft.message);
  if (message) errors.message = message;

  if (draft.kind === 'incident') {
    if (!draft.impact || !INCIDENT_IMPACTS.includes(draft.impact)) errors.impact = 'Choose the impact this incident has.';
    if (!INCIDENT_OPEN_STATES.includes(draft.state)) errors.state = 'A new incident is investigating, identified or monitoring.';
    if (draft.startsAt) {
      const startsAt = parseLocal(draft.startsAt);
      if (!Number.isFinite(startsAt)) errors.startsAt = 'Enter a valid start time.';
      else if (startsAt > now.getTime()) errors.startsAt = 'An incident cannot start in the future.';
    }
  } else {
    if (draft.state !== 'scheduled') errors.state = 'New maintenance is scheduled.';
    const start = parseLocal(draft.scheduledStartAt);
    const end = parseLocal(draft.scheduledEndAt);
    if (!Number.isFinite(start)) errors.scheduledStartAt = 'Maintenance needs a start time.';
    if (!Number.isFinite(end)) errors.scheduledEndAt = 'Maintenance needs an end time.';
    if (Number.isFinite(start) && Number.isFinite(end) && end <= start) errors.scheduledEndAt = 'The window must end after it starts.';
  }
  return errors;
}

const iso = (local: string) => new Date(local).toISOString().replace('.000Z', 'Z');

/**
 * The wire body for a draft validateDraft accepts. Built per kind: apid
 * refuses an incident with a schedule and maintenance with starts_at.
 */
export function toCreateRequest(draft: StatusDraft): AdminStatusEventCreateRequest {
  const base = { title: draft.title.trim(), components: [...draft.components], message: draft.message.trim() };
  if (draft.kind === 'maintenance') {
    return {
      kind: 'maintenance',
      ...base,
      impact: 'maintenance',
      state: 'scheduled',
      scheduled_start_at: iso(draft.scheduledStartAt!),
      scheduled_end_at: iso(draft.scheduledEndAt!),
    };
  }
  return {
    kind: 'incident',
    ...base,
    impact: draft.impact!,
    state: draft.state,
    ...(draft.startsAt ? { starts_at: iso(draft.startsAt) } : {}),
  };
}

/* ─────────────────────────────── Update ───────────────────────────────── */

export interface UpdateDraft {
  state: StatusLifecycle;
  message: string;
  impact: StatusImpact;
  components: StatusComponent[];
}

export function updateDraftFor(event: PublicStatusEvent): UpdateDraft {
  const states = nextStates(event.kind, event.state);
  return {
    state: states.includes(event.state) ? event.state : (states[0] ?? event.state),
    message: '',
    impact: event.impact,
    components: [...event.components],
  };
}

export type UpdateErrors = Partial<Record<'state' | 'message' | 'impact' | 'components', string>>;

export function validateUpdate(event: PublicStatusEvent, draft: UpdateDraft): UpdateErrors {
  const errors: UpdateErrors = {};
  if (isTerminalState(event.state)) errors.state = 'This event is closed; closed events cannot be updated.';
  else if (!nextStates(event.kind, event.state).includes(draft.state)) {
    errors.state = `Cannot move ${event.kind} from ${humanizeState(event.state)} to ${humanizeState(draft.state)}.`;
  }
  const message = messageError(draft.message);
  if (message) errors.message = message;
  const components = componentsError(draft.components);
  if (components) errors.components = components;
  if (event.kind === 'incident' && !INCIDENT_IMPACTS.includes(draft.impact as IncidentImpact)) {
    errors.impact = 'Incident impact is degraded, partial outage or major outage.';
  }
  if (event.kind === 'maintenance' && draft.impact !== 'maintenance') errors.impact = 'Maintenance impact stays maintenance.';
  return errors;
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((item) => b.includes(item));

/** Sends impact and components only when they change; an empty list is never sent. */
export function toUpdateRequest(event: PublicStatusEvent, draft: UpdateDraft): AdminStatusEventUpdateRequest {
  const body: AdminStatusEventUpdateRequest = { state: draft.state, message: draft.message.trim() };
  if (draft.impact !== event.impact) body.impact = draft.impact;
  if (draft.components.length && !sameSet(draft.components, event.components)) body.components = [...draft.components];
  return body;
}

/* ─────────────────────────────── Preview ──────────────────────────────── */

export const PREVIEW_ID = 'preview';

/** The event apid will return for a create body, as far as it is knowable. */
export function previewCreated(body: AdminStatusEventCreateRequest, now: Date = new Date()): PublicStatusEvent {
  const at = now.toISOString();
  return {
    id: PREVIEW_ID,
    kind: body.kind,
    title: body.title.trim(),
    impact: body.impact,
    components: [...body.components],
    state: body.state,
    ...(body.kind === 'incident' ? { starts_at: body.starts_at ?? at } : {}),
    ...(body.scheduled_start_at ? { scheduled_start_at: body.scheduled_start_at } : {}),
    ...(body.scheduled_end_at ? { scheduled_end_at: body.scheduled_end_at } : {}),
    updated_at: at,
    updates: [{ id: PREVIEW_ID, state: body.state, message: body.message, posted_at: at }],
  };
}

/** The event after an appended update (AppendPublicStatusUpdate). */
export function previewUpdated(event: PublicStatusEvent, body: AdminStatusEventUpdateRequest, now: Date = new Date()): PublicStatusEvent {
  const at = new Date(Math.max(now.getTime(), Date.parse(event.updated_at) || 0)).toISOString();
  const closing = isTerminalState(body.state);
  return {
    ...event,
    state: body.state,
    impact: body.impact ?? event.impact,
    components: body.components ? [...body.components] : event.components,
    updated_at: at,
    ...(closing ? { resolved_at: at } : {}),
    updates: [
      ...event.updates,
      {
        id: PREVIEW_ID,
        state: body.state,
        message: body.message,
        posted_at: at,
        ...(body.impact ? { impact: body.impact } : {}),
        ...(body.components ? { components: body.components } : {}),
      },
    ],
  };
}

export const previewTitle = (event: PublicStatusEvent, title: string): PublicStatusEvent => ({ ...event, title: title.trim() });

export const previewMessageEdit = (event: PublicStatusEvent, updateId: string, message: string): PublicStatusEvent => ({
  ...event,
  updates: event.updates.map((update) => (update.id === updateId ? { ...update, message: message.trim() } : update)),
});

/** Where the overview page lists the event (status.go publicStatusOverviewHandler). */
export type PublicPlacement = 'active' | 'upcoming' | 'history' | 'permalink';

export function publicPlacement(event: PublicStatusEvent, now: Date = new Date()): PublicPlacement {
  const t = now.getTime();
  if (event.kind === 'incident' && !event.resolved_at) return 'active';
  if (event.kind === 'maintenance' && event.state === 'in_progress') return 'active';
  if (event.kind === 'maintenance' && event.state === 'scheduled' && event.scheduled_start_at) {
    const start = Date.parse(event.scheduled_start_at);
    if (start >= t && start < t + 30 * 24 * 3600 * 1000) return 'upcoming';
  }
  if (event.kind === 'incident' && event.resolved_at && Date.parse(event.resolved_at) > t - 90 * 24 * 3600 * 1000) return 'history';
  return 'permalink';
}

export function placementText(event: PublicStatusEvent, now: Date = new Date()): string {
  const components = componentNames(event.components).join(', ');
  switch (publicPlacement(event, now)) {
    case 'active':
      return `Listed under "Active incidents and maintenance". While it stays open, ${components} show at least ${IMPACT_LABELS[event.impact] ?? event.impact} on the public page.`;
    case 'upcoming':
      return 'Listed under "Upcoming maintenance" until it starts.';
    case 'history':
      return 'Listed in incident history without its message (the history card is compact); the full timeline is on its permalink.';
    default:
      return 'Not listed on the overview (outside the 30-day maintenance or 90-day history window); reachable only by its permalink.';
  }
}

/** The overview card (faas-web EventCard): what goes where, in the public wording. */
export interface PublicCard {
  kindLabel: string;
  when: string;
  title: string;
  /** Hidden on the compact history card. */
  message?: string;
  stateLabel: string;
  components: string;
}

export function publicCard(event: PublicStatusEvent, live: readonly { id: string; name: string }[] = []): PublicCard {
  const latest = event.updates[event.updates.length - 1];
  const when = event.scheduled_start_at ?? event.starts_at ?? event.updated_at;
  return {
    kindLabel: event.kind === 'incident' ? 'Incident' : 'Maintenance',
    when: formatPublicDateTime(when),
    title: event.title,
    message: latest?.message,
    stateLabel: humanizeState(event.state),
    components: componentNames(event.components, live).join(', '),
  };
}

/** The permalink timeline, oldest first like faas-web IncidentDetail. */
export function publicTimeline(event: PublicStatusEvent): { id: string; state: string; when: string; message: string }[] {
  return [...event.updates]
    .sort((a, b) => Date.parse(a.posted_at) - Date.parse(b.posted_at))
    .map((update) => ({ id: update.id, state: humanizeState(update.state), when: formatPublicDateTime(update.posted_at), message: update.message }));
}
