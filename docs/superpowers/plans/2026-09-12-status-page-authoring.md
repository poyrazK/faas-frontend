# Status-Page Authoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give operators a surface at `/operations/status` to publish incidents, schedule maintenance, and append lifecycle updates to the public status page.

**Architecture:** All decidable logic — validation, defaults, terminal-state detection, component-name resolution — lives in one pure module (`src/lib/status-events.ts`) that is unit-tested. The page and its local components are thin wiring over that module plus the existing `request<T>` client, `useAsync`, `AsyncBoundary` and `useToast` primitives. Publishing is compose → preview → confirm; the preview resolves component display names from `GET /v1/status` so it shows the words customers read.

**Tech Stack:** Next.js 16 (app router), React 19, Tailwind 4, Vitest (node environment).

**Spec:** `docs/superpowers/specs/2026-09-12-status-page-authoring-design.md`

## Global Constraints

- **Vitest is `environment: 'node'` and only collects `src/**/*.test.ts`** — not `.tsx`. There is no DOM and no component testing in this repo, by deliberate choice (see the comment in `vitest.config.ts`). **Do not add jsdom or a testing-library.** Put testable logic in pure `.ts` modules; verify components with `npm run typecheck`, `npm run lint`, `npm run build` and a manual pass.
- **Do not introduce codegen.** `src/lib/api.ts` is hand-written; its header names `faas/api/openapi.yaml` as the contract source of truth. Add types by hand, copied from that contract.
- **Append-only.** The API has no PATCH, PUT or DELETE on status events. Render no edit or delete affordance anywhere.
- **Every failure path must leave the operator able to publish.** This tool is used when the platform is unhealthy.
- Backend contract comes from `poyrazK/faas#1864`, unmerged at time of writing. Paths: `GET/POST /v1/admin/status/incidents`, `POST /v1/admin/status/incidents/{public_id}/updates`, `GET /v1/status`.
- `request<T>` already attaches an `Idempotency-Key` to every `/v1/admin/*` mutation. Do not add one.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/status-events.ts` | **new** — pure domain: types, validation, defaults, terminal states, name resolution, draft→request mapping |
| `src/lib/status-events.test.ts` | **new** — unit tests for the above |
| `src/lib/api.ts` | **modify** — four client functions + their wire types, in the `/v1/admin/*` section |
| `src/app/operations/status/page.tsx` | **new** — the page and its local components |
| `src/app/operations/layout.tsx` | **modify** — one nav entry |

### Two spec tests that cannot be unit tests here

The spec asks for "publish failure keeps the draft" and "no edit affordance" as tests. Both are
component behaviour, and this repo has no DOM environment — adding one to satisfy two
assertions would be a larger change to the toolchain than the feature itself, and the global
constraints forbid it.

They are covered as **manual checks** in Tasks 4 and 5 instead, written out as numbered steps
so they are performed rather than assumed. If component testing is ever introduced here, these
two are the first cases to port.

---

### Task 1: Pure domain module

**Files:**
- Create: `src/lib/status-events.ts`
- Test: `src/lib/status-events.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `StatusEventKind`, `StatusComponent`, `StatusImpact`, `StatusState`, `StatusDraft`, `DraftErrors`, `isTerminalState(state)`, `defaultStateFor(kind)`, `validateDraft(draft)`, `resolveComponentNames(ids, components)`, `emptyDraft(kind)`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/status-events.test.ts
import { describe, expect, it } from 'vitest';
import {
  defaultStateFor,
  emptyDraft,
  isTerminalState,
  resolveComponentNames,
  validateDraft,
  type StatusDraft,
} from './status-events';

const draft = (over: Partial<StatusDraft> = {}): StatusDraft => ({
  kind: 'incident',
  title: 'Elevated errors on deployments',
  components: ['deployments'],
  message: 'We are investigating elevated error rates.',
  ...over,
});

describe('isTerminalState', () => {
  it('closes an event on the three states that end one', () => {
    for (const s of ['resolved', 'completed', 'cancelled'] as const) {
      expect(isTerminalState(s)).toBe(true);
    }
  });

  it('leaves an event open on every other state', () => {
    for (const s of ['investigating', 'identified', 'monitoring', 'scheduled', 'in_progress'] as const) {
      expect(isTerminalState(s)).toBe(false);
    }
  });
});

describe('defaultStateFor', () => {
  it('opens an incident as investigating and maintenance as scheduled', () => {
    // `state` is optional in the API. Sending a chosen default beats sending
    // nothing and letting the server pick silently.
    expect(defaultStateFor('incident')).toBe('investigating');
    expect(defaultStateFor('maintenance')).toBe('scheduled');
  });
});

describe('validateDraft', () => {
  it('accepts a complete incident', () => {
    expect(validateDraft(draft())).toEqual({});
  });

  it('requires the four fields the API requires', () => {
    const errors = validateDraft(draft({ title: '  ', components: [], message: '' }));
    expect(errors.title).toBeTruthy();
    expect(errors.components).toBeTruthy();
    expect(errors.message).toBeTruthy();
  });

  it('rejects a title or message past the API ceiling rather than letting the server do it', () => {
    expect(validateDraft(draft({ title: 'x'.repeat(161) })).title).toBeTruthy();
    expect(validateDraft(draft({ message: 'x'.repeat(1025) })).message).toBeTruthy();
  });

  it('requires a window for maintenance, which the API does not', () => {
    // Ours, not the API's: scheduling maintenance without saying when is not
    // useful to a reader.
    expect(validateDraft(draft({ kind: 'maintenance' })).scheduledStartAt).toBeTruthy();
    expect(
      validateDraft(draft({ kind: 'maintenance', scheduledStartAt: '2026-09-20T02:00' })),
    ).toEqual({});
  });
});

describe('resolveComponentNames', () => {
  const components = [
    { id: 'deployments', name: 'Deployments' },
    { id: 'networking', name: 'Networking' },
  ];

  it('shows the public display names, so the preview reads as customers read it', () => {
    expect(resolveComponentNames(['deployments'], components)).toEqual(['Deployments']);
  });

  it('falls back to the raw id rather than rendering blank', () => {
    // /v1/status can be down precisely when an operator needs to publish.
    expect(resolveComponentNames(['app_execution'], components)).toEqual(['app_execution']);
    expect(resolveComponentNames(['deployments'], [])).toEqual(['deployments']);
  });
});

describe('emptyDraft', () => {
  it('starts with the kind’s default state and nothing else filled', () => {
    expect(emptyDraft('maintenance')).toEqual({
      kind: 'maintenance',
      title: '',
      components: [],
      message: '',
      state: 'scheduled',
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/status-events.test.ts`
Expected: FAIL — `Failed to resolve import "./status-events"`

- [ ] **Step 3: Write the module**

```ts
// src/lib/status-events.ts
/* ==========================================================================
   Status-page events — the decidable half.

   Everything here is pure so it can be tested: this repo's vitest runs in a
   node environment and collects only `.test.ts` files under src, deliberately
   (see vitest.config.ts). Components stay thin wiring over these functions.

   (Do not write the glob literally in this block comment — the `*` `/` pair
   inside it terminates the comment and the file stops parsing.)

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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/status-events.test.ts`
Expected: PASS — 10 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/status-events.ts src/lib/status-events.test.ts
git commit -m "feat(status): pure domain for status-page events"
```

---

### Task 2: API client

**Files:**
- Modify: `src/lib/api.ts` — append to the `/* ── Operator & Admin (/v1/admin/*) ── */` section

**Interfaces:**
- Consumes: Task 1's `StatusComponent`, `StatusEventKind`, `StatusImpact`, `StatusState`
- Produces: `AdminStatusEvent`, `StatusUpdateEntry`, `PublicStatusSnapshot`, `CreateStatusEventInput`, `listAdminStatusEvents()`, `createAdminStatusEvent(input)`, `appendAdminStatusUpdate(publicId, input)`, `getPublicStatusSnapshot()`

- [ ] **Step 1: Add the types and functions**

Append to `src/lib/api.ts`, inside the Operator & Admin section:

```ts
/* ── Public status page (faas#1864) ─────────────────────────────────────── */

