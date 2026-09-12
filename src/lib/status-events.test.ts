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
    for (const s of [
      'investigating',
      'identified',
      'monitoring',
      'scheduled',
      'in_progress',
    ] as const) {
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
