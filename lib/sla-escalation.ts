/**
 * CONVERA — Action-Driven SLA Escalation Engine (محرك تصعيد مهلة SLA)
 *
 * Uses last_transition_at (Sprint E.1.5) as the definitive SLA start timestamp.
 *
 * CRITICAL RULE: Only escalate IF getAvailableActionsForClaim() returns
 * actionable items for the target recipient. No phantom escalations.
 *
 * SLA Rules (per stage):
 *   - Supervisor review:    3 working days  (warning at 70%, overdue at 100%)
 *   - Auditor review:       5 working days  (warning at 70%, overdue at 100%)
 *   - Reviewer check:       5 working days  (warning at 70%, overdue at 100%)
 *   - Director approval:    3 working days  (warning at 70%, overdue at 100%)
 *
 * Behavior:
 *   - Warning (70%):  notify current owner
 *   - Overdue (100%): notify current owner + director
 *
 * Does NOT:
 *   - Send notifications directly (returns payloads via notification-engine)
 *   - Modify claim status or workflow state
 *   - Change RLS or auth
 */

import {
  getNotificationsForClaimEvent,
  buildSLAEventContext,
  type NotificationPayload,
  type NotificationClaimContext,
  type RecipientContext,
} from './notification-engine';
import { getExpectedActorRole, getStageLabel } from './workflow-engine';
import type { ClaimStatus, UserRole, ContractRole } from './types';

// ─── SLA Configuration ──────────────────────────────────────────

export interface SLAConfig {
  /** Working days limit for this stage */
  limitDays: number;
  /** Percentage threshold for warning (0-1) */
  warningPct: number;
  /** Percentage threshold for overdue (0-1) */
  overduePct: number;
}

/** SLA limits per active review stage */
export const SLA_CONFIGS: Record<string, SLAConfig> = {
  under_supervisor_review:    { limitDays: 3, warningPct: 0.70, overduePct: 1.0 },
  under_auditor_review:       { limitDays: 5, warningPct: 0.70, overduePct: 1.0 },
  under_reviewer_check:       { limitDays: 5, warningPct: 0.70, overduePct: 1.0 },
  pending_director_approval:  { limitDays: 3, warningPct: 0.70, overduePct: 1.0 },
};

// ─── SLA Status Types ───────────────────────────────────────────

export type SLALevel = 'on_track' | 'warning' | 'overdue';

export interface SLAAssessment {
  /** Claim being assessed */
  claimId: string;
  claimNo: number | string;
  contractId: string;
  /** Current claim status */
  status: ClaimStatus;
  /** SLA configuration for this stage */
  config: SLAConfig;
  /** Working days elapsed since last_transition_at */
  daysElapsed: number;
  /** Calendar hours elapsed */
  hoursElapsed: number;
  /** Percentage of SLA consumed (0-100) */
  slaPct: number;
  /** SLA level */
  level: SLALevel;
  /** Human-readable Arabic description */
  description_ar: string;
  /** Which role is currently responsible */
  expectedRole: UserRole | null;
  /** Stage label in Arabic */
  stageLabel: string;
}

// ─── Business Day Calculation ───────────────────────────────────

/**
 * Calculate working days elapsed (excluding Saudi weekends: Fri + Sat)
 */
export function getWorkingDaysElapsed(startDate: Date, endDate: Date = new Date()): number {
  let workingDays = 0;
  const current = new Date(startDate);
  current.setHours(0, 0, 0, 0);

  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);

  while (current < end) {
    const day = current.getDay();
    // Friday (5) and Saturday (6) are Saudi weekends
    if (day !== 5 && day !== 6) {
      workingDays++;
    }
    current.setDate(current.getDate() + 1);
  }

  return workingDays;
}

/**
 * Calculate calendar hours elapsed
 */
export function getHoursElapsed(startDate: Date, endDate: Date = new Date()): number {
  return Math.max(0, (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60));
}

// ─── SLA Assessment ─────────────────────────────────────────────

/**
 * Assess the SLA status of a single claim.
 *
 * @param claim - Claim data with last_transition_at
 * @param lastTransitionAt - The definitive SLA start timestamp (Sprint E.1.5)
 */
