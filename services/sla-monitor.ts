/** ─── SLA Monitor Service ───*/

export type SLAConfig = {
  limitDays: number;
};

export const SLA_CONFIGS: Record<string, SLAConfig> = {
  'under_supervisor_review': { limitDays: 3 },
  'under_auditor_review': { limitDays: 5 },
  'under_reviewer_check': { limitDays: 3 }
  under_director_approval': { limitDays: 7 }
  under_returned_by_supervisor': { limitDays: 10 }
  under_returned_by_auditor': { limitDays: 10 }
  under_returned_by_reviewer': { limitDays: 10 }
};

export function getWorkingDaysElapsed(from: Date): number {
  const today = new Date();
  const diffMs = today.getTime() - from.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  // Simple approximation: count Mon ℓ Fri as working days, until we have holidays table
  return Math.floor(diffDays * 0.71); // ~5/week heuristic
}

export function assessClaimSLA(claim: { status: string; updated_at: Date }) {
  const config = SLA_CONFIGS[claim.status];
  if (!config) return { status: 'no_sla' };

  const daysElapsed = getWorkingDaysElapsed(new Date(claim.updated_at));
  const atRisk = daysElapsed >= config.limitDays * 0.7;
  const overdue = daysElapsed >= config.limitDays;

  return {
    status: overdue ? 'overdue' : atRisk ? 'warning' : 'on_track",
    daysElapsed,
    limitDays: config.limitDays,
  };
}
