/**
 * CONVERA — Governance Alerts Engine (محرك التنبيهات الرقابية)
 *
 * Detects governance issues:
 *   1. Contract without active supervisor
 *   2. Claim overdue beyond threshold
 *   3. Repeated returns (> N times)
 *   4. Stage delay beyond threshold
 *
 * Read-only intelligence — does NOT modify any data.
 *
 * Does NOT:
 *   - Modify RLS, auth, or workflow states
 *   - Duplicate action-engine logic
 */

import { SLA_CONFIGS, getWorkingDaysElapsed } from './sla-escalation';
import { getStageLabel } from './workflow-engine';
import type { ClaimStatus } from './types';

// ─── Types ──────────────────────────────────────────────────────

export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertCategory = 'supervisor' | 'overdue' | 'returns' | 'delay' | 'governance';

export interface GovernanceAlert {
  /** Unique alert identifier */
  id: string;
  /** Alert category */
  category: AlertCategory;
  /** Severity level */
  severity: AlertSeverity;
  /** Arabic title */
  title_ar: string;
  /** Arabic description */
  description_ar: string;
  /** Related entity type */
  entityType: 'contract' | 'claim';
  /** Related entity ID */
  entityId: string;
  /** Additional display info */
  entityLabel: string;
  /** Timestamp of detection */
  detectedAt: string;
  /** Metadata for linking/routing */
  metadata: Record<string, unknown>;
}

// ─── Alert Thresholds ───────────────────────────────────────────

export const ALERT_THRESHOLDS = {
  /** Days overdue before critical alert */
  overdueCriticalDays: 5,
  /** Days overdue before warning alert */
  overdueWarningDays: 0, // Any overdue
  /** Number of returns before warning */
  repeatedReturnsWarning: 2,
  /** Number of returns before critical */
  repeatedReturnsCritical: 3,
  /** Stage delay multiplier for warning (× SLA limit) */
  stageDelayWarning: 1.5,
  /** Stage delay multiplier for critical (× SLA limit) */
  stageDelayCritical: 2.0,
};

// ─── Input Types ────────────────────────────────────────────────

export interface AlertContract {
  id: string;
  contract_no: string;
  title_ar: string | null;
  status: string;
}

export interface AlertClaim {
  id: string;
  claim_no: number | string;
  contract_id: string;
  status: ClaimStatus;
  last_transition_at: string | null;
  return_reason: string | null;
}

export interface AlertWorkflowEvent {
  claim_id: string;
  action: string;
  from_status: string;
  to_status: string;
  created_at: string;
}

export interface AlertSupervisorRole {
  contract_id: string;
  user_id: string;
  is_active: boolean;
}

// ─── Core Engine ────────────────────────────────────────────────

/**
 * Generate all governance alerts for the current system state.
 */
export function generateGovernanceAlerts(input: {
  contracts: AlertContract[];
  claims: AlertClaim[];
  workflowEvents: AlertWorkflowEvent[];
  supervisorRoles: AlertSupervisorRole[];
}): GovernanceAlert[] {
  const alerts: GovernanceAlert[] = [];
  const now = new Date().toISOString();

  // 1. Contracts without active supervisor
  alerts.push(...checkMissingSupervisors(input.contracts, input.supervisorRoles, now));

  // 2. Overdue claims
  alerts.push(...checkOverdueClaims(input.claims, input.contracts, now));

  // 3. Repeated returns
  alerts.push(...checkRepeatedReturns(input.claims, input.workflowEvents, input.contracts, now));

  // 4. Stage delay beyond threshold
  alerts.push(...checkStageDelays(input.claims, input.contracts, now));

  // Sort by severity (critical first), then by detected time
  const severityOrder: Record<AlertSeverity, number> = { critical: 2, warning: 1, info: 0 };
  alerts.sort((a, b) => {
    const sevDiff = severityOrder[b.severity] - severityOrder[a.severity];
    if (sevDiff !== 0) return sevDiff;
    return b.detectedAt.localeCompare(a.detectedAt);
  });

  return alerts;
}

// ─── Alert Generators ───────────────────────────────────────────