export function assessClaimSLA(
  claim: { id: string; claim_no: number | string; contract_id: string; status: ClaimStatus },
  lastTransitionAt: string | null,
): SLAAssessment | null {
  const config = SLA_CONFIGS[claim.status];
  if (!config) return null; // Not a tracked stage

  if (!lastTransitionAt) return null; // No timestamp to measure from

  const startDate = new Date(lastTransitionAt);
  const now = new Date();
  const daysElapsed = getWorkingDaysElapsed(startDate, now);
  const hoursElapsed = getHoursElapsed(startDate, now);
  const slaPct = config.limitDays > 0 ? (daysElapsed / config.limitDays) * 100 : 0;

  let level: SLALevel = 'on_track';
  if (slaPct >= config.overduePct * 100) {
    level = 'overdue';
  } else if (slaPct >= config.warningPct * 100) {
    level = 'warning';
  }

  const stageLabel = getStageLabel(claim.status);
  const expectedRole = getExpectedActorRole(claim.status);

  let description_ar: string;
  if (level === 'overdue') {
    description_ar = `تجاوزت المهلة: ${daysElapsed} يوم عمل من أصل ${config.limitDays} — مرحلة "${stageLabel}"`;
  } else if (level === 'warning') {
    description_ar = `تحذير: ${daysElapsed} من أصل ${config.limitDays} يوم عمل — مرحلة "${stageLabel}"`;
  } else {
    description_ar = `${daysElapsed} من أصل ${config.limitDays} يوم عمل — مرحلة "${stageLabel}"`;
  }

  return {
    claimId: claim.id,
    claimNo: claim.claim_no,
    contractId: claim.contract_id,
    status: claim.status,
    config,
    daysElapsed,
    hoursElapsed,
    slaPct: Math.round(slaPct),
    level,
    description_ar,
    expectedRole,
    stageLabel,
  };
}

// ─── Batch SLA Assessment ───────────────────────────────────────

/**
 * Assess SLA for multiple claims and categorize by level.
 */
export function assessBatchSLA(
  claims: Array<{
    id: string;
    claim_no: number | string;
    contract_id: string;
    status: ClaimStatus;
    last_transition_at: string | null;
  }>,
): {
  onTrack: SLAAssessment[];
  warnings: SLAAssessment[];
  overdue: SLAAssessment[];
  all: SLAAssessment[];
} {
  const result = {
    onTrack: [] as SLAAssessment[],
    warnings: [] as SLAAssessment[],
    overdue: [] as SLAAssessment[],
    all: [] as SLAAssessment[],
  };

  for (const claim of claims) {
    const assessment = assessClaimSLA(claim, claim.last_transition_at);
    if (!assessment) continue;

    result.all.push(assessment);
    switch (assessment.level) {
      case 'on_track': result.onTrack.push(assessment); break;
      case 'warning':  result.warnings.push(assessment); break;
      case 'overdue':  result.overdue.push(assessment); break;
    }
  }

  return result;
}

// ─── SLA Escalation Notifications ───────────────────────────────

/**
 * Generate notification payloads for SLA escalations.
 *
 * CRITICAL: Only sends if recipient has executable actions (via action-engine).
 *
 * @param assessment - SLA assessment for the claim
 * @param claimContext - Full claim context for notification-engine
 * @param recipients - Potential recipients (current owner + director for overdue)
 * @param documents - Document state for action validation
 */
export function generateSLANotifications(
  assessment: SLAAssessment,
  claimContext: NotificationClaimContext,
  recipients: RecipientContext[],
  documents: { type: string }[],
): NotificationPayload[] {
  if (assessment.level === 'on_track') return [];

  const event = assessment.level === 'overdue' ? 'sla.overdue' : 'sla.warning';

  const eventCtx = buildSLAEventContext(
    event,
    claimContext,
    recipients,
    documents,
    assessment.daysElapsed,
  );

  // getNotificationsForClaimEvent validates each recipient against action-engine
  return getNotificationsForClaimEvent(eventCtx);
}

// ─── Dashboard SLA Summary ──────────────────────────────────────

export interface SLADashboardSummary {
  totalTracked: number;
  onTrackCount: number;
  warningCount: number;
  overdueCount: number;
  /** Claims sorted by urgency (overdue first, then warning) */
  urgentClaims: SLAAssessment[];
}

/**
 * Build a dashboard-friendly SLA summary.
 */
export function buildSLADashboardSummary(
  claims: Array<{
    id: string;
    claim_no: number | string;
    contract_id: string;
    status: ClaimStatus;
    last_transition_at: string | null;
  }>,
): SLADashboardSummary {
  const batch = assessBatchSLA(claims);

  const urgentClaims = [...batch.overdue, ...batch.warnings]
    .sort((a, b) => b.slaPct - a.slaPct);

  return {
    totalTracked: batch.all.length,
    onTrackCount: batch.onTrack.length,
    warningCount: batch.warnings.length,
    overdueCount: batch.overdue.length,
    urgentClaims,
  };
}