import type {
  StatusComponent,
  StatusEventKind,
  StatusImpact,
  StatusState,
} from './status-events';

export interface StatusUpdateEntry {
  id: string;
  state: StatusState;
  message: string;
  posted_at: string;
}

export interface AdminStatusEvent {
  id: string;
  public_id: string;
  kind: StatusEventKind;
  title: string;
  impact?: StatusImpact;
  components: StatusComponent[];
  state: StatusState;
  starts_at?: string;
  scheduled_start_at?: string;
  scheduled_end_at?: string;
  resolved_at?: string;
  updated_at: string;
  updates: StatusUpdateEntry[];
}

export interface CreateStatusEventInput {
  kind: StatusEventKind;
  title: string;
  components: StatusComponent[];
  message: string;
  impact?: StatusImpact;
  state?: StatusState;
  starts_at?: string;
  scheduled_start_at?: string;
  scheduled_end_at?: string;
}

/** Only the fields the preview needs: component ids and their public names. */
export interface PublicStatusSnapshot {
  components: { id: string; name: string }[];
}

export const listAdminStatusEvents = () =>
  request<AdminStatusEvent[]>('/v1/admin/status/incidents', { cache: 'no-store' });

export const createAdminStatusEvent = (input: CreateStatusEventInput) =>
  request<AdminStatusEvent>('/v1/admin/status/incidents', {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const appendAdminStatusUpdate = (
  publicId: string,
  input: { state: StatusState; message: string },
) =>
  request<AdminStatusEvent>(
    `/v1/admin/status/incidents/${encodeURIComponent(publicId)}/updates`,
    { method: 'POST', body: JSON.stringify(input) },
  );

/** Read-only, and public: the preview borrows the customer-facing names from it. */
export const getPublicStatusSnapshot = () =>
  request<PublicStatusSnapshot>('/v1/status', { cache: 'no-store' });
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat(status): client for the admin status endpoints"
```

---

### Task 3: Page shell, list and nav entry

**Files:**
- Create: `src/app/operations/status/page.tsx`
- Modify: `src/app/operations/layout.tsx:18-30` — add one `OPS_NAV` entry

**Interfaces:**
- Consumes: Task 2's `listAdminStatusEvents`, `AdminStatusEvent`; Task 1's `isTerminalState`
- Produces: the default-exported `StatusPage` route component

- [ ] **Step 1: Add the nav entry**

In `src/app/operations/layout.tsx`, add immediately after the `Incident Center` line:

```tsx
  { href: '/operations/status', label: 'Status Page', icon: 'alerts' },
```

Its own entry, not a tab under Incident Center: that page is internal telemetry, and publishing to customers is a different act with a different audience.

- [ ] **Step 2: Write the page with its list**

```tsx
// src/app/operations/status/page.tsx
'use client';

import React, { useState } from 'react';
import {
  ApiError,
  listAdminStatusEvents,
  type AdminStatusEvent,
} from '@/lib/api';
import { isTerminalState } from '@/lib/status-events';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, Mono } from '@/components/ui/bits';
import { SectionCard } from '@/components/ui/Panels';
import { AsyncBoundary, EmptyState } from '@/components/ui/States';
import { relativeTime } from '@/lib/format';

function EventRow({ event }: { event: AdminStatusEvent }) {
  const open = !isTerminalState(event.state);
  const latest = event.updates[event.updates.length - 1];
  return (
    <li className="flex flex-col gap-2 border-b border-[var(--color-line)] py-3 last:border-0">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs uppercase text-[var(--color-ink-muted)]">{event.kind}</span>
        <span className="flex-1 text-sm">{event.title}</span>
        <Mono>{event.state}</Mono>
        <span className="text-xs text-[var(--color-ink-muted)]">
          {relativeTime(event.updated_at)}
        </span>
        <a
          href={`https://gregale.dev/status/incidents/${event.public_id}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs underline"
        >
          view on status page
        </a>
      </div>
      {latest && <p className="text-xs text-[var(--color-ink-muted)]">{latest.message}</p>}
      {open && <p className="text-xs text-[var(--color-ink-muted)]">Open — post an update below.</p>}
    </li>
  );
}

export default function StatusPage() {
  const events = useAsync(listAdminStatusEvents, []);
  // 403 is not a failure to report: it is a fact about this session. Saying
  // "something went wrong" to someone who simply lacks operator scope sends
  // them debugging a working system.
  const forbidden = events.error instanceof ApiError && events.error.status === 403;

  if (forbidden) {
    return (
      <div>
        <PageHeader title="Status Page" />
        <SectionCard>
          <EmptyState
            title="Operator access required"
            hint="Publishing to the status page needs an operator session."
          />
        </SectionCard>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Status Page"
        subtitle="Publish incidents and schedule maintenance. Everything here is public immediately."
      />
      <SectionCard title="Published events">
        <AsyncBoundary
          state={events}
          isEmpty={(rows) => rows.length === 0}
          empty={<EmptyState title="Nothing published" hint="The status page is clear." />}
        >
          {(rows) => (
            <ul className="flex flex-col">
              {rows.map((event) => (
                <EventRow key={event.public_id} event={event} />
              ))}
            </ul>
          )}
        </AsyncBoundary>
      </SectionCard>
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: all pass. `EmptyState` is `{ icon?, title, hint?, action? }` and takes no children (`States.tsx:54`); `relativeTime(iso?: string | null)` is in `@/lib/format`; `Mono` is in `@/components/ui/bits`. Do not modify any of those files.

- [ ] **Step 4: Commit**

```bash
git add src/app/operations/status/page.tsx src/app/operations/layout.tsx
git commit -m "feat(status): operations page listing published status events"
```

---

### Task 4: Composer and preview

**Files:**
- Modify: `src/app/operations/status/page.tsx`

**Interfaces:**
- Consumes: Task 1's `emptyDraft`, `validateDraft`, `resolveComponentNames`, `defaultStateFor`, `StatusDraft`; Task 2's `createAdminStatusEvent`, `getPublicStatusSnapshot`
- Produces: local `Composer` component; no exports

- [ ] **Step 1: Add the composer and preview**

Add to `src/app/operations/status/page.tsx`. The component list is the closed set from the contract:

```tsx
const COMPONENTS: { id: StatusComponent; fallback: string }[] = [
  { id: 'api_console', fallback: 'API & Console' },
  { id: 'deployments', fallback: 'Deployments' },
  { id: 'app_execution', fallback: 'App execution' },
  { id: 'networking', fallback: 'Networking' },
  { id: 'observability', fallback: 'Observability' },
];

function Composer({ onPublished }: { onPublished: () => void }) {
  const toast = useToast();
  const snapshot = useAsync(getPublicStatusSnapshot, []);
  const [draft, setDraft] = useState<StatusDraft>(() => emptyDraft('incident'));
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const errors = validateDraft(draft);
  const names = resolveComponentNames(draft.components, snapshot.data?.components ?? []);

  async function publish() {
    setSubmitting(true);
    try {
      await createAdminStatusEvent({
        kind: draft.kind,
        title: draft.title.trim(),
        components: draft.components,
        message: draft.message.trim(),
        ...(draft.impact ? { impact: draft.impact } : {}),
        ...(draft.state ? { state: draft.state } : {}),
        ...(draft.scheduledStartAt
          ? { scheduled_start_at: new Date(draft.scheduledStartAt).toISOString() }
          : {}),
        ...(draft.scheduledEndAt
          ? { scheduled_end_at: new Date(draft.scheduledEndAt).toISOString() }
          : {}),
      });
      toast.success('Published to the status page.');
      // Clear only on success. A form still holding text that is already
      // public invites a double publish; a form emptied after a failure
      // loses a message written mid-incident.
      setDraft(emptyDraft(draft.kind));
      setPreviewing(false);
      onPublished();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Publishing failed.');
    } finally {
      setSubmitting(false);
    }
  }

  if (previewing) {
    return (
      <SectionCard title="What customers will read">
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-xs uppercase text-[var(--color-ink-muted)]">{draft.kind}</p>
          <p className="font-medium">{draft.title}</p>
          <p className="text-xs text-[var(--color-ink-muted)]">
            Affected: {names.join(', ') || '—'}
          </p>
          <p>{draft.message}</p>
          {snapshot.error && (
            <p className="text-xs text-[var(--color-ink-muted)]">
              Component names could not be loaded; ids are shown instead.
            </p>
          )}
          <p className="text-xs text-[var(--color-ink-muted)]">
            This is a content preview, not the page&apos;s layout. Publishing is immediate and
            cannot be edited or deleted — corrections are posted as a further update.
          </p>
          <div className="flex gap-2">
            <button type="button" disabled={submitting} onClick={publish}>
              {submitting ? 'Publishing…' : 'Publish now'}
            </button>
            <button type="button" disabled={submitting} onClick={() => setPreviewing(false)}>
              Back to edit
            </button>
          </div>
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Publish an event">
      <div className="flex flex-col gap-3 text-sm">
        <select
          value={draft.kind}
          onChange={(e) => {
            const kind = e.currentTarget.value as StatusEventKind;
            setDraft({ ...draft, kind, state: defaultStateFor(kind) });
          }}
        >
          <option value="incident">Incident</option>
          <option value="maintenance">Maintenance</option>
        </select>

        <input
          value={draft.title}
          placeholder="Title"
          onChange={(e) => setDraft({ ...draft, title: e.currentTarget.value })}
        />
        {errors.title && <p className="text-xs text-[var(--color-danger)]">{errors.title}</p>}

        <fieldset className="flex flex-wrap gap-3">
          {COMPONENTS.map(({ id, fallback }) => (
            <label key={id} className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={draft.components.includes(id)}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    components: e.currentTarget.checked
                      ? [...draft.components, id]
                      : draft.components.filter((c) => c !== id),
                  })
                }
              />
              {snapshot.data?.components.find((c) => c.id === id)?.name ?? fallback}
            </label>
          ))}
        </fieldset>
        {errors.components && (
          <p className="text-xs text-[var(--color-danger)]">{errors.components}</p>
        )}

        {draft.kind === 'maintenance' && (
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-xs">
              Starts
              <input
                type="datetime-local"
                value={draft.scheduledStartAt ?? ''}
                onChange={(e) => setDraft({ ...draft, scheduledStartAt: e.currentTarget.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              Ends
              <input
                type="datetime-local"
                value={draft.scheduledEndAt ?? ''}
                onChange={(e) => setDraft({ ...draft, scheduledEndAt: e.currentTarget.value })}
              />
            </label>
          </div>
        )}
        {errors.scheduledStartAt && (
          <p className="text-xs text-[var(--color-danger)]">{errors.scheduledStartAt}</p>
        )}

        <textarea
          value={draft.message}
          placeholder="What customers should know"
          rows={4}
          onChange={(e) => setDraft({ ...draft, message: e.currentTarget.value })}
        />
        {errors.message && <p className="text-xs text-[var(--color-danger)]">{errors.message}</p>}

        <button
          type="button"
          disabled={Object.keys(errors).length > 0}
          onClick={() => setPreviewing(true)}
        >
          Preview
        </button>
      </div>
    </SectionCard>
  );
}
```

Extend the file's existing imports to exactly this:

```tsx
import {
  ApiError,
  createAdminStatusEvent,
  getPublicStatusSnapshot,
  listAdminStatusEvents,
  type AdminStatusEvent,
} from '@/lib/api';
import {
  defaultStateFor,
  emptyDraft,
  isTerminalState,
  resolveComponentNames,
  validateDraft,
  type StatusComponent,
  type StatusDraft,
  type StatusEventKind,
} from '@/lib/status-events';
import { useToast } from '@/components/ui/Toast';
```

Render `<Composer onPublished={events.reload} />` above the list in `StatusPage`.

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 3: Manual check**

Run `npm run dev`, open `/operations/status`:
1. Preview is disabled until title, a component and a message are filled.
2. Switching to Maintenance reveals the window fields and blocks Preview until Starts is set.
3. Preview shows component **display names**, not ids.
4. "Back to edit" keeps every field.
5. **Publish failure keeps the draft.** In devtools, block `POST /v1/admin/status/incidents`
   (or stop the backend), press Publish, and confirm an error toast appears and *every field
   is still filled*. This is the spec's highest-value case: a message written mid-incident must
   never be lost to a transient failure.

- [ ] **Step 4: Commit**

```bash
git add src/app/operations/status/page.tsx
git commit -m "feat(status): compose and preview an event before publishing"
```

---

### Task 5: Appending updates

**Files:**
- Modify: `src/app/operations/status/page.tsx`

**Interfaces:**
- Consumes: Task 2's `appendAdminStatusUpdate`; Task 1's `isTerminalState`, `StatusState`
- Produces: local `UpdateForm` component; no exports

- [ ] **Step 1: Add the update form**

```tsx
const OPEN_STATES: StatusState[] = [
  'investigating',
  'identified',
  'monitoring',
  'in_progress',
  'resolved',
  'completed',
  'cancelled',
];

function UpdateForm({ event, onPosted }: { event: AdminStatusEvent; onPosted: () => void }) {
  const toast = useToast();
  const [state, setState] = useState<StatusState>(event.state);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function post() {
    setSubmitting(true);
    try {
      await appendAdminStatusUpdate(event.public_id, { state, message: message.trim() });
      toast.success(isTerminalState(state) ? 'Event closed.' : 'Update posted.');
      setMessage('');
      onPosted();
    } catch (err) {
      // The message stays in the box: it was written during an incident and
      // must not be lost to a transient failure.
      toast.error(err instanceof Error ? err.message : 'Posting the update failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-wrap items-start gap-2 pt-2">
      <select value={state} onChange={(e) => setState(e.currentTarget.value as StatusState)}>
        {OPEN_STATES.map((s) => (
          <option key={s} value={s}>
            {s}
            {isTerminalState(s) ? ' (closes)' : ''}
          </option>
        ))}
      </select>
      {state === 'cancelled' && (
        // The only recovery for something published by mistake. It closes the
        // event; it does not remove it, and the API offers nothing that would.
        <p className="w-full text-xs text-[var(--color-ink-muted)]">
          Cancelling closes this event on the status page. It stays visible in history.
        </p>
      )}
      <input
        className="flex-1"
        value={message}
        placeholder="What changed"
        onChange={(e) => setMessage(e.currentTarget.value)}
      />
      <button type="button" disabled={submitting || !message.trim()} onClick={post}>
        {submitting ? 'Posting…' : 'Post update'}
      </button>
    </div>
  );
}
```

Render it inside `EventRow` when the event is open, threading an `onPosted` callback through from `StatusPage` (`events.reload`). `EventRow` gains a second prop: `onPosted: () => void`.

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 3: Manual check**

1. An open event shows the update form; a closed one does not.
2. Terminal states are marked "(closes)" in the dropdown.
3. Posting a terminal state removes the form from that row after reload.
4. No edit or delete control appears anywhere on the page.

- [ ] **Step 4: Run the full gate and commit**

```bash
npm run typecheck && npm run lint && npm run test && npm run build
git add src/app/operations/status/page.tsx
git commit -m "feat(status): append lifecycle updates and close events"
```

---

## Deferred

- **Deep link from Incident Center** — prefill a draft from an anomaly. Additive; follows once the base surface is in use.
- **Templates for recurring maintenance** — wait for evidence of repetition.
- **`PATCH` for corrections** — raised on `poyrazK/faas#1864`. If it lands, a follow-up adds an edit path for `title`, `components` and the latest message. Until then the UI stays append-only.
