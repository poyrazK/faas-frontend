# Status-page authoring in the operations console

**Date:** 2026-09-12
**Repos touched:** `poyrazK/faas-frontend` (this one)
**Depends on:** `poyrazK/faas#1864` — unmerged at time of writing

## Problem

The public status page at `gregale.dev/status` (`poyrazK/faas-web#69`) has no operator
surface. To publish an incident or schedule a maintenance window today there is nothing to
click: the page renders whatever the API returns, and nothing in the operations console
writes to it.

Nothing on the status page is hardcoded — that was the initial suspicion and it is wrong.
The public page already reads every figure from `GET /v1/status`. What is missing is the
authoring surface.

## What already exists

`faas#1864` ships the whole status platform, public **and** operator:

| Endpoint | Purpose |
|---|---|
| `GET /v1/status` | public snapshot — components, indicators, active events, history |
| `GET /v1/status/incidents/{public_id}` | one public event with its update timeline |
| `GET /v1/admin/status/incidents` | operator list |
| `POST /v1/admin/status/incidents` | publish an incident or schedule maintenance |
| `POST /v1/admin/status/incidents/{public_id}/updates` | append a lifecycle update |

So the backend is not the gap. This spec covers only the operator UI.

### What is authorable, and what is not

| On the public page | Source |
|---|---|
| Incidents, maintenance, lifecycle updates | **operator-authored**, via the admin endpoints |
| Component status, 30-day uptime, telemetry coverage | computed from platform telemetry |
| SLO indicators | computed |

An operator writes *events*; the platform computes *health*. This spec does not add a way
to hand-edit component health, and should not: a status page that lets an operator assert
"networking is fine" over the telemetry saying otherwise is worse than one that cannot.

## Decisions taken before design

1. **Build against `#1864`'s contract now**, rather than waiting for it to merge. The
   schemas are settled enough to code against, and this lets all three repos land together.
2. **A new top-level "Status Page" section**, not a tab inside Incident Center. That page
   already means internal telemetry — anomalies, builder heartbeats, wake latencies. Publishing
   to customers is a different act with a different audience and a different blast radius, and
   overloading one word for both in a single sidebar invites the wrong click during an incident.
3. **Preview before publish**, showing what customers will read.

## Architecture

### Route

`/operations/status`, one page, with its own nav entry beside Incident Center.

One screen holds the whole job: what is currently published, a composer for a new event, and
an inline way to append an update to anything still open. During an outage the operator does
not navigate.

### Client (`src/lib/api.ts`)

Extends the existing hand-written client — the file's own header names
`faas/api/openapi.yaml` as the contract source of truth, and every shape below is copied from
`#1864`'s OpenAPI rather than inferred. No codegen: introducing `openapi-typescript` here
would be a separate decision against an established convention.

Added to the `/v1/admin/*` section:

```ts
export type StatusEventKind = 'incident' | 'maintenance';
export type StatusComponent =
  | 'api_console' | 'deployments' | 'app_execution' | 'networking' | 'observability';
export type StatusImpact = 'maintenance' | 'degraded' | 'partial_outage' | 'major_outage';
export type StatusState =
  | 'investigating' | 'identified' | 'monitoring' | 'resolved'
  | 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

listAdminStatusEvents(): Promise<AdminStatusEvent[]>
createAdminStatusEvent(input: CreateStatusEventInput): Promise<AdminStatusEvent>
appendAdminStatusUpdate(publicId: string, input: { state: StatusState; message: string }): Promise<AdminStatusEvent>
getPublicStatus(): Promise<PublicStatusOverview>   // read-only, for component display names
```

Auth rides the existing model: same-origin through the Vercel rewrite, `faas_sid` cookie,
`credentials: 'include'`. No new auth work.

### Components

| Component | Responsibility |
|---|---|
| `StatusEventList` | what is published now — active, scheduled, recently resolved |
| `StatusEventComposer` | the create form; owns validation, hands a valid draft upward |
| `StatusEventPreview` | renders a draft as customers will read it |
| `StatusUpdateForm` | append one lifecycle update to an open event |

Each is presentational over data passed in, so each can be tested without a network.

## Data flow

**Listing.** `useAsync(listAdminStatusEvents)` on mount, wrapped in the existing
`AsyncBoundary` so loading, error and empty states come from the shared primitives rather
than a fourth hand-rolled spinner.

