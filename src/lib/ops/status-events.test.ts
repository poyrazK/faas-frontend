import { describe, expect, it } from 'vitest';
import type { PublicStatusEvent } from './status';
import {
  componentNames,
  defaultStateFor,
  emptyDraft,
  formatPublicDateTime,
  humanizeState,
  isTerminalState,
  nextStates,
  placementText,
  previewCreated,
  previewUpdated,
  publicCard,
  publicPlacement,
  publicTimeline,
  statusPermalink,
  switchDraftKind,
  toCreateRequest,
  toUpdateRequest,
  updateDraftFor,
  validateDraft,
  validateUpdate,
  type StatusDraft,
} from './status-events';

const NOW = new Date('2026-10-30T12:00:00Z');

const incident = (over: Partial<StatusDraft> = {}): StatusDraft => ({
  kind: 'incident',
  title: 'Elevated errors on deployments',
  impact: 'degraded',
  components: ['deployments'],
  message: 'We are investigating elevated error rates.',
  state: 'investigating',
  ...over,
});

const maintenance = (over: Partial<StatusDraft> = {}): StatusDraft => ({
  kind: 'maintenance',
  title: 'Network edge maintenance',
  components: ['networking'],
  message: 'Brief interruptions are expected.',
  state: 'scheduled',
  scheduledStartAt: '2026-11-20T02:00:00Z',
  scheduledEndAt: '2026-11-20T04:00:00Z',
  ...over,
});

const published = (over: Partial<PublicStatusEvent> = {}): PublicStatusEvent => ({
  id: '0b0e5c9e-6a4f-4d5e-9a7b-2d1f3c4b5a69',
  kind: 'incident',
  title: 'Elevated errors',
  impact: 'degraded',
  components: ['deployments'],
  state: 'investigating',
  starts_at: '2026-10-30T11:00:00Z',
  updated_at: '2026-10-30T11:00:00Z',
  updates: [{ id: 'u1', state: 'investigating', message: 'Looking into it.', posted_at: '2026-10-30T11:00:00Z' }],
  ...over,
});

describe('lifecycle (ported from the status PR, corrected against ValidateTransition)', () => {
  it('closes an event on the three states that end one', () => {
    for (const s of ['resolved', 'completed', 'cancelled'] as const) expect(isTerminalState(s)).toBe(true);
    for (const s of ['investigating', 'identified', 'monitoring', 'scheduled', 'in_progress'] as const) {
      expect(isTerminalState(s)).toBe(false);
    }
  });

  it('opens an incident as investigating and maintenance as scheduled', () => {
    expect(defaultStateFor('incident')).toBe('investigating');
    expect(defaultStateFor('maintenance')).toBe('scheduled');
  });

  it('offers only the transitions apid accepts (the PR offered every state to every kind)', () => {
    expect(nextStates('incident', 'identified')).toEqual(['investigating', 'identified', 'monitoring', 'resolved']);
    expect(nextStates('maintenance', 'scheduled')).toEqual(['scheduled', 'in_progress', 'cancelled']);
    expect(nextStates('maintenance', 'in_progress')).toEqual(['in_progress', 'completed']);
    expect(nextStates('incident', 'resolved')).toEqual([]);
  });
});

describe('validateDraft', () => {
  it('accepts a complete incident and a complete maintenance window', () => {
    expect(validateDraft(incident(), NOW)).toEqual({});
    expect(validateDraft(maintenance(), NOW)).toEqual({});
  });

  it('requires title, components and message on both kinds', () => {
    const errors = validateDraft(incident({ title: '  ', components: [], message: '' }), NOW);
    expect(errors.title).toBeTruthy();
    expect(errors.components).toBeTruthy();
    expect(errors.message).toBeTruthy();
  });

  it('counts characters the way Go counts runes', () => {
    expect(validateDraft(incident({ title: '🔥'.repeat(160) }), NOW).title).toBeUndefined();
    expect(validateDraft(incident({ title: 'x'.repeat(161) }), NOW).title).toBeTruthy();
    expect(validateDraft(incident({ message: 'x'.repeat(1025) }), NOW).message).toBeTruthy();
  });

  it('requires an incident impact and an open initial state', () => {
    expect(validateDraft(incident({ impact: undefined }), NOW).impact).toBeTruthy();
    expect(validateDraft(incident({ state: 'resolved' }), NOW).state).toBeTruthy();
    expect(validateDraft(incident({ startsAt: '2026-10-31T00:00:00Z' }), NOW).startsAt).toBeTruthy();
  });

  it('requires both ends of a maintenance window, in order', () => {
    expect(validateDraft(maintenance({ scheduledStartAt: '' }), NOW).scheduledStartAt).toBeTruthy();
    expect(validateDraft(maintenance({ scheduledEndAt: '' }), NOW).scheduledEndAt).toBeTruthy();
    expect(
      validateDraft(maintenance({ scheduledStartAt: '2026-11-20T04:00:00Z', scheduledEndAt: '2026-11-20T02:00:00Z' }), NOW).scheduledEndAt,
    ).toBeTruthy();
  });

  it('starts empty and keeps shared text when the kind switches', () => {
    expect(emptyDraft('incident')).toEqual({ kind: 'incident', title: '', components: [], message: '', state: 'investigating' });
    const switched = switchDraftKind(incident({ startsAt: '2026-10-30T10:00:00Z' }), 'maintenance');
    expect(switched).toEqual({
      kind: 'maintenance',
      title: 'Elevated errors on deployments',
      components: ['deployments'],
      message: 'We are investigating elevated error rates.',
      state: 'scheduled',
    });
  });
});