/**
 * Alert 1: Contract without active supervisor
 */
function checkMissingSupervisors(
  contracts: AlertContract[],
  supervisorRoles: AlertSupervisorRole[],
  now: string,
): GovernanceAlert[] {
  const alerts: GovernanceAlert[] = [];

  // Build set of contracts with active supervisors
  const contractsWithSupervisor = new Set<string>();
  for (const role of supervisorRoles) {
    if (role.is_active) {
      contractsWithSupervisor.add(role.contract_id);
    }
  }

  for (const contract of contracts) {
    if (contract.status !== 'active') continue;

    if (!contractsWithSupervisor.has(contract.id)) {
      alerts.push({
        id: `sup-missing-${contract.id}`,
        category: 'supervisor',
        severity: 'critical',
        title_ar: `عقد بدون جهة إشراف نشطة`,
        description_ar: `العقد ${contract.contract_no}${contract.title_ar ? ` — ${contract.title_ar}` : ''} ليس لديه جهة إشراف معينة ونشطة. لن يتمكن المقاولون من تقديم مطالبات على هذا العقد.`,
        entityType: 'contract',
        entityId: contract.id,
        entityLabel: contract.contract_no,
        detectedAt: now,
        metadata: { contractNo: contract.contract_no },
      });
    }
  }

  return alerts;
}

/**
 * Alert 2: Claim overdue beyond threshold
 */
function checkOverdueClaims(
  claims: AlertClaim[],
  contracts: AlertContract[],
  now: string,
): GovernanceAlert[] {
  const alerts: GovernanceAlert[] = [];

  const contractMap = new Map<string, AlertContract>();
  for (const c of contracts) contractMap.set(c.id, c);

  for (const claim of claims) {
    const config = SLA_CONFIGS[claim.status];
    if (!config || !claim.last_transition_at) continue;

    const daysElapsed = getWorkingDaysElapsed(new Date(claim.last_transition_at));
    const daysOverdue = daysElapsed - config.limitDays;

    if (daysOverdue <= 0) continue;

    const contract = contractMap.get(claim.contract_id);
    const stageLabel = getStageLabel(claim.status);

    const severity: AlertSeverity = daysOverdue >= ALERT_THRESHOLDS.overdueCriticalDays
      ? 'critical'
      : 'warning';

    alerts.push({
      id: `overdue-${claim.id}`,
      category: 'overdue',
      severity,
      title_ar: `مطالبة #${claim.claim_no} متأخرة ${daysOverdue} يوم عمل`,
      description_ar: `المطالبة رقم ${claim.claim_no} في مرحلة "${stageLabel}" منذ ${daysElapsed} يوم عمل (المهلة: ${config.limitDays} يوم). العقد: ${contract?.contract_no || '—'}.`,
      entityType: 'claim',
      entityId: claim.id,
      entityLabel: `#${claim.claim_no}`,
      detectedAt: now,
      metadata: {
        claimNo: claim.claim_no,
        contractNo: contract?.contract_no,
        stage: claim.status,
        daysElapsed,
        daysOverdue,
        slaLimit: config.limitDays,
      },
    });
  }

  return alerts;
}

/**
 * Alert 3: Repeated returns (> N times)
 */
