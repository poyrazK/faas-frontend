'use client';

import React, { useState } from 'react';
import { forceParkInstance, forceRestartInstance, type ObsInstanceRow } from '@/lib/api';
import { REASON_SUGGESTIONS } from '@/lib/operator';
import { INSTANCE_ACTIONS, instanceActionBlocked, type InstanceAction } from '@/lib/ops/instances';
import { OperatorActionDialog } from './OperatorActionDialog';
import { useOperatorIntents } from './OperatorIntents';
import { EntityId, shortId } from './EntityId';

type InstanceTarget = Pick<ObsInstanceRow, 'id' | 'state' | 'app_slug' | 'node_name' | 'ram_mb'>;

/**
 * Force park / force restart for one instance, right where it is listed.
 * Buttons are disabled (with the reason) for states apid would refuse; the
 * accepted intent is tracked like any other operator action.
 */
export function InstanceActions({ instance, onDone }: { instance: InstanceTarget; onDone?: () => void }) {
  const { track } = useOperatorIntents();
  const [pending, setPending] = useState<InstanceAction | null>(null);
  const action = pending ? INSTANCE_ACTIONS[pending] : null;
  const confirm = instance.id.slice(0, 8);

  return (
    <>
      <div className="flex justify-end gap-1.5">
        {(Object.keys(INSTANCE_ACTIONS) as InstanceAction[]).map((kind) => {
          const blocked = instanceActionBlocked(kind, instance.state);
          return (
            <button
              key={kind}
              type="button"
              className={`btn btn-xs ${INSTANCE_ACTIONS[kind].tone === 'danger' ? 'btn-danger' : 'btn-secondary'}`}
              disabled={!!blocked}
              title={blocked ?? `${INSTANCE_ACTIONS[kind].label} ${instance.id}`}
              onClick={() => setPending(kind)}
            >
              {INSTANCE_ACTIONS[kind].button}
            </button>
          );
        })}
      </div>

      {pending && action && (
        <OperatorActionDialog
          open
          title={`${action.label}: ${instance.app_slug || shortId(instance.id)}`}
          tone={action.tone}
          reason="code"
          reasonSuggestions={REASON_SUGGESTIONS.instance}
          confirmText={pending === 'force_restart' ? confirm : undefined}
          submitLabel={action.label}
          fingerprint={`${pending}|${instance.id}`}
          impact={
            <div className="space-y-1.5">
              <p>{action.impact}</p>
              <p className="text-xs text-[var(--color-ink-soft)]">
                Instance <EntityId id={instance.id} kind="instance" full />
                {instance.app_slug ? ` of ${instance.app_slug}` : ''}
                {instance.node_name ? ` on ${instance.node_name}` : ''} · currently {instance.state.replace('_', ' ')}
                {instance.ram_mb ? ` · ${instance.ram_mb} MB` : ''}.
              </p>
            </div>
          }
          onClose={() => setPending(null)}
          onSubmit={async ({ reason, idempotencyKey }) => {
            const run = pending === 'force_park' ? forceParkInstance : forceRestartInstance;
            const res = await run(instance.id, reason, { idempotencyKey });
            track({ intentId: res.intent_id, kind: pending, target: instance.app_slug ? `${instance.app_slug} · ${shortId(instance.id)}` : instance.id });
            onDone?.();
            return `${action.label} queued for ${shortId(instance.id)}; follow it in the actions tracker.`;
          }}
        />
      )}
    </>
  );
}
