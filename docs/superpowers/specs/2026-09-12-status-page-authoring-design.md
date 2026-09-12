# Status-page authoring in the operations console

**Date:** 2026-09-12
**Repos touched:** `poyrazK/faas-frontend` (this one)
**Depends on:** `poyrazK/faas#1864` — merged 2026-09-12 (`a7dca2b9`)

> **Amended after the merge.** This spec was written against the open PR. Four things in
> its contract changed before it landed; the sections below carry the shipped shapes, and
> [What changed at merge](#what-changed-at-merge) records the difference.

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

// Impact is an incident's alone. Maintenance carries the fixed value `maintenance`,
// which is why it is not offered here and not sent.
export type IncidentImpact = 'degraded' | 'partial_outage' | 'major_outage';
// The states an event may be *created* in. Terminal states are reachable only by update.
export type IncidentOpenState = 'investigating' | 'identified' | 'monitoring';
export type StatusState =
  | IncidentOpenState | 'resolved'
  | 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

listAdminStatusEvents(): Promise<AdminStatusEvent[]>
createAdminStatusEvent(body: CreateStatusEventBody): Promise<AdminStatusEvent>
appendAdminStatusUpdate(eventId: string, input: { state: StatusState; message: string }): Promise<AdminStatusEvent>
getPublicStatusSnapshot(): Promise<PublicStatusSnapshot>   // read-only, for component display names
```

`CreateStatusEventBody` is a discriminated union on `kind`, mirroring
`AdminStatusIncidentCreateRequest` and `AdminStatusMaintenanceCreateRequest`. Both are
`additionalProperties: false`, so the two kinds do not merely ignore each other's fields —
sending one is a 400. `toCreateRequest` builds the body per kind for that reason, rather
than spreading a draft that may still hold fields from a kind the operator switched away
from.

The identifier on `AdminStatusEvent` is **`id`**. The path parameter is spelled
`{public_id}`, which is a real trap: it reads as a field name and there is no such field.

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
list.

What each kind must carry differs, and the composer differs with it:

| | Incident | Maintenance |
|---|---|---|
| Required | `title`, `impact`, `components`, `message` | `title`, `components`, `message`, `scheduled_start_at`, `scheduled_end_at` |
| `state` at creation | optional; defaults to `investigating` | optional; defaults to `scheduled` |
| Rejected outright | any `scheduled_*` field | `impact` |

`impact` is required on an incident, so the composer asks for it rather than defaulting —
there is no honest default between "degraded" and "major outage", and guessing on the
operator's behalf publishes a severity nobody chose. `state` does have an honest default
per kind, and is supplied rather than left to the server to decide silently.

The preview is a step, not a modal afterthought: it is the only place the operator sees the
customer's version of what they wrote.

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

### And the real page, after the fact

Every published event carries a **"view on status page"** link to
`/status/incidents/{public_id}` — the page customers actually read.

This is deliberate compensation for what a content preview cannot show. One concrete example:
the public list renders resolved incidents with `compact`, which hides the message entirely
(`faas-web` `status-page.tsx:187, 308`) — it survives only on the detail page. No content
preview would ever reveal that. The link gives true fidelity a moment later, and pairs with
the append path: publish, look at the real thing, append a correction if it reads wrong.

## The lifecycle is append-only

There is no edit, no delete and no PATCH on status events — verified against `#1864`'s
OpenAPI. An event is created, then updates accumulate, then a terminal state closes it.
**A published mistake is permanent and public.**

The UI must not pretend otherwise:

- No "edit" affordance anywhere. The correction path is a new update, and the form says so.
- The confirm step names the consequence — published immediately, cannot be edited or deleted
  — rather than asking a generic "are you sure".
- After publishing, the composer clears. A form still holding the text of something already
  public invites a double publish.
- `cancelled` is the documented recovery path for an accidental publish, surfaced as such
  rather than left as one state among eight. It closes the event; it does not unsay it.

### Two of these are backend gaps, not virtues

An earlier draft of this spec called the missing edit endpoint correct. That conflated two
different things, and only one of them is correct:

- **Deleting a published event** is correctly absent. Erasing an outage you admitted to is
  dishonest, and no status page should offer it.
- **Fixing the text of your own message** is not the same act, and every serious status page
  supports it. Its absence is a gap.

Two consequences follow, and both are worth raising on `#1864` while its contract is still
open — a `PATCH` added now is far cheaper than one added after the shape ships:

1. **Typos are permanent.** A title published at 02:14 with a spelling mistake stays on the
   page customers refresh during an outage. The only recourse is a follow-up update reading
   "correction: …", which makes the page look worse rather than better.
2. **Component attribution can never be corrected.** `AdminStatusEventUpdateRequest` carries
   only `{state, message}`, so the `components` array is frozen at creation. An event tagged
   `networking` when it was `deployments` misattributes itself permanently, and customers
   reasoning by component get a wrong answer forever.

This UI stays append-only regardless, because it must match the API it has. The point of
recording these here is so the constraint is understood as borrowed rather than chosen.

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

- **Composer validation** — the API's required fields per kind (see the table above) and the
  closed enums. Every one of these is the API's own rule, so each test names it as such: an
  incident with no `impact`, or a maintenance window missing either end, is a 400 at publish
  time — the worst possible moment to find out. The one rule this UI adds on top is that a
  window must end after it starts, which the API does not check.
- **Body construction per kind** — an incident sends no `scheduled_*` field even when the
  draft still holds one from a switched kind, and maintenance sends no `impact`. This is the
  test that guards `additionalProperties: false`, and it cannot be replaced by a type: the
  draft is one shape and the wire is two.
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
- **Deleting or editing published events.** No endpoint exists. Deletion should stay absent;
  message editing is a gap worth closing upstream (see above), but not something this UI can
  work around.
- **Templates for common maintenance.** Worth revisiting once there is evidence of repetition.
- **A deep link from Incident Center.** Considered and deferred: it matches how the job goes —
  notice something in telemetry, then tell customers — but it is additive and can follow.

## Risks

**The public page has landed.** `faas-web#69` merged 2026-09-12, so `gregale.dev/status`
answers 200 and the "view on status page" link has a real destination. It is a client-rendered
SPA, so an unknown incident id returns 200 with the not-found state rendered in the browser —
worth knowing before reading that status code as a working link.

**The publish path is unexercised from here.** `GET /v1/admin/status/incidents` returns 403
for a session without operator scope, which is every session available during development.
The 403 branch is therefore the only admin path verified against the live API; create and
append are verified against the schema, not against a response.

## What changed at merge

Recorded because the cost fell entirely on the parts that types could not defend. The client
is hand-written against the OpenAPI, so a field the API does not have type-checks perfectly —
inventing `public_id` compiled cleanly and would have failed at runtime in three places.

| Designed against | Shipped | Consequence |
|---|---|---|
| `public_id` on the event | `id` | React key, status-page link and the update call all read `undefined` |
| `impact` optional, includes `maintenance` | required on incidents, enum narrowed to three | every publish 400s; the composer never asked for it |
| `scheduled_start_at` alone | both ends required | a window with no end 400s |
| One create body | discriminated `oneOf`, both `additionalProperties: false` | a carried-over field is a 400, not an ignored key |

The lesson worth keeping: the risk of building against an open PR is not that the shapes
move — it is that a hand-written client cannot tell you when they have.