describe('toCreateRequest', () => {
  it('sends an incident without any maintenance field', () => {
    const body = toCreateRequest(incident({ scheduledStartAt: '2026-11-20T02:00:00Z', title: '  Spaced  ', message: '  Padded  ' }));
    expect(body).toEqual({
      kind: 'incident',
      title: 'Spaced',
      impact: 'degraded',
      components: ['deployments'],
      state: 'investigating',
      message: 'Padded',
    });
  });

  it('carries an incident backdate as starts_at', () => {
    expect(toCreateRequest(incident({ startsAt: '2026-10-30T10:15:00Z' })).starts_at).toBe('2026-10-30T10:15:00Z');
  });

  it('sends maintenance with a UTC window, its fixed impact and no starts_at', () => {
    const body = toCreateRequest(maintenance({ impact: 'degraded', startsAt: '2026-10-30T10:00:00Z' }));
    expect(body).toEqual({
      kind: 'maintenance',
      title: 'Network edge maintenance',
      components: ['networking'],
      impact: 'maintenance',
      state: 'scheduled',
      scheduled_start_at: '2026-11-20T02:00:00Z',
      scheduled_end_at: '2026-11-20T04:00:00Z',
      message: 'Brief interruptions are expected.',
    });
  });
});

describe('updates', () => {
  it('validates transitions, attribution and message', () => {
    const event = published();
    const draft = { ...updateDraftFor(event), message: 'Fix deployed.' };
    expect(validateUpdate(event, draft)).toEqual({});
    expect(validateUpdate(event, { ...draft, state: 'completed' }).state).toBeTruthy();
    expect(validateUpdate(event, { ...draft, components: [] }).components).toBeTruthy();
    expect(validateUpdate(event, { ...draft, impact: 'maintenance' }).impact).toBeTruthy();
    expect(validateUpdate(published({ state: 'resolved' }), draft).state).toBeTruthy();
  });

  it('sends impact and components only when they change', () => {
    const event = published();
    expect(toUpdateRequest(event, { state: 'identified', message: ' Found it. ', impact: 'degraded', components: ['deployments'] })).toEqual({
      state: 'identified',
      message: 'Found it.',
    });
    expect(
      toUpdateRequest(event, { state: 'monitoring', message: 'Wider.', impact: 'major_outage', components: ['deployments', 'networking'] }),
    ).toEqual({ state: 'monitoring', message: 'Wider.', impact: 'major_outage', components: ['deployments', 'networking'] });
  });
});

describe('preview', () => {
  it('reads like the public card, in UTC and public wording', () => {
    const event = previewCreated(toCreateRequest(incident({ components: ['api_console', 'deployments'] })), NOW);
    expect(publicCard(event)).toEqual({
      kindLabel: 'Incident',
      when: formatPublicDateTime('2026-10-30T12:00:00Z'),
      title: 'Elevated errors on deployments',
      message: 'We are investigating elevated error rates.',
      stateLabel: 'Investigating',
      components: 'API & Console, Deployments',
    });
    expect(formatPublicDateTime('2026-10-30T12:00:00Z')).toMatch(/UTC$/);
    expect(humanizeState('in_progress')).toBe('In progress');
  });

  it('shows maintenance at its scheduled start', () => {
    const event = previewCreated(toCreateRequest(maintenance()), NOW);
    expect(publicCard(event).when).toBe(formatPublicDateTime('2026-11-20T02:00:00Z'));
    expect(publicPlacement(event, NOW)).toBe('upcoming');
  });

  it('applies an update the way apid does and closes on a terminal state', () => {
    const next = previewUpdated(published(), { state: 'resolved', message: 'All clear.' }, NOW);
    expect(next.state).toBe('resolved');
    expect(next.resolved_at).toBe(NOW.toISOString());
    expect(publicTimeline(next).map((entry) => entry.message)).toEqual(['Looking into it.', 'All clear.']);
    expect(publicPlacement(next, NOW)).toBe('history');
    expect(placementText(next, NOW)).toContain('without its message');
  });

  it('explains the component overlay while an incident is open', () => {
    expect(placementText(published({ impact: 'partial_outage' }), NOW)).toContain('Deployments show at least Partial outage');
  });

  it('prefers live component names and falls back to the known ones', () => {
    expect(componentNames(['deployments', 'mystery'], [{ id: 'deployments', name: 'Deploys' }])).toEqual(['Deploys', 'mystery']);
    expect(componentNames(['app_execution'])).toEqual(['App execution']);
    expect(statusPermalink('abc')).toBe('https://gregale.dev/status/incidents/abc');
  });
});
