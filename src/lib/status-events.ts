/* ==========================================================================
   Status-page events — the decidable half.

   Everything here is pure so it can be tested: this repo's vitest runs in a
   node environment and collects only `.test.ts` files under src, deliberately
   (see vitest.config.ts). Components stay thin wiring over these functions.

   Wire vocabulary is copied from faas/api/openapi.yaml, not inferred. The
   create body is a discriminated union there — `AdminStatusIncidentCreateRequest`
   and `AdminStatusMaintenanceCreateRequest`, both `additionalProperties: false`
   — so the two kinds genuinely accept different fields and a stray one is a
   400, not an ignored key. `toCreateRequest` is where that split is enforced.
   ========================================================================== */

export type StatusEventKind = 'incident' | 'maintenance';

export type StatusComponent =
  | 'api_console'
  | 'deployments'
  | 'app_execution'
  | 'networking'
  | 'observability';

/** What an incident may claim. `maintenance` is not among them — it belongs to the other kind. */
export type IncidentImpact = 'degraded' | 'partial_outage' | 'major_outage';

/** Lifecycle states an event may be *created* in; terminal states are not valid at creation. */
export type IncidentOpenState = 'investigating' | 'identified' | 'monitoring';

export type StatusState =
  | IncidentOpenState
  | 'resolved'
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

/** API ceilings, mirrored so a message is refused here rather than at the wire. */
const TITLE_MAX = 160;
const MESSAGE_MAX = 1024;

/** The states that close an event. There is no separate close action — the API has none. */
const TERMINAL: readonly StatusState[] = ['resolved', 'completed', 'cancelled'];

export function isTerminalState(state: StatusState): boolean {
  return TERMINAL.includes(state);
}

export function defaultStateFor(kind: StatusEventKind): StatusState {
  return kind === 'incident' ? 'investigating' : 'scheduled';
}

export interface StatusDraft {
  kind: StatusEventKind;
  title: string;
  components: StatusComponent[];
  message: string;
  /** Required for an incident; ignored for maintenance, whose impact is fixed. */
  impact?: IncidentImpact;
  state?: StatusState;
  /** Local datetime strings from `<input type="datetime-local">`. */
  scheduledStartAt?: string;
  scheduledEndAt?: string;
}

export type DraftErrors = Partial<
  Record<'title' | 'components' | 'message' | 'impact' | 'scheduledStartAt' | 'scheduledEndAt', string>
>;

export function emptyDraft(kind: StatusEventKind): StatusDraft {
  return { kind, title: '', components: [], message: '', state: defaultStateFor(kind) };
}

export function validateDraft(draft: StatusDraft): DraftErrors {
  const errors: DraftErrors = {};
  const title = draft.title.trim();
  const message = draft.message.trim();

  if (!title) errors.title = 'A title is required.';
  else if (title.length > TITLE_MAX) errors.title = `Titles are at most ${TITLE_MAX} characters.`;

  if (draft.components.length === 0) errors.components = 'Select at least one affected component.';

  if (!message) errors.message = 'A message is required.';
  else if (message.length > MESSAGE_MAX)
    errors.message = `Messages are at most ${MESSAGE_MAX} characters.`;

  if (draft.kind === 'incident') {
    // Required upstream. Catching it here keeps the failure in the form rather
    // than in a 400 at the moment of publishing.
    if (!draft.impact) errors.impact = 'Choose the impact this incident has.';
  } else {
    // Both ends are required upstream: a window with no end is not a window.
    if (!draft.scheduledStartAt) errors.scheduledStartAt = 'Maintenance needs a start time.';
    if (!draft.scheduledEndAt) errors.scheduledEndAt = 'Maintenance needs an end time.';
    if (
      draft.scheduledStartAt &&
      draft.scheduledEndAt &&
      new Date(draft.scheduledEndAt).getTime() <= new Date(draft.scheduledStartAt).getTime()
    ) {
      errors.scheduledEndAt = 'The window must end after it starts.';
    }
  }

  return errors;
}

export type CreateStatusEventBody =
  | {
      kind: 'incident';
      title: string;
      impact: IncidentImpact;
      components: StatusComponent[];
      state?: IncidentOpenState;
      message: string;
    }
  | {
      kind: 'maintenance';
      title: string;
      components: StatusComponent[];
      scheduled_start_at: string;
      scheduled_end_at: string;
      state?: 'scheduled';
      message: string;
    };

/**
 * The wire body for a validated draft.
 *
 * Built per kind rather than by spreading the draft: the two create schemas are
 * `additionalProperties: false`, so carrying a scheduled window onto an incident
 * — which happens the moment someone switches kind mid-compose — is a 400 and
 * not a harmless extra key.
 *
 * Call only on a draft that `validateDraft` accepts; the non-null assertions
 * below are that precondition.
 */
export function toCreateRequest(draft: StatusDraft): CreateStatusEventBody {
  const title = draft.title.trim();
  const message = draft.message.trim();

  if (draft.kind === 'maintenance') {
    return {
      kind: 'maintenance',
      title,
      components: draft.components,
      scheduled_start_at: new Date(draft.scheduledStartAt!).toISOString(),
      scheduled_end_at: new Date(draft.scheduledEndAt!).toISOString(),
      state: 'scheduled',
      message,
    };
  }

  return {
    kind: 'incident',
    title,
    impact: draft.impact!,
    components: draft.components,
    state: (draft.state ?? 'investigating') as IncidentOpenState,
    message,
  };
}

/**
 * Component ids as customers read them.
 *
 * Names come from `GET /v1/status` — the same response the public page renders
 * — rather than a second copy of the labels living here. An id with no match
 * falls back to itself: that endpoint can be unavailable exactly when an
 * operator needs to publish, and a blank component list would be worse than a
 * raw id.
 */
export function resolveComponentNames(
  ids: readonly string[],
  components: readonly { id: string; name: string }[],
): string[] {
  return ids.map((id) => components.find((c) => c.id === id)?.name ?? id);
}
