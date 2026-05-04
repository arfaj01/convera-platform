/**
 * CONVERA SLA Engine — Per-stage timers, escalation, and analytics
 *
 * SLA rules (Phase 2.6 commit #6 — driven by SLA_PER_STAGE_MAP in
 * lib/constants.ts, the single source of truth):
 *   - under_supervisor_review (Engineering Consultant):  3 wd, warn at 2
 *   - under_technical_review  (Technical Unit):          3 wd, warn at 2
 *   - under_quality_review    (Quality Unit):            1 wd (same-day)
 *   - under_project_manager_review:                       NO SLA — skipped
 *   - pending_director_approval:                          3 wd default
 *   - Legacy under_auditor_review / under_reviewer_check: 5 wd
 *
 * Stages without an entry in SLA_PER_STAGE_MAP are NOT tracked. The
 * default 7-working-day fallback (DEFAULT_SLA below) only applies if
 * an unknown status is passed (defensive).
 *
 * This module is used both server-side (API routes, scheduled jobs)
 * and client-side (dashboard display).
 */

// ─── Types ────────────────────────────────────────────────────────

export type ClaimStageSLA = {
  stage:            string;
  slaWorkingDays:   number;
  warnAtDays:       number;
  escalateAtDays:   number;
};

export type SLAStatus = 'on_track' | 'warning' | 'breached' | 'escalated';

export interface SLAResult {
  stage:             string;
  enteredAt:         Date;
  workingDaysElapsed: number;
  calendarDaysElapsed: number;
  slaWorkingDays:    number;
  status:            SLAStatus;
  hoursRemaining:    number;
  breachAt:          Date;
  warnAt:            Date;
  percentageUsed:    number;
}

export interface WorkflowAnalytics {
  claimId:               string;
  totalCalendarDays:     number;
  totalWorkingDays:      number;
  stageBreakdown:        StageTime[];
  bottleneckStage:       string | null;
  avgDaysPerStage:       number;
  slaBreaches:           number;
  currentSLA:            SLAResult | null;
}

export interface StageTime {
  stage:       string;
  enteredAt:   string;
  exitedAt:    string | null;
  daysSpent:   number;
  breached:    boolean;
}

// ─── SLA Configuration ───────────────────────────────────────────

import { SLA_PER_STAGE_MAP, type StageSLA } from './constants';
import type { ClaimStatus } from './types';

/**
 * Build the engine-shaped config from the canonical per-stage map.
 * Phase 2.6: SLA_PER_STAGE_MAP in lib/constants.ts is the single
 * source of truth; this local table simply reshapes its entries
 * into ClaimStageSLA (with `stage`, `slaWorkingDays`, `warnAtDays`,
 * `escalateAtDays`) for backward compatibility with the existing
 * calculateSLA / computeWorkflowAnalytics API.
 *
 * Stages absent from SLA_PER_STAGE_MAP (e.g.
 * `under_project_manager_review`) get NO entry here — `getStageSLA`
 * returns null for them, and `calculateSLA` then short-circuits
 * with `status: 'on_track'` (no warning, no breach).
 */
const SLA_CONFIG: Record<string, ClaimStageSLA> = (() => {
  const out: Record<string, ClaimStageSLA> = {};
  for (const stage of Object.keys(SLA_PER_STAGE_MAP) as ClaimStatus[]) {
    const sla: StageSLA | undefined = SLA_PER_STAGE_MAP[stage];
    if (!sla) continue;
    out[stage] = {
      stage,
      slaWorkingDays:  sla.breachDays,
      warnAtDays:      sla.warningDays,
      escalateAtDays:  sla.breachDays,
    };
  }
  return out;
})();

/**
 * Defensive fallback for unknown stages. New tracked stages should be
 * added to SLA_PER_STAGE_MAP, NOT propagated here. Stages that are
 * intentionally untracked (project_manager) bypass calculateSLA entirely
 * via the `untracked` early-return below — they never hit this default.
 */
const DEFAULT_SLA: Omit<ClaimStageSLA, 'stage'> = {
  slaWorkingDays:  7,
  warnAtDays:      5,
  escalateAtDays:  7,
};

/** Returns true if the stage has an SLA entry in SLA_PER_STAGE_MAP. */
export function isStageSLATracked(stage: string): boolean {
  return Object.prototype.hasOwnProperty.call(SLA_CONFIG, stage);
}

// ─── Working Day Calculator ───────────────────────────────────────

/**
 * Count working days (Saturday = day, Sunday–Thursday working week in SA)
 * Saudi working week: Sunday to Thursday (0=Sun, 1=Mon, ..., 5=Fri, 6=Sat)
 * Weekends: Friday (5) and Saturday (6)
 */
function countWorkingDays(from: Date, to: Date): number {
  let count  = 0;
  const curr = new Date(from);
  curr.setHours(0, 0, 0, 0);
  const end  = new Date(to);
  end.setHours(0, 0, 0, 0);

  while (curr < end) {
    const day = curr.getDay();
    if (day !== 5 && day !== 6) count++; // not Friday/Saturday
    curr.setDate(curr.getDate() + 1);
  }
  return count;
}

/**
 * Add working days to a date (skip Friday/Saturday)
 */
function addWorkingDays(from: Date, days: number): Date {
  const result = new Date(from);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 5 && day !== 6) added++;
  }
  return result;
}

// ─── Core SLA Calculator ──────────────────────────────────────────