**Publishing.** Composer → preview → confirm → `createAdminStatusEvent` → toast → reload the
list. Only `kind`, `title`, `components` and `message` are required by the API; `impact` and
`state` are optional, so the composer supplies sensible defaults per kind (an incident opens
`investigating`, maintenance opens `scheduled`) rather than sending nothing and letting the
server decide silently. The preview is a step, not a modal afterthought: it is the only place the operator sees
the customer's version of what they wrote.

**Appending.** An open event's row expands to a `StatusUpdateForm`; submitting posts an update
and reloads. Selecting a terminal state (`resolved`, `completed`, `cancelled`) closes the
event — there is no separate "close" action, because the API has none.

### The preview resolves its own wording

The public card lives in `faas-web` — a different repo and a different stack. Importing it is
impossible and cloning it would create a second copy that drifts the first time the public
page changes.

Instead the preview fetches `GET /v1/status` and resolves the selected component ids through
`components[].name`, so it shows the **exact display names customers see**, sourced from the
same endpoint the public page reads. Title, impact, state wording and message are shown as
written.

It is labelled a content preview, not a visual mock. Claiming pixel parity across two stacks
would be a lie, and the failure this guards against — wrong wording, wrong components, going
out to every customer at once — is a content failure.

## The lifecycle is append-only

There is no edit and no delete in the API. An event is created, then updates accumulate, then
a terminal state closes it. **A published mistake is permanent and public.**

The UI must not pretend otherwise:

- No "edit" affordance anywhere. The correction path is a new update, and the form says so.
- The confirm step names the consequence — published immediately, cannot be edited or deleted
  — rather than asking a generic "are you sure".
- After publishing, the composer clears. A form still holding the text of something already
  public invites a double publish.

## Error handling

| Case | Behaviour |
|---|---|
| `403` — session lacks operator scope | The section states that publishing needs operator access. Not an error toast: it is a fact about the account. |
| `422` — validation | Field-level, from the problem body. The form keeps its values. |
| Network / `5xx` on publish | Toast, form keeps its values, nothing cleared. The operator must never lose a message they typed during an outage. |
| Network on list | `AsyncBoundary` error state with retry, as every other page. |
| `GET /v1/status` unavailable for preview | Preview falls back to raw component ids and says the display names could not be resolved. Publishing stays available — a status page must be publishable when the platform is unhealthy, which is exactly when it is needed. |

That last row is the load-bearing one. Every failure path here has to degrade toward
*still being able to publish*, because this tool is used when things are broken.

## Testing

Vitest, beside the code, matching the repo's layout.

- **Composer validation** — the API's required fields (`kind`, `title`, `components`,
  `message`) and the closed enums. Note that `impact`, `state` and the scheduled window are
  *optional* in the API; requiring a window when `kind=maintenance` is a rule this UI adds,
  because scheduling maintenance without saying when is not useful to a reader. Tested as
  ours, not as the API's.
- **Preview resolution** — component ids render as their public display names; unresolvable
  ids fall back to the raw id rather than rendering blank.
- **Append lifecycle** — a terminal state closes the event; a non-terminal one leaves it open.
- **Publish failure keeps the draft** — the highest-value test here. A 500 on publish must
  leave every field intact.
- **No edit affordance** — a guard test that the list renders no edit or delete control, so
  the append-only contract cannot be softened by a later change without someone noticing.

## Out of scope

- **Component health overrides.** Computed from telemetry; see the table above.
- **Draft or scheduled-publish state.** The API has neither. Maintenance can be *scheduled*
  (`scheduled_start_at`), but the event itself publishes immediately.
- **Deleting or editing published events.** No endpoint, and correctly so.
- **Templates for common maintenance.** Worth revisiting once there is evidence of repetition.
- **A deep link from Incident Center.** Considered and deferred: it matches how the job goes —
  notice something in telemetry, then tell customers — but it is additive and can follow.

## Risks

**The contract is unmerged.** `#1864` is 96 files and ~7,600 lines and has not landed. If its
admin schemas change before merge, the client types and composer fields change with them. The
blast radius is contained to `src/lib/api.ts` and the composer, both of which are new code.

**The public page is also unmerged.** `faas-web#69` is open. Nothing here depends on it at
runtime — both read the same API independently — but end-to-end verification needs all three
deployed together.
