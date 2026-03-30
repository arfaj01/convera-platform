/**
 * CONVERA — Performance Analytics Engine (محرك تحليل الأداء)
 *
 * Read-only intelligence layer for:
 *   - Stage performance metrics (avg duration, SLA breach %, volume)
 *   - User performance metrics (handling time, volume, breach rate)
 *   - Contract performance metrics (delay rate, risk score)
 *
 * Data sources:
 *   - claims (status, last_transition_at)
 *   - claim_workflow (from_status, to_status, created_at, actor_id)
 *   - user_contract_roles (contract role assignments)
 *   - SLA configs from sla-escalation.ts
 *
 * Does NOT:
 *   - Modify any data
 *   - Change RLS, auth, or workflow states
 *   - Duplicate logic from action-engine
 */

import { SLA_CONFIGS, getWorkingDaysElapsed, type SLAConfig, type SLALevel } from './sla-escalation';
import { getStageLabel, getExpectedActorRole } from './workflow-engine';
import type { ClaimStatus, UserRole } from './types';

// ─── Types ──────────────────────────────────────────────────────

/** A workflow event row from claim_workflow table */
export interface WorkflowEvent {
  id: string;
  claim_id: string;
  action: string;
  from_status: string;
  to_status: string;
  actor_id: string;
  notes: string | null;
  created_at: string;
}

