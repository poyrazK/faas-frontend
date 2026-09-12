/* ==========================================================================
   Status-page events — the decidable half.

   Everything here is pure so it can be tested: this repo's vitest runs in a
   node environment and collects only `.test.ts` files under src, deliberately
   (see vitest.config.ts). Components stay thin wiring over these functions.

   Wire vocabulary is copied from faas/api/openapi.yaml (PR #1864), not
   inferred.
   ========================================================================== */

export type StatusEventKind = 'incident' | 'maintenance';

export type StatusComponent =
  | 'api_console'
  | 'deployments'
  | 'app_execution'
  | 'networking'
  | 'observability';

export type StatusImpact = 'maintenance' | 'degraded' | 'partial_outage' | 'major_outage';

export type StatusState =
  | 'investigating'
  | 'identified'
  | 'monitoring'
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
  impact?: StatusImpact;
  state?: StatusState;
  /** Local datetime strings from `<input type="datetime-local">`. */
  scheduledStartAt?: string;
  scheduledEndAt?: string;
}

export type DraftErrors = Partial<
  Record<'title' | 'components' | 'message' | 'scheduledStartAt', string>
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

  // Ours, not the API's: `scheduled_start_at` is optional upstream, but
  // scheduling maintenance without saying when is not useful to a reader.
  if (draft.kind === 'maintenance' && !draft.scheduledStartAt)
    errors.scheduledStartAt = 'Scheduled maintenance needs a start time.';

  return errors;
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