/**
 * Calculate SLA status for a claim in a given stage.
 *
 * Phase 2.6 (commit #6): stages absent from SLA_PER_STAGE_MAP (e.g.
 * `under_project_manager_review`) are treated as untracked — the
 * function still returns an SLAResult so callers don't need to
 * special-case them, but the `status` is forced to `'on_track'`,
 * `slaWorkingDays` carries the defensive default (7), and
 * `percentageUsed` stays at 0. UI surfaces should hide the SLA badge
 * for untracked stages (use `isStageSLATracked` to gate display).
 *
 * @param stage - Current claim status
 * @param enteredAt - When the claim entered this stage
 * @param now - Reference "now" (default: current time, override for testing)
 */
export function calculateSLA(
  stage: string,
  enteredAt: Date,
  now: Date = new Date(),
): SLAResult {
  const tracked = isStageSLATracked(stage);
  const config = tracked
    ? SLA_CONFIG[stage]
    : { stage, ...DEFAULT_SLA };

  const workingDaysElapsed   = countWorkingDays(enteredAt, now);
  const calendarDaysElapsed  = Math.floor((now.getTime() - enteredAt.getTime()) / (1000 * 60 * 60 * 24));

  const warnAt    = addWorkingDays(enteredAt, config.warnAtDays);
  const breachAt  = addWorkingDays(enteredAt, config.escalateAtDays);

  const msRemaining    = breachAt.getTime() - now.getTime();
  const hoursRemaining = Math.max(0, msRemaining / (1000 * 60 * 60));
  const percentageUsed = tracked
    ? Math.min(100, (workingDaysElapsed / config.slaWorkingDays) * 100)
    : 0;

  let status: SLAStatus = 'on_track';
  if (tracked) {
    if (workingDaysElapsed >= config.escalateAtDays) status = 'breached';
    else if (workingDaysElapsed >= config.warnAtDays) status = 'warning';
  }

  return {
    stage,
    enteredAt,
    workingDaysElapsed,
    calendarDaysElapsed,
    slaWorkingDays: config.slaWorkingDays,
    status,
    hoursRemaining,
    breachAt,
    warnAt,
    percentageUsed,
  };
}

// ─── Workflow Analytics ───────────────────────────────────────────

/**
 * Compute full workflow analytics for a claim from its audit trail.
 * Pass claim_workflow rows sorted by created_at ASC.
 */
export function computeWorkflowAnalytics(
  claimId: string,
  workflowRows: Array<{
    to_status:   string;
    from_status: string | null;
    created_at:  string;
  }>,
): WorkflowAnalytics {
  const stageBreakdown: StageTime[] = [];

  for (let i = 0; i < workflowRows.length; i++) {
    const row     = workflowRows[i];
    const nextRow = workflowRows[i + 1];

    const enteredAt = new Date(row.created_at);
    const exitedAt  = nextRow ? new Date(nextRow.created_at) : null;

    const daysSpent = exitedAt
      ? countWorkingDays(enteredAt, exitedAt)
      : countWorkingDays(enteredAt, new Date());

    // Phase 2.6: untracked stages (e.g. under_project_manager_review)
    // never count as breached — they have no SLA threshold.
    const tracked = isStageSLATracked(row.to_status);
    const config  = tracked
      ? SLA_CONFIG[row.to_status]
      : { stage: row.to_status, ...DEFAULT_SLA };
    const breached = tracked && daysSpent >= config.slaWorkingDays;

    stageBreakdown.push({
      stage:     row.to_status,
      enteredAt: row.created_at,
      exitedAt:  nextRow?.created_at ?? null,
      daysSpent,
      breached,
    });
  }

  const slaBreaches = stageBreakdown.filter(s => s.breached).length;

  // Bottleneck = stage with most days spent
  const bottleneck = stageBreakdown.reduce(
    (prev, curr) => curr.daysSpent > prev.daysSpent ? curr : prev,
    stageBreakdown[0] ?? { stage: null, daysSpent: 0 },
  );

  const totalWorkingDays = stageBreakdown.reduce((s, r) => s + r.daysSpent, 0);
  const totalCalendarDays = stageBreakdown.length > 0
    ? Math.floor(
        (new Date().getTime() - new Date(stageBreakdown[0].enteredAt).getTime())
        / (1000 * 60 * 60 * 24),
      )
    : 0;

  const avgDaysPerStage = stageBreakdown.length > 0
    ? totalWorkingDays / stageBreakdown.length
    : 0;

  // Current SLA: based on last active stage
  const lastActive = workflowRows[workflowRows.length - 1];
  const currentSLA = lastActive
    ? calculateSLA(lastActive.to_status, new Date(lastActive.created_at))
    : null;

  return {
    claimId,
    totalCalendarDays,
    totalWorkingDays,
    stageBreakdown,
    bottleneckStage: bottleneck?.stage ?? null,
    avgDaysPerStage,
    slaBreaches,
    currentSLA,
  };
}

// ─── SLA Status Display Helpers ───────────────────────────────────

export const SLA_STATUS_LABELS: Record<SLAStatus, string> = {
  on_track:  'في الوقت',
  warning:   'تنبيه',
  breached:  'تجاوز',
  escalated: 'تصعيد',
};

export const SLA_STATUS_COLORS: Record<SLAStatus, string> = {
  on_track:  '#87BA26',
  warning:   '#FFC845',
  breached:  '#C05728',
  escalated: '#8B0000',
};

export const SLA_STATUS_BG: Record<SLAStatus, string> = {
  on_track:  '#F0F7E0',
  warning:   '#FFF8E0',
  breached:  '#FAEEE8',
  escalated: '#FAEAEA',
};
