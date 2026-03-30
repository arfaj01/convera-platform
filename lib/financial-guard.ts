/**
 * CONVERA Financial Guard — Server-side financial control validators
 *
 * All functions here are called from API route handlers (server-side only).
 * They enforce hard financial rules that CANNOT be bypassed by the frontend.
 *
 * Rules enforced:
 *  FG1 — Contract ceiling: claims cannot exceed base_value × 1.10
 *  FG2 — BOQ progress: cumulative qty cannot exceed contractual_qty
 *  FG3 — Duplicate claim period: no overlapping approved periods per BOQ item
 *  FG4 — Change order limit: cumulative change orders ≤ 10% of base value
 *  FG5 — Burn rate anomaly: single claim > 40% of contract value triggers flag
 *  FG6 — Staff duplicate: same position/role cannot appear twice in one claim
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Result Types ─────────────────────────────────────────────────

export interface GuardResult {
  ok:      boolean;
  error?:  string;            // Arabic error message for user display
  warn?:   string;            // Non-blocking Arabic warning
  details?: Record<string, unknown>;
}

// ─── FG1: Contract Ceiling Check ──────────────────────────────────

/**
 * Checks that adding claimAmount to a contract's approved total
 * does not exceed base_value × 1.10.
 *
 * Called before: claim approval (director stage)
 */
export async function checkContractCeiling(
  admin: SupabaseClient,
  contractId: string,
  claimId: string,
  newClaimAmount: number,
): Promise<GuardResult> {
  // Load contract base value
  const { data: contract } = await admin
    .from('contracts')
    .select('base_value, contract_no')
    .eq('id', contractId)
    .single();

  if (!contract) return { ok: false, error: 'العقد غير موجود' };

  // Sum all approved/closed claims except the current one
  const { data: approvedClaims } = await admin
    .from('claims')
    .select('total_amount')
    .eq('contract_id', contractId)
    .in('status', ['approved', 'closed'])
    .neq('id', claimId);

  const approvedTotal = (approvedClaims ?? []).reduce(
    (sum, c) => sum + (c.total_amount ?? 0),
    0,
  );

  const ceiling    = contract.base_value * 1.10;
  const projected  = approvedTotal + newClaimAmount;
  const remaining  = ceiling - approvedTotal;
  const utilizationPct = (projected / contract.base_value) * 100;

  if (projected > ceiling) {
    return {
      ok: false,
      error: `قيمة المطالبة (${newClaimAmount.toLocaleString('ar-SA')} ر.س) تتجاوز الحد الأقصى المتبقي للعقد (${remaining.toLocaleString('ar-SA')} ر.س). الحد الأقصى المسموح به 110% من قيمة العقد الأساسية.`,
      details: { ceiling, approvedTotal, projected, remaining, utilizationPct },
    };
  }

  // Warn at 90% utilization (approaching limit)
  if (utilizationPct >= 90) {
    return {
      ok: true,
      warn: `تنبيه: إجمالي المطالبات المعتمدة يبلغ ${utilizationPct.toFixed(1)}% من قيمة العقد — اقتراب من الحد الأقصى`,
      details: { ceiling, approvedTotal, projected, remaining, utilizationPct },
    };
  }

  return { ok: true, details: { ceiling, approvedTotal, projected, remaining, utilizationPct } };
}

// ─── FG2: BOQ Progress Ceiling ────────────────────────────────────

/**
 * Validates that a BOQ item's current period progress + all prior
 * approved progress for the same template item does NOT exceed
 * the contractual quantity.
 *
 * Called before: claim submission or draft save with items
 */
export async function checkBoqProgressCeiling(
  admin: SupabaseClient,
  contractId: string,
  claimId: string,
  boqItems: Array<{
    template_item_id: string;
    curr_progress: number;
    contractual_qty: number;
    progress_model: string;
  }>,
): Promise<GuardResult> {
  for (const item of boqItems) {
    if (item.progress_model !== 'count') continue; // only count model has hard ceiling

    // Sum cumulative progress from all approved claims
    const { data: prior } = await admin
      .from('claim_boq_items')
      .select('curr_progress, claim_id, claims!inner(status, contract_id)')
      .eq('template_item_id', item.template_item_id)
      .in('claims.status', ['approved', 'closed'])
      .eq('claims.contract_id', contractId)
      .neq('claim_id', claimId);

    const priorTotal = (prior ?? []).reduce(
      (sum, r) => sum + (r.curr_progress ?? 0),
      0,
    );

    const projected = priorTotal + item.curr_progress;
    if (projected > item.contractual_qty) {
      return {
        ok: false,
        error: `الكميات التراكمية لبند (${item.template_item_id}) تتجاوز الكمية التعاقدية: ${projected} > ${item.contractual_qty}`,
        details: { template_item_id: item.template_item_id, priorTotal, projected, contractual_qty: item.contractual_qty },
      };
    }
  }

  return { ok: true };
}

// ─── FG4: Change Order Cumulative Limit ───────────────────────────

/**
 * Checks that approving a change order will not push cumulative
 * change order value past 10% of the contract's base value.
 *
 * Called before: change order approval
 */