function checkRepeatedReturns(
  claims: AlertClaim[],
  workflowEvents: AlertWorkflowEvent[],
  contracts: AlertContract[],
  now: string,
): GovernanceAlert[] {
  const alerts: GovernanceAlert[] = [];

  const contractMap = new Map<string, AlertContract>();
  for (const c of contracts) contractMap.set(c.id, c);

  // Count returns per claim
  const returnCounts = new Map<string, number>();
  for (const ev of workflowEvents) {
    if (ev.action === 'return') {
      returnCounts.set(ev.claim_id, (returnCounts.get(ev.claim_id) || 0) + 1);
    }
  }

  for (const claim of claims) {
    const returnCount = returnCounts.get(claim.id) || 0;

    if (returnCount < ALERT_THRESHOLDS.repeatedReturnsWarning) continue;

    const contract = contractMap.get(claim.contract_id);
    const severity: AlertSeverity = returnCount >= ALERT_THRESHOLDS.repeatedReturnsCritical
      ? 'critical'
      : 'warning';

    alerts.push({
      id: `returns-${claim.id}`,
      category: 'returns',
      severity,
      title_ar: `مطالبة #${claim.claim_no} أُرجعت ${returnCount} مرات`,
      description_ar: `المطالبة رقم ${claim.claim_no} تم إرجاعها ${returnCount} مرة${returnCount >= ALERT_THRESHOLDS.repeatedReturnsCritical ? ' — يتطلب مراجعة فورية من الإدارة' : ''}. العقد: ${contract?.contract_no || '—'}.`,
      entityType: 'claim',
      entityId: claim.id,
      entityLabel: `#${claim.claim_no}`,
      detectedAt: now,
      metadata: {
        claimNo: claim.claim_no,
        contractNo: contract?.contract_no,
        returnCount,
      },
    });
  }

  return alerts;
}

/**
 * Alert 4: Stage delay beyond threshold (× SLA limit)
 */
function checkStageDelays(
  claims: AlertClaim[],
  contracts: AlertContract[],
  now: string,
): GovernanceAlert[] {
  const alerts: GovernanceAlert[] = [];

  const contractMap = new Map<string, AlertContract>();
  for (const c of contracts) contractMap.set(c.id, c);

  for (const claim of claims) {
    const config = SLA_CONFIGS[claim.status];
    if (!config || !claim.last_transition_at) continue;

    const daysElapsed = getWorkingDaysElapsed(new Date(claim.last_transition_at));
    const ratio = daysElapsed / config.limitDays;

    // Only alert for severe delays (beyond the basic overdue alert)
    if (ratio < ALERT_THRESHOLDS.stageDelayWarning) continue;

    // Skip if already covered by overdue alert at the same level
    // Only add stage delay alert for extreme cases (2× SLA)
    if (ratio < ALERT_THRESHOLDS.stageDelayCritical) continue;

    const contract = contractMap.get(claim.contract_id);
    const stageLabel = getStageLabel(claim.status);

    alerts.push({
      id: `delay-${claim.id}-${claim.status}`,
      category: 'delay',
      severity: 'critical',
      title_ar: `تأخير شديد: مطالبة #${claim.claim_no} في "${stageLabel}" منذ ${daysElapsed} يوم`,
      description_ar: `المطالبة رقم ${claim.claim_no} تجاوزت ضعف المهلة المسموحة في مرحلة "${stageLabel}" (${daysElapsed} يوم عمل من أصل ${config.limitDays}). العقد: ${contract?.contract_no || '—'}. يتطلب تدخلاً فورياً.`,
      entityType: 'claim',
      entityId: claim.id,
      entityLabel: `#${claim.claim_no}`,
      detectedAt: now,
      metadata: {
        claimNo: claim.claim_no,
        contractNo: contract?.contract_no,
        stage: claim.status,
        daysElapsed,
        slaLimit: config.limitDays,
        delayRatio: Math.round(ratio * 10) / 10,
      },
    });
  }

  return alerts;
}

// ─── Summary Builder ────────────────────────────────────────────

export interface GovernanceAlertSummary {
  totalAlerts: number;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  byCategory: Record<AlertCategory, number>;
  alerts: GovernanceAlert[];
}

/**
 * Build a summary of all governance alerts.
 */
export function buildAlertSummary(alerts: GovernanceAlert[]): GovernanceAlertSummary {
  const byCategory: Record<AlertCategory, number> = {
    supervisor: 0,
    overdue: 0,
    returns: 0,
    delay: 0,
    governance: 0,
  };

  let criticalCount = 0;
  let warningCount = 0;
  let infoCount = 0;

  for (const alert of alerts) {
    byCategory[alert.category]++;
    switch (alert.severity) {
      case 'critical': criticalCount++; break;
      case 'warning': warningCount++; break;
      case 'info': infoCount++; break;
    }
  }

  return {
    totalAlerts: alerts.length,
    criticalCount,
    warningCount,
    infoCount,
    byCategory,
    alerts,
  };
}