/** A claim row with fields needed for performance analysis */
export interface PerformanceClaim {
  id: string;
  claim_no: number | string;
  contract_id: string;
  status: ClaimStatus;
  total_amount: number;
  submitted_at: string | null;
  approved_at: string | null;
  last_transition_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A contract row with fields needed for performance analysis */
export interface PerformanceContract {
  id: string;
  contract_no: string;
  title_ar: string | null;
  base_value: number;
  status: string;
}

/** Profile for user performance */
export interface PerformanceProfile {
  id: string;
  full_name_ar: string | null;
  full_name: string;
  role: UserRole;
}

// ─── Stage Performance ──────────────────────────────────────────

export interface StagePerformance {
  stage: ClaimStatus;
  stageLabel: string;
  /** Average working days spent in this stage */
  avgDuration: number;
  /** Median working days */
  medianDuration: number;
  /** Max working days seen */
  maxDuration: number;
  /** Number of claims that passed through this stage */
  totalVolume: number;
  /** Number currently in this stage */
  activeCount: number;
  /** SLA breach percentage (0-100) */
  slaBreachPct: number;
  /** Number of SLA breaches */
  slaBreachCount: number;
  /** SLA config for this stage */
  slaConfig: SLAConfig | null;
  /** Is this the worst-performing stage? */
  isBottleneck: boolean;
}

/**
 * Calculate stage-by-stage performance from workflow events.
 *
 * Logic: For each claim, find pairs of (entered_stage, left_stage) from workflow events
 * and compute the working days spent. For active claims still in a stage, use NOW().
 */
export function getStagePerformance(
  claims: PerformanceClaim[],
  workflowEvents: WorkflowEvent[],
): StagePerformance[] {
  const trackedStages: ClaimStatus[] = [
    'under_supervisor_review',
    'under_auditor_review',
    'under_reviewer_check',
    'pending_director_approval',
  ];

  // Group workflow events by claim
  const eventsByClaim = new Map<string, WorkflowEvent[]>();
  for (const ev of workflowEvents) {
    const arr = eventsByClaim.get(ev.claim_id) || [];
    arr.push(ev);
    eventsByClaim.set(ev.claim_id, arr);
  }

  // Sort events per claim chronologically
  Array.from(eventsByClaim.values()).forEach(evs => {
    evs.sort((a: WorkflowEvent, b: WorkflowEvent) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  });

  // Build active claim counts
  const activeCounts = new Map<ClaimStatus, number>();
  for (const c of claims) {
    if (trackedStages.includes(c.status)) {
      activeCounts.set(c.status, (activeCounts.get(c.status) || 0) + 1);
    }
  }

  const results: StagePerformance[] = [];
  let worstBreachPct = -1;
  let worstStage: ClaimStatus | null = null;

  for (const stage of trackedStages) {
    const config = SLA_CONFIGS[stage] || null;
    const durations: number[] = [];
    let breachCount = 0;

    // For each claim, find time spent in this stage
    for (const claim of claims) {
      const events = eventsByClaim.get(claim.id) || [];

      // Find enter event (to_status = this stage)
      const enterIdx = events.findIndex(e => e.to_status === stage);
      if (enterIdx === -1) continue;

      const enterTime = new Date(events[enterIdx].created_at);

      // Find exit event (from_status = this stage, after enter)
      const exitIdx = events.findIndex((e, i) => i > enterIdx && e.from_status === stage);

      let exitTime: Date;
      if (exitIdx !== -1) {
        exitTime = new Date(events[exitIdx].created_at);
      } else if (claim.status === stage) {
        // Still active in this stage — use now
        exitTime = new Date();
      } else {
        continue;
      }

      const days = getWorkingDaysElapsed(enterTime, exitTime);
      durations.push(days);

      // Check SLA breach
      if (config && days > config.limitDays) {
        breachCount++;
      }
    }

    const totalVolume = durations.length;
    const avgDuration = totalVolume > 0
      ? Math.round((durations.reduce((a: number, b: number) => a + b, 0) / totalVolume) * 10) / 10
      : 0;
    const medianDuration = totalVolume > 0
      ? getMedian(durations)
      : 0;
    const maxDuration = totalVolume > 0 ? Math.max(...durations) : 0;
    const slaBreachPct = totalVolume > 0
      ? Math.round((breachCount / totalVolume) * 100)
      : 0;

    if (slaBreachPct > worstBreachPct) {
      worstBreachPct = slaBreachPct;
      worstStage = stage;
    }

    results.push({
      stage,
      stageLabel: getStageLabel(stage),
      avgDuration,
      medianDuration,
      maxDuration,
      totalVolume,
      activeCount: activeCounts.get(stage) || 0,
      slaBreachPct,
      slaBreachCount: breachCount,
      slaConfig: config,
      isBottleneck: false, // Set below
    });
  }

  // Mark worst stage as bottleneck
  for (const r of results) {
    if (r.stage === worstStage && worstBreachPct > 0) {
      r.isBottleneck = true;
    }
  }

  return results;
}

// ─── User Performance ───────────────────────────────────────────

export interface UserPerformance {
  userId: string;
  userName: string;
  role: UserRole;
  /** Number of claims this user has processed (approved/returned/rejected) */
  claimsProcessed: number;
  /** Average working days to process */
  avgHandlingTime: number;
  /** Fastest processing time */
  minHandlingTime: number;
  /** Slowest processing time */
  maxHandlingTime: number;
  /** SLA breach rate (0-100) */
  slaBreachRate: number;
  /** Number of SLA breaches */
  slaBreachCount: number;
  /** Number of returns initiated by this user */
  returnCount: number;
}

/**
 * Calculate per-user performance from workflow events.
 *
 * For each user, find the claims they processed and measure
 * the time between entering their stage and their action.
 */
export function getUserPerformance(
  workflowEvents: WorkflowEvent[],
  profiles: PerformanceProfile[],
): UserPerformance[] {
  const profileMap = new Map<string, PerformanceProfile>();
  for (const p of profiles) {
    profileMap.set(p.id, p);
  }

  // Group events by claim
  const eventsByClaim = new Map<string, WorkflowEvent[]>();
  for (const ev of workflowEvents) {
    const arr = eventsByClaim.get(ev.claim_id) || [];
    arr.push(ev);
    eventsByClaim.set(ev.claim_id, arr);
  }
  Array.from(eventsByClaim.values()).forEach(evs => {
    evs.sort((a: WorkflowEvent, b: WorkflowEvent) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  });

  // Track per-user metrics
  const userMetrics = new Map<string, {
    durations: number[];
    breachCount: number;
    returnCount: number;
  }>();

  const actionEvents = ['approve', 'return', 'reject', 'forward'];

  for (const events of Array.from(eventsByClaim.values())) {
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (!actionEvents.includes(ev.action)) continue;

      const actorId = ev.actor_id;
      const fromStatus = ev.from_status as ClaimStatus;

      // Find when this stage started (previous event's created_at where to_status = from_status)
      let stageStart: Date | null = null;
      for (let j = i - 1; j >= 0; j--) {
        if (events[j].to_status === fromStatus) {
          stageStart = new Date(events[j].created_at);
          break;
        }
      }

      if (!stageStart) continue;

      const actionTime = new Date(ev.created_at);
      const days = getWorkingDaysElapsed(stageStart, actionTime);
      const config = SLA_CONFIGS[fromStatus];

      if (!userMetrics.has(actorId)) {
        userMetrics.set(actorId, { durations: [], breachCount: 0, returnCount: 0 });
      }

      const metrics = userMetrics.get(actorId)!;
      metrics.durations.push(days);

      if (config && days > config.limitDays) {
        metrics.breachCount++;
      }

      if (ev.action === 'return') {
        metrics.returnCount++;
      }
    }
  }

  const results: UserPerformance[] = [];

  for (const [userId, metrics] of Array.from(userMetrics.entries())) {
    const profile = profileMap.get(userId);
    if (!profile) continue;

    const { durations, breachCount, returnCount } = metrics;
    const claimsProcessed = durations.length;

    results.push({
      userId,
      userName: profile.full_name_ar || profile.full_name,
      role: profile.role,
      claimsProcessed,
      avgHandlingTime: claimsProcessed > 0
        ? Math.round((durations.reduce((a: number, b: number) => a + b, 0) / claimsProcessed) * 10) / 10
        : 0,
      minHandlingTime: claimsProcessed > 0 ? Math.min(...durations) : 0,
      maxHandlingTime: claimsProcessed > 0 ? Math.max(...durations) : 0,
      slaBreachRate: claimsProcessed > 0
        ? Math.round((breachCount / claimsProcessed) * 100)
        : 0,
      slaBreachCount: breachCount,
      returnCount,
    });
  }

  // Sort by claims processed (descending)
  results.sort((a, b) => b.claimsProcessed - a.claimsProcessed);
  return results;
}

// ─── Contract Performance ───────────────────────────────────────

export interface ContractPerformance {
  contractId: string;
  contractNo: string;
  titleAr: string | null;
  baseValue: number;
  /** Total claims on this contract */
  totalClaims: number;
  /** Claims approved */
  approvedClaims: number;
  /** Claims currently overdue */
  overdueClaims: number;
  /** Claims currently in progress */
  inProgressClaims: number;
  /** Average processing time (working days from submit to approve) */
  avgDuration: number;
  /** Risk score (0-100) */
  riskScore: number;
  /** Risk level */
  riskLevel: 'low' | 'medium' | 'high';
}

/**
 * Calculate per-contract performance and risk scoring.
 *
 * Risk score = weighted combination of:
 *   - SLA breach % (weight 0.4)
 *   - Overdue ratio (weight 0.3)
 *   - Avg duration deviation (weight 0.2)
 *   - Return rate (weight 0.1)
 */
export function getContractPerformance(
  contracts: PerformanceContract[],
  claims: PerformanceClaim[],
  workflowEvents: WorkflowEvent[],
): ContractPerformance[] {
  // Group claims by contract
  const claimsByContract = new Map<string, PerformanceClaim[]>();
  for (const c of claims) {
    const arr = claimsByContract.get(c.contract_id) || [];
    arr.push(c);
    claimsByContract.set(c.contract_id, arr);
  }

  // Count returns per contract
  const returnsByContract = new Map<string, number>();
  const eventsByClaim = new Map<string, string>(); // claim_id → contract_id
  for (const c of claims) {
    eventsByClaim.set(c.id, c.contract_id);
  }
  for (const ev of workflowEvents) {
    if (ev.action === 'return') {
      const contractId = eventsByClaim.get(ev.claim_id);
      if (contractId) {
        returnsByContract.set(contractId, (returnsByContract.get(contractId) || 0) + 1);
      }
    }
  }

  const activeStages: ClaimStatus[] = [
    'under_supervisor_review',
    'under_auditor_review',
    'under_reviewer_check',
    'pending_director_approval',
  ];

  const results: ContractPerformance[] = [];

  for (const contract of contracts) {
    const contractClaims = claimsByContract.get(contract.id) || [];
    const totalClaims = contractClaims.length;

    if (totalClaims === 0) {
      results.push({
        contractId: contract.id,
        contractNo: contract.contract_no,
        titleAr: contract.title_ar,
        baseValue: contract.base_value,
        totalClaims: 0,
        approvedClaims: 0,
        overdueClaims: 0,
        inProgressClaims: 0,
        avgDuration: 0,
        riskScore: 0,
        riskLevel: 'low',
      });
      continue;
    }

    const approvedClaims = contractClaims.filter(c => c.status === 'approved').length;
    const inProgressClaims = contractClaims.filter(c => activeStages.includes(c.status)).length;

    // Count overdue
    let overdueClaims = 0;
    for (const c of contractClaims) {
      const config = SLA_CONFIGS[c.status];
      if (!config || !c.last_transition_at) continue;
      const days = getWorkingDaysElapsed(new Date(c.last_transition_at));
      if (days > config.limitDays) overdueClaims++;
    }

    // Calculate avg duration (submit → approve for approved claims)
    const approvedDurations: number[] = [];
    for (const c of contractClaims) {
      if (c.status === 'approved' && c.submitted_at && c.approved_at) {
        const days = getWorkingDaysElapsed(new Date(c.submitted_at), new Date(c.approved_at));
        approvedDurations.push(days);
      }
    }
    const avgDuration = approvedDurations.length > 0
      ? Math.round((approvedDurations.reduce((a: number, b: number) => a + b, 0) / approvedDurations.length) * 10) / 10
      : 0;

    // SLA breach count
    let slaBreachCount = 0;
    for (const c of contractClaims) {
      const config = SLA_CONFIGS[c.status];
      if (!config || !c.last_transition_at) continue;
      const days = getWorkingDaysElapsed(new Date(c.last_transition_at));
      if (days > config.limitDays) slaBreachCount++;
    }

    const slaBreachPct = inProgressClaims > 0
      ? (slaBreachCount / inProgressClaims) * 100
      : 0;

    const overdueRatio = totalClaims > 0
      ? (overdueClaims / totalClaims) * 100
      : 0;

    const returnCount = returnsByContract.get(contract.id) || 0;
    const returnRate = totalClaims > 0
      ? (returnCount / totalClaims) * 100
      : 0;

    // Avg duration deviation from global average (normalized 0-100)
    const durationScore = Math.min(avgDuration * 5, 100); // 20 days → 100

    // Risk score calculation (weighted)
    const riskScore = Math.round(
      slaBreachPct * 0.4 +
      overdueRatio * 0.3 +
      durationScore * 0.2 +
      Math.min(returnRate, 100) * 0.1
    );

    let riskLevel: 'low' | 'medium' | 'high' = 'low';
    if (riskScore >= 60) riskLevel = 'high';
    else if (riskScore >= 30) riskLevel = 'medium';

    results.push({
      contractId: contract.id,
      contractNo: contract.contract_no,
      titleAr: contract.title_ar,
      baseValue: contract.base_value,
      totalClaims,
      approvedClaims,
      overdueClaims,
      inProgressClaims,
      avgDuration,
      riskScore,
      riskLevel,
    });
  }

  // Sort by risk score descending
  results.sort((a, b) => b.riskScore - a.riskScore);
  return results;
}

// ─── Overall Performance ────────────────────────────────────────

export interface OverallPerformance {
  totalClaims: number;
  inProgressClaims: number;
  approvedClaims: number;
  rejectedClaims: number;
  overdueClaims: number;
  avgProcessingTime: number;
  approvalRate: number;
  returnRate: number;
}

export function getOverallPerformance(
  claims: PerformanceClaim[],
  workflowEvents: WorkflowEvent[],
): OverallPerformance {
  const totalClaims = claims.length;

  const activeStages: ClaimStatus[] = [
    'submitted',
    'under_supervisor_review',
    'under_auditor_review',
    'under_reviewer_check',
    'pending_director_approval',
  ];

  const inProgressClaims = claims.filter(c => activeStages.includes(c.status)).length;
  const approvedClaims = claims.filter(c => c.status === 'approved').length;
  const rejectedClaims = claims.filter(c => c.status === 'rejected').length;

  // Overdue
  let overdueClaims = 0;
  for (const c of claims) {
    const config = SLA_CONFIGS[c.status];
    if (!config || !c.last_transition_at) continue;
    const days = getWorkingDaysElapsed(new Date(c.last_transition_at));
    if (days > config.limitDays) overdueClaims++;
  }

  // Avg processing time (submit → approve)
  const processingTimes: number[] = [];
  for (const c of claims) {
    if (c.status === 'approved' && c.submitted_at && c.approved_at) {
      const days = getWorkingDaysElapsed(new Date(c.submitted_at), new Date(c.approved_at));
      processingTimes.push(days);
    }
  }
  const avgProcessingTime = processingTimes.length > 0
    ? Math.round((processingTimes.reduce((a: number, b: number) => a + b, 0) / processingTimes.length) * 10) / 10
    : 0;

  // Approval rate
  const completedClaims = approvedClaims + rejectedClaims;
  const approvalRate = completedClaims > 0
    ? Math.round((approvedClaims / completedClaims) * 100)
    : 0;

  // Return rate
  const returnEvents = workflowEvents.filter(e => e.action === 'return').length;
  const returnRate = totalClaims > 0
    ? Math.round((returnEvents / totalClaims) * 100)
    : 0;

  return {
    totalClaims,
    inProgressClaims,
    approvedClaims,
    rejectedClaims,
    overdueClaims,
    avgProcessingTime,
    approvalRate,
    returnRate,
  };
}

// ─── Helpers ────────────────────────────────────────────────────

function getMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10;
}