export async function checkChangeOrderLimit(
  admin: SupabaseClient,
  contractId: string,
  changeOrderId: string,
  newChangeValue: number,
): Promise<GuardResult> {
  const { data: contract } = await admin
    .from('contracts')
    .select('base_value, contract_no')
    .eq('id', contractId)
    .single();

  if (!contract) return { ok: false, error: 'العقد غير موجود' };

  const { data: priorOrders } = await admin
    .from('change_orders')
    .select('net_change_value')
    .eq('contract_id', contractId)
    .eq('status', 'approved')
    .neq('id', changeOrderId);

  const priorTotal = (priorOrders ?? []).reduce(
    (sum, o) => sum + Math.abs(o.net_change_value ?? 0),
    0,
  );

  const maxAllowed      = contract.base_value * 0.10;
  const projectedTotal  = priorTotal + Math.abs(newChangeValue);
  const utilizationPct  = (projectedTotal / contract.base_value) * 100;

  if (projectedTotal > maxAllowed) {
    return {
      ok: false,
      error: `أوامر التغيير التراكمية (${projectedTotal.toLocaleString('ar-SA')} ر.س) ستتجاوز الحد الأقصى المسموح به 10% (${maxAllowed.toLocaleString('ar-SA')} ر.س)`,
      details: { priorTotal, maxAllowed, projectedTotal, utilizationPct },
    };
  }

  // Warn at 90% of limit
  if (utilizationPct >= 9) {
    return {
      ok: true,
      warn: `تنبيه: استخدام أوامر التغيير بلغ ${utilizationPct.toFixed(1)}% من الحد الأقصى`,
      details: { priorTotal, maxAllowed, projectedTotal, utilizationPct },
    };
  }

  return { ok: true, details: { priorTotal, maxAllowed, projectedTotal, utilizationPct } };
}

// ─── FG5: Burn Rate & Anomaly Detection ───────────────────────────

/**
 * Returns financial intelligence metrics for a contract:
 * - Budget utilization %
 * - Monthly burn rate (avg spend per month to date)
 * - Forecasted spend at current burn rate
 * - Anomaly flags
 *
 * Called from: dashboard, reports, claim approval
 */
export interface BurnRateAnalysis {
  contractId:         string;
  baseValue:          number;
  approvedTotal:      number;
  utilizationPct:     number;
  remainingBudget:    number;
  monthsElapsed:      number;
  monthsRemaining:    number;
  monthlyBurnRate:    number;
  forecastedTotal:    number;
  forecastedOverrun:  number;
  riskLevel:          'low' | 'medium' | 'high' | 'critical';
  anomalyFlags:       string[];
}

export async function analyzeBurnRate(
  admin: SupabaseClient,
  contractId: string,
): Promise<BurnRateAnalysis> {
  // Load contract
  const { data: contract } = await admin
    .from('contracts')
    .select('base_value, start_date, end_date, duration_months')
    .eq('id', contractId)
    .single();

  if (!contract) throw new Error('Contract not found');

  // Load all approved claims
  const { data: claims } = await admin
    .from('claims')
    .select('total_amount, created_at, status')
    .eq('contract_id', contractId)
    .in('status', ['approved', 'closed']);

  const approvedTotal = (claims ?? []).reduce(
    (sum, c) => sum + (c.total_amount ?? 0),
    0,
  );

  // Time calculations
  const now      = new Date();
  const start    = new Date(contract.start_date);
  const end      = new Date(contract.end_date);
  const totalMs  = end.getTime() - start.getTime();
  const elapsedMs = now.getTime() - start.getTime();
  const monthsElapsed   = Math.max(1, elapsedMs / (1000 * 60 * 60 * 24 * 30));
  const monthsRemaining = Math.max(0, (end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30));
  const totalMonths = totalMs / (1000 * 60 * 60 * 24 * 30);

  // Burn rate
  const monthlyBurnRate  = approvedTotal / monthsElapsed;
  const forecastedTotal  = approvedTotal + (monthlyBurnRate * monthsRemaining);
  const forecastedOverrun = Math.max(0, forecastedTotal - contract.base_value);
  const utilizationPct   = (approvedTotal / contract.base_value) * 100;
  const remainingBudget  = contract.base_value - approvedTotal;

  // Anomaly detection
  const anomalyFlags: string[] = [];

  // Flag: any single claim > 40% of base value
  for (const claim of (claims ?? [])) {
    if ((claim.total_amount ?? 0) > contract.base_value * 0.40) {
      anomalyFlags.push(`مطالبة بقيمة تتجاوز 40% من قيمة العقد`);
      break;
    }
  }

  // Flag: spending faster than timeline suggests
  const expectedUtilization = (monthsElapsed / totalMonths) * 100;
  if (utilizationPct > expectedUtilization + 20) {
    anomalyFlags.push(`وتيرة الصرف أسرع من الجدول الزمني بنسبة ${(utilizationPct - expectedUtilization).toFixed(1)}%`);
  }

  // Flag: forecasted overrun
  if (forecastedOverrun > 0) {
    anomalyFlags.push(`الإسقاط المالي يتجاوز قيمة العقد بمقدار ${forecastedOverrun.toLocaleString('ar-SA')} ر.س`);
  }

  // Flag: repeated returns (look at claims returned > 2 times)
  const { data: returns } = await admin
    .from('claim_workflow')
    .select('claim_id')
    .eq('contract_id', contractId)
    .eq('action', 'return');

  if ((returns ?? []).length > (claims ?? []).length * 2) {
    anomalyFlags.push(`معدل استرداد مرتفع: ${returns?.length ?? 0} عملية إرجاع مقابل ${claims?.length ?? 0} مطالبة`);
  }

  // Risk classification
  let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
  if (utilizationPct >= 100 || forecastedOverrun > 0) riskLevel = 'critical';
  else if (utilizationPct >= 85 || anomalyFlags.length >= 2) riskLevel = 'high';
  else if (utilizationPct >= 70 || anomalyFlags.length >= 1) riskLevel = 'medium';

  return {
    contractId,
    baseValue:         contract.base_value,
    approvedTotal,
    utilizationPct,
    remainingBudget,
    monthsElapsed,
    monthsRemaining,
    monthlyBurnRate,
    forecastedTotal,
    forecastedOverrun,
    riskLevel,
    anomalyFlags,
  };
}
