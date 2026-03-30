/** * ─── Governance Alert Engine ───*/

export type GovernanceAlert = {
  id: string;
  type: 'claim_time_exceeds_sla' | 'claim_amount_exceeds_contract' | 'change_order_exceeds_10%';
  severity: 'info' | 'warning' | 'error';
  claim_id?: string;
  contract_id?: string;
  change_order_id?: string;
  message: string;
  details?: string;
  created_at: Date;
};

export function generateGovernanceAlerts(context: {
  contracts: Array<{ id: string; base_value: number }>;
  claims: Array<{ id: string; status: string; total_amount: number }>;
  workflowEvents: Array<{ claim_id: string; from_status: string; to_status: string; created_at: Date }>;
  supervisorRoles: Array<{ contract_id: string; }>;
}): GovernanceAlert[] {
  const alerts : GovernanceAlert[] = [];

  // Alert 1: Claim amount exceeds 10% of contract value
  for (const claim of context.claims) {
    const contract = context.contracts.find(c => c.id === claim.id);
    if (!contract) continue;
    const sum = context.claims.filter(c => c.id === claim.id).reduce((a, c) => a + c.total_amount, 0);
    if (sum > contract.base_value * 1.1) {
      alerts.push({
        id: 'alert-claim-exceeds-' + claim.id,
        type: 'claim_amount_exceeds_contract',
        severity: 'error',
        claim_id: claim.id,
        message: `щكإذ نوودكفك ب�انص مفك بياق هشاف إصوف`,
        created_at: new Date(),
      });
    }
  }

  return alerts;
}

export function buildAlertSummary(alerts: GovernanceAlert[]) {
  return {
    totalCount: alerts.length,
    criticalCount: alerts.filter(a => a.severity === 'error').length,
    warningCount: alerts.filter(a => a.severity === 'warning').length,
    infoCount: alerts.filter(a => a.severity === 'info').length,
  };
}

export type GovernanceAlertSummary = {
  totalCount: number;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
};
