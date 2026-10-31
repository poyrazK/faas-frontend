/* ==========================================================================
   Recovery actions on one microVM instance (force park / force restart),
   offered wherever the console lists instances: a node's panel, an app in
   the tenant workspace, and Emergency controls.
   ========================================================================== */

export type InstanceAction = 'force_park' | 'force_restart';

export const INSTANCE_ACTIONS: Record<
  InstanceAction,
  { label: string; button: string; tone: 'danger' | 'warning'; impact: string; allowed: readonly string[] }
> = {
  force_park: {
    label: 'Force park',
    button: 'Park…',
    tone: 'warning',
    impact: 'Captures and stops this instance. The customer’s next request wakes it from the snapshot.',
    allowed: ['running', 'waking', 'cold_booting'],
  },
  force_restart: {
    label: 'Force restart',
    button: 'Restart…',
    tone: 'danger',
    impact: 'Terminates this running instance and marks its snapshots stale; the next wake cold boots.',
    allowed: ['running'],
  },
};

/**
 * Whether apid accepts `action` for an instance in `state`
 * (state.operatorRecoveryEligible: park running, waking or cold-booting
 * instances; restart only running ones). Anything else is refused with 409.
 */
export const instanceActionAllowed = (action: InstanceAction, state: string) =>
  INSTANCE_ACTIONS[action].allowed.includes(state.trim().toLowerCase());

/** Why an action is unavailable, for the disabled button's tooltip. */
export function instanceActionBlocked(action: InstanceAction, state: string): string | null {
  if (instanceActionAllowed(action, state)) return null;
  const states = INSTANCE_ACTIONS[action].allowed.map((s) => s.replace('_', ' '));
  const allowed = states.length > 1 ? `${states.slice(0, -1).join(', ')} or ${states[states.length - 1]}` : states[0];
  return `${INSTANCE_ACTIONS[action].label} needs a ${allowed} instance; this one is ${state.replace('_', ' ') || 'unknown'}.`;
}
