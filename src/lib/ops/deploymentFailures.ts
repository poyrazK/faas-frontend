/* ==========================================================================
   Why deployments fail, grouped: the same failure repeats across apps with
   only sizes, IDs and counters changed ("available=21436325888 bytes"), so
   on-call reads a long list of near-identical rows to find one cause.

   Grouping strips what varies between occurrences and keeps the words, so
   each group is apid's own error text with the varying parts replaced. It
   invents no cause names: what an operator sees is what apid recorded.
   ========================================================================== */

import type { OperatorDeployment } from './workloads';

export interface FailureCause {
  /** Short, stable ID for the URL (?cause=…); derived from the signature. */
  id: string;
  code: string;
  /** apid's error with IDs as "<id>" and numbers as "N". */
  message: string;
  /** One recorded error verbatim, for the tooltip. */
  example: string;
  deployments: OperatorDeployment[];
  apps: number;
  accounts: number;
  latest: string;
}

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
/** Commit SHAs, image digests and other hex IDs: a digit and a letter, so words and plain numbers stay. */
const HEX_ID = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,}\b/gi;
/** Sizes, counts and codes, but not digits inside a name ("drive1", "p95"). */
const NUMBER = /(?<![\w.])\d+(?:\.\d+)?(?![A-Za-z_])/g;

/** apid's error with what varies between occurrences replaced. */
export function failureSignature(error: string): string {
  return error.replace(UUID, '<id>').replace(HEX_ID, '<id>').replace(NUMBER, 'N').replace(/\s+/g, ' ').trim();
}

/** FNV-1a: a short ID that stays the same for the same signature. */
function shortHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Failed deployments grouped by error code and signature, most frequent
 * first (ties: most recent first). Deployments in other states are ignored.
 */
export function groupFailureCauses(deployments: OperatorDeployment[]): FailureCause[] {
  const groups = new Map<string, FailureCause & { appIds: Set<string>; accountIds: Set<string> }>();
  for (const deployment of deployments) {
    if (deployment.status !== 'failed') continue;
    const code = deployment.error_code ?? '';
    const message = deployment.error ? failureSignature(deployment.error) : '';
    const key = `${code}|${message}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        id: shortHash(key),
        code,
        message,
        example: [code, deployment.error].filter(Boolean).join(': '),
        deployments: [],
        apps: 0,
        accounts: 0,
        latest: deployment.created_at,
        appIds: new Set(),
        accountIds: new Set(),
      };
      groups.set(key, group);
    }
    group.deployments.push(deployment);
    group.appIds.add(deployment.app_id);
    group.accountIds.add(deployment.account_id);
    if (Date.parse(deployment.created_at) > Date.parse(group.latest)) group.latest = deployment.created_at;
  }
  return [...groups.values()]
    .map(({ appIds, accountIds, ...group }) => ({ ...group, apps: appIds.size, accounts: accountIds.size }))
    .sort((a, b) => b.deployments.length - a.deployments.length || Date.parse(b.latest) - Date.parse(a.latest));
}
