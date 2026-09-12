import { describe, expect, it } from 'vitest';
import {
  defaultStateFor,
  emptyDraft,
  isTerminalState,
  resolveComponentNames,
  toCreateRequest,
  validateDraft,
  type StatusDraft,
} from './status-events';

const incident = (over: Partial<StatusDraft> = {}): StatusDraft => ({
  kind: 'incident',
  title: 'Elevated errors on deployments',
  impact: 'degraded',
  components: ['deployments'],
  message: 'We are investigating elevated error rates.',
  ...over,
});

const maintenance = (over: Partial<StatusDraft> = {}): StatusDraft => ({
  kind: 'maintenance',
  title: 'Network edge maintenance',
  components: ['networking'],
  message: 'Brief interruptions are expected.',
  scheduledStartAt: '2026-09-20T02:00',
  scheduledEndAt: '2026-09-20T04:00',
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
    expect(defaultStateFor('incident')).toBe('investigating');
    expect(defaultStateFor('maintenance')).toBe('scheduled');
  });
});

describe('validateDraft', () => {
  it('accepts a complete incident and a complete maintenance window', () => {
    expect(validateDraft(incident())).toEqual({});
    expect(validateDraft(maintenance())).toEqual({});
  });

  it('requires title, components and message on both kinds', () => {
    const errors = validateDraft(incident({ title: '  ', components: [], message: '' }));
    expect(errors.title).toBeTruthy();
    expect(errors.components).toBeTruthy();
    expect(errors.message).toBeTruthy();
  });

  it('rejects a title or message past the API ceiling rather than letting the server do it', () => {
    expect(validateDraft(incident({ title: 'x'.repeat(161) })).title).toBeTruthy();
    expect(validateDraft(incident({ message: 'x'.repeat(1025) })).message).toBeTruthy();
  });

  it('requires impact on an incident, because the API does', () => {
    // AdminStatusIncidentCreateRequest lists impact as required; omitting it
    // is a 400 at publish time, which is the worst moment to discover it.
    expect(validateDraft(incident({ impact: undefined })).impact).toBeTruthy();
  });

  it('requires both ends of a maintenance window, because the API does', () => {
    expect(validateDraft(maintenance({ scheduledStartAt: '' })).scheduledStartAt).toBeTruthy();
    expect(validateDraft(maintenance({ scheduledEndAt: '' })).scheduledEndAt).toBeTruthy();
  });

  it('rejects a maintenance window that ends before it starts', () => {
    const errors = validateDraft(
      maintenance({ scheduledStartAt: '2026-09-20T04:00', scheduledEndAt: '2026-09-20T02:00' }),
    );
    expect(errors.scheduledEndAt).toBeTruthy();
  });
});

describe('toCreateRequest', () => {
  it('sends an incident without any maintenance field', () => {
    // Both variants are `additionalProperties: false`, so a stray
    // scheduled_start_at on an incident is a 400 rather than an ignored key.
    const body = toCreateRequest(incident({ scheduledStartAt: '2026-09-20T02:00' }));
    expect(body).toEqual({
      kind: 'incident',
      title: 'Elevated errors on deployments',
      impact: 'degraded',
      components: ['deployments'],
      state: 'investigating',
      message: 'We are investigating elevated error rates.',
    });
    expect(body).not.toHaveProperty('scheduled_start_at');
    expect(body).not.toHaveProperty('scheduled_end_at');
  });

  it('sends maintenance with an ISO window and no incident-only field', () => {
    const body = toCreateRequest(maintenance({ impact: 'degraded' }));
    expect(body).toMatchObject({
      kind: 'maintenance',
      title: 'Network edge maintenance',
      components: ['networking'],
      state: 'scheduled',
      message: 'Brief interruptions are expected.',
    });
    // `impact` on maintenance is the single value `maintenance`; an incident
    // impact carried over from a switched draft must not be sent.
    expect(body).not.toHaveProperty('impact');
    expect(body).not.toHaveProperty('starts_at');
    expect(String((body as { scheduled_start_at: string }).scheduled_start_at)).toMatch(/Z$/);
  });

  it('trims the free text it sends', () => {
    const body = toCreateRequest(incident({ title: '  Spaced  ', message: '  Padded  ' }));
    expect(body.title).toBe('Spaced');
    expect(body.message).toBe('Padded');
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
  it('starts an incident with the default state and no impact chosen yet', () => {
    expect(emptyDraft('incident')).toEqual({
      kind: 'incident',
      title: '',
      components: [],
      message: '',
      state: 'investigating',
    });
  });

  it('starts maintenance as scheduled', () => {
    expect(emptyDraft('maintenance')).toEqual({
      kind: 'maintenance',
      title: '',
      components: [],
      message: '',
      state: 'scheduled',
    });
  });
});
