import type { HostingCleanupPlan, HostingRetentionRules } from './hosting';

export function retentionRules(pendingHours: string, stagedHours: string, min: number, max: number): HostingRetentionRules | null {
  const pending = Number(pendingHours) * 3600, staged = Number(stagedHours) * 3600;
  if (!pendingHours.trim() || !stagedHours.trim() || !Number.isSafeInteger(pending) || !Number.isSafeInteger(staged) || pending < min || pending > max || staged < min || staged > max) return null;
  return { pending_age_seconds: pending, staged_age_seconds: staged };
}
export function retentionReviewCurrent(review: HostingCleanupPlan, current: HostingCleanupPlan, rules: HostingRetentionRules): boolean {
  return review.policy.site_id === current.policy.site_id && review.policy.revision === current.policy.revision && review.rules.pending_age_seconds === rules.pending_age_seconds && review.rules.staged_age_seconds === rules.staged_age_seconds;
}
const reasons: Record<string, string> = {
  site_ineligible: 'Site is not active with durable routing', active_release: 'Active release', previously_published: 'Previously published; retained for rollback and assets',
  active_preview: 'Referenced by a live preview', preview_cleanup_pending: 'Waiting for preview revocation and safe cleanup', ci_retry_window: 'Original CI retry window is still open',
  manual_staging: 'Manual staged release; retained for review', activity_unknown: 'Activity could not be established; retained', recent_activity: 'Upload or verification activity is too recent',
  abandoned_upload: 'Idle upload eligible for retirement', expired_ci_release: 'Expired CI release eligible for retirement',
  awaiting_retirement_publication: 'Retirement accepted; waiting for publication', retirement_grace_period: 'Waiting for deletion grace period', awaiting_artifact_cleanup: 'Artifact cleanup due; reservation retained until it succeeds',
};
export const cleanupReason = (reason: string) => reasons[reason] || 'Protected; refresh for current eligibility';
