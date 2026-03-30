/**
 * CONVERA Executive Dashboard Data Service
 *
 * Single source of truth for all dashboard queries.
 * Every KPI, chart dataset, and panel is populated from this service.
 *
 * Data loaded in a single parallel batch to minimise round-trips.
 */

import { createBrowserSupabase } from '@/lib/supabase';
import type { ClaimStatus } from '@/lib/types';

// ─── SLA constants (Rule G4) ──────────────────────────────────────
const SLA_WARNING_DAYS  = 2;   // day 2: warn supervisor + auditor + reviewer
const SLA_BREACH_DAYS   = 3;   // day 3: escalate to director; flag as breached
const CEILING_PCT_WARN  = 80;  // contracts ≥ 80% of ceiling → amber
const CEILING_PCT_CRIT  = 90;  // contracts ≥ 90% of ceiling → red

// ─── Types ───────────────────────────────────────────────────────

export interface DashboardKPIs {
  activeContractCount:      number;
  totalContractValue:       number;
  totalApprovedSpend:       number;
  pendingClaimsCount:       number;   // in-flight (non-draft, non-terminal)
  slaBreachedCount:         number;   // supervisor stage > SLA_BREACH_DAYS
  slaWarningCount:          number;   // supervisor stage > SLA_WARNING_DAYS
  nearCeilingCount:         number;   // ≥ CEILING_PCT_WARN of ceiling
  approvedAmendmentsCount:  number;
  approvedAmendmentsValue:  number;
  pendingDirectorValue:     number;   // total value of claims at director stage
}

export interface ClaimsByStatus {
  status: ClaimStatus;
  label:  string;
  count:  number;
  color:  string;
}

export interface ContractSpend {
  contractId:    string;
  contractNo:    string;
  title:         string;
  baseValue:     number;
  ceiling:       number;
  approvedSpend: number;
  pendingSpend:  number;
  remaining:     number;
  pctConsumed:   number;
  riskLevel:     'normal' | 'warning' | 'critical';
}

export interface DelayedByStage {
  stage:   string;
  label:   string;
  count:   number;
  maxDays: number;
}

export interface ChangeOrderSummary {
  contractId:    string;
  contractNo:    string;
  title:         string;
  count:         number;
  approvedValue: number;
  pendingCount:  number;
  pctOfBase:     number;
  baseValue:     number;
}

export interface AttentionItem {
  type:       'sla_breach' | 'sla_warning' | 'near_ceiling' | 'missing_docs' | 'returned' | 'pending_amendment';
  severity:   'critical' | 'warning' | 'info';
  title:      string;
  subtitle:   string;
  claimId?:   string;
  claimNo?:   number;
  contractId?: string;
  daysOld?:   number;
  pct?:       number;
}

export interface ClaimActivity {
  id:          string;
  claimNo:     number;
  contractNo:  string;
  contractTitle: string;
  status:      ClaimStatus;
  totalAmount: number;
  daysOld:     number;
  submittedAt: string | null;
  updatedAt:   string;
  returnReason?: string | null;
}

export interface DashboardData {
  kpis:            DashboardKPIs;
  claimsByStatus:  ClaimsByStatus[];
  contractSpends:  ContractSpend[];
  delayedByStage:  DelayedByStage[];
  attentionItems:  AttentionItem[];
  recentActivity:  ClaimActivity[];
  changeOrders:    ChangeOrderSummary[];
  loadedAt:        string;
}

// ─── Status metadata ──────────────────────────────────────────────

const STATUS_META: Record<ClaimStatus, { label: string; color: string; order: number }> = {
  draft:                      { label: 'مسودة',                   color: '#54565B', order: 1 },
  submitted:                  { label: 'مُقدَّمة',                color: '#00A79D', order: 2 },
  under_supervisor_review:    { label: 'مراجعة الإشراف',          color: '#502C7C', order: 3 },
  returned_by_supervisor:     { label: 'مُرجَّعة من الإشراف',     color: '#C05728', order: 4 },
  under_auditor_review:       { label: 'مراجعة المدقق',           color: '#502C7C', order: 5 },
  returned_by_auditor:        { label: 'مُرجَّعة من المدقق',      color: '#C05728', order: 6 },
  under_reviewer_check:       { label: 'فحص المراجع',             color: '#FFC845', order: 7 },
  pending_director_approval:  { label: 'بانتظار المدير',          color: '#045859', order: 8 },
  approved:                   { label: 'معتمدة',                   color: '#87BA26', order: 9 },
  rejected:                   { label: 'مرفوضة',                   color: '#DC2626', order: 10 },
};

const IN_FLIGHT_STATUSES: ClaimStatus[] = [
  'submitted',
  'under_supervisor_review',
  'under_auditor_review',
  'under_reviewer_check',
  'pending_director_approval',
];

// ─── Helpers ──────────────────────────────────────────────────────

function daysSince(dateStr: string | null | undefined): number {
  if (!dateStr) return 0;
  const ms = Date.now() - new Date(dateStr).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function safeNum(v: unknown): number {
  return parseFloat(String(v ?? '0')) || 0;
}

// ─── Main loader ──────────────────────────────────────────────────

export async function loadDashboardData(): Promise<DashboardData> {
  const supabase = createBrowserSupabase();

  // Parallel fetch: all needed tables at once
  const [
    contractsRes,
    claimsRes,
    ceilingRes,
    amendmentsRes,
    changeOrdersRes,
  ] = await Promise.allSettled([
    // 1. Contracts
    supabase
      .from('contracts')
      .select('id, contract_no, title, title_ar, status, base_value')
      .order('contract_no'),

    // 2. Claims with contract info
    supabase
      .from('claims')
      .select(`
        id, claim_no, contract_id, status,
        total_amount, gross_amount, boq_amount, staff_amount,
        submitted_at, approved_at, updated_at, last_transition_at, return_reason,
        contracts(contract_no, title_ar, title)
      `)
      .order('claim_no', { ascending: false }),

    // 3. Contract ceiling summary view
    supabase
      .from('contract_ceiling_summary')
      .select('*'),

    // 4. Contract amendments (old change-order table)
    supabase
      .from('contract_amendments')
      .select('id, contract_id, value_change, status, created_at'),

    // 5. Change orders (new table, may not exist yet)
    supabase
      .from('change_orders')
      .select('id, contract_id, status, created_at'),
  ]);

  // ── Extract results (tolerate missing tables) ──────────────────
  const contracts   = contractsRes.status  === 'fulfilled' ? (contractsRes.value.data  || []) : [];
  const claims      = claimsRes.status     === 'fulfilled' ? (claimsRes.value.data     || []) : [];
  const ceilings    = ceilingRes.status    === 'fulfilled' ? (ceilingRes.value.data    || []) : [];
  const amendments  = amendmentsRes.status === 'fulfilled' ? (amendmentsRes.value.data || []) : [];
  const coRaw       = changeOrdersRes.status === 'fulfilled' ? (changeOrdersRes.value.data || []) : [];

  // ── Ceiling lookup map ─────────────────────────────────────────
  const ceilingByContract = new Map<string, {
    baseValue:     number;
    ceiling:       number;
    totalSpent:    number;
    remaining:     number;
    amendments:    number;
    hasAmendments: boolean;
  }>();

  for (const row of ceilings) {
    ceilingByContract.set(row.contract_id, {
      baseValue:     safeNum(row.base_value),
      ceiling:       safeNum(row.ceiling),
      totalSpent:    safeNum(row.total_spent),
      remaining:     safeNum(row.remaining),
      amendments:    safeNum(row.amendments_total),
      hasAmendments: row.has_amendments || false,
    });
  }

  // ── Active contracts ───────────────────────────────────────────
  const activeContracts = contracts.filter(c => c.status === 'active');
  const totalContractValue = activeContracts.reduce((s, c) => s + safeNum(c.base_value), 0);

  // ── Claims metrics ─────────────────────────────────────────────
  const now = Date.now();

  // ── FINANCIAL BASIS: ALL AMOUNTS ARE EX-VAT (gross_amount) ───────
  // gross_amount = boq_amount + staff_amount  (before retention, before VAT)
  // This matches the contract base_value and ceiling which are also ex-VAT.
  // VAT (15%) is a tax pass-through; it is NOT included in any figure here.

  const approvedClaims = claims.filter(c =>
    c.status === 'approved' || c.status === 'closed'
  );
  const totalApprovedSpend = approvedClaims.reduce((s, c) => s + safeNum(c.gross_amount), 0);

  const pendingClaims = claims.filter(c => IN_FLIGHT_STATUSES.includes(c.status as ClaimStatus));

  const directorPending = claims.filter(c => c.status === 'pending_director_approval');
  const pendingDirectorValue = directorPending.reduce((s, c) => s + safeNum(c.gross_amount), 0);

  // SLA: only supervisor stage has the formal SLA
  // Sprint E.1.5: Use last_transition_at for accurate SLA tracking
  const supervisorClaims = claims.filter(c => c.status === 'under_supervisor_review');
  const slaBreached  = supervisorClaims.filter(c => daysSince(c.last_transition_at || c.updated_at) >= SLA_BREACH_DAYS);
  const slaWarning   = supervisorClaims.filter(c => {
    const d = daysSince(c.last_transition_at || c.updated_at);
    return d >= SLA_WARNING_DAYS && d < SLA_BREACH_DAYS;
  });

  // ── Claims by status (Chart 1) ─────────────────────────────────
  const statusCounts = new Map<ClaimStatus, number>();
  for (const c of claims) {
    const s = c.status as ClaimStatus;
    statusCounts.set(s, (statusCounts.get(s) || 0) + 1);
  }

  const claimsByStatus: ClaimsByStatus[] = (Object.keys(STATUS_META) as ClaimStatus[])
    .map(s => ({
      status: s,
      label:  STATUS_META[s].label,
      count:  statusCounts.get(s) || 0,
      color:  STATUS_META[s].color,
    }))
    .filter(s => s.count > 0)
    .sort((a, b) => STATUS_META[a.status].order - STATUS_META[b.status].order);

  // ── Contract spend (Chart 2) ───────────────────────────────────
  const approvedByContract = new Map<string, number>();
  const pendingByContract  = new Map<string, number>();

  for (const c of claims) {
    // Use gross_amount (ex-VAT) to stay on the same basis as contract base_value
    const amt = safeNum(c.gross_amount);
    if (c.status === 'approved' || c.status === 'closed') {
      approvedByContract.set(c.contract_id, (approvedByContract.get(c.contract_id) || 0) + amt);
    } else if (IN_FLIGHT_STATUSES.includes(c.status as ClaimStatus)) {
      pendingByContract.set(c.contract_id, (pendingByContract.get(c.contract_id) || 0) + amt);
    }
  }

  const contractSpends: ContractSpend[] = contracts.map(ct => {
    const ceil        = ceilingByContract.get(ct.id);
    const base        = safeNum(ct.base_value);
    // Ceiling = base × 1.10 unless approved amendments exist (from view)
    const cap         = ceil?.ceiling ?? base * 1.10;
    // Approved spend: gross_amount (ex-VAT), approved+closed claims only
    const approvedAmt = approvedByContract.get(ct.id) || 0;
    // Pending spend: gross_amount (ex-VAT), in-flight claims only
    const pendingAmt  = pendingByContract.get(ct.id)  || 0;
    // Remaining = ceiling − approved (ex-VAT arithmetic — consistent basis)
    const remaining   = cap - approvedAmt;
    // pctConsumed = approved ÷ ceiling (governance measure)
    const pct         = cap > 0 ? (approvedAmt / cap) * 100 : 0;
    return {
      contractId:    ct.id,
      contractNo:    ct.contract_no,
      title:         ct.title_ar || ct.title,
      baseValue:     base,
      ceiling:       cap,
      approvedSpend: approvedAmt,
      pendingSpend:  pendingAmt,
      remaining,
      pctConsumed:   pct,
      riskLevel:     pct >= CEILING_PCT_CRIT ? 'critical' : pct >= CEILING_PCT_WARN ? 'warning' : 'normal',
    };
  });

  // Contracts near ceiling count (for KPI)
  const nearCeilingCount = contractSpends.filter(c => c.pctConsumed >= CEILING_PCT_WARN).length;

  // ── Delayed claims by stage (Chart 3) ─────────────────────────
  interface StageStat { count: number; maxDays: number }
  const stageStats = new Map<string, StageStat>();

  const STAGE_LABELS: Record<string, string> = {
    under_supervisor_review:   'جهة الإشراف',
    under_auditor_review:      'المدقق',
    under_reviewer_check:      'المراجع',
    pending_director_approval: 'المدير',
  };

  for (const c of pendingClaims) {
    const stage  = c.status;
    const days   = daysSince(c.last_transition_at || c.updated_at);
    const delay  = stage === 'under_supervisor_review' ? SLA_BREACH_DAYS : 7;
    if (days >= delay) {
      const existing = stageStats.get(stage) || { count: 0, maxDays: 0 };
      stageStats.set(stage, {
        count:   existing.count + 1,
        maxDays: Math.max(existing.maxDays, days),
      });
    }
  }

  const delayedByStage: DelayedByStage[] = Object.entries(STAGE_LABELS).map(([stage, label]) => ({
    stage,
    label,
    count:   stageStats.get(stage)?.count   || 0,
    maxDays: stageStats.get(stage)?.maxDays || 0,
  }));

  // ── Amendments / change orders (Chart 5) ──────────────────────
  const amendByContract = new Map<string, { count: number; approvedValue: number; pendingCount: number }>();

  for (const a of amendments) {
    const existing = amendByContract.get(a.contract_id) || { count: 0, approvedValue: 0, pendingCount: 0 };
    amendByContract.set(a.contract_id, {
      count:         existing.count + 1,
      approvedValue: existing.approvedValue + (a.status === 'approved' ? safeNum(a.value_change) : 0),
      pendingCount:  existing.pendingCount  + (a.status === 'pending'  ? 1 : 0),
    });
  }

  // Also merge in newer change_orders table if it has data
  for (const co of coRaw) {
    const existing = amendByContract.get(co.contract_id) || { count: 0, approvedValue: 0, pendingCount: 0 };
    amendByContract.set(co.contract_id, {
      count:         existing.count + 1,
      approvedValue: existing.approvedValue,
      pendingCount:  existing.pendingCount + (co.status === 'pending' ? 1 : 0),
    });
  }

  const changeOrders: ChangeOrderSummary[] = contracts
    .filter(ct => amendByContract.has(ct.id))
    .map(ct => {
      const stats = amendByContract.get(ct.id)!;
      const base  = safeNum(ct.base_value);
      return {
        contractId:    ct.id,
        contractNo:    ct.contract_no,
        title:         ct.title_ar || ct.title,
        count:         stats.count,
        approvedValue: stats.approvedValue,
        pendingCount:  stats.pendingCount,
        pctOfBase:     base > 0 ? (stats.approvedValue / base) * 100 : 0,
        baseValue:     base,
      };
    });

  const approvedAmendmentsCount = amendments.filter(a => a.status === 'approved').length
    + coRaw.filter(c => c.status === 'approved').length;
  const approvedAmendmentsValue = amendments
    .filter(a => a.status === 'approved')
    .reduce((s, a) => s + safeNum(a.value_change), 0);

  // ── KPIs ───────────────────────────────────────────────────────
  const kpis: DashboardKPIs = {
    activeContractCount:     activeContracts.length,
    totalContractValue,
    totalApprovedSpend,
    pendingClaimsCount:      pendingClaims.length,
    slaBreachedCount:        slaBreached.length,
    slaWarningCount:         slaWarning.length,
    nearCeilingCount,
    approvedAmendmentsCount,
    approvedAmendmentsValue,
    pendingDirectorValue,
  };

  // ── Attention items panel ──────────────────────────────────────
  const attentionItems: AttentionItem[] = [];

  // SLA breaches
  for (const c of slaBreached) {
    const ct = (c.contracts as { contract_no?: string; title_ar?: string; title?: string } | null);
    const days = daysSince(c.last_transition_at || c.updated_at);
    attentionItems.push({
      type:      'sla_breach',
      severity:  'critical',
      title:     `مطالبة #${c.claim_no} — تجاوز مدة الإشراف`,
      subtitle:  `${ct?.contract_no || ''} | منذ ${days} يوم`,
      claimId:   c.id,
      claimNo:   c.claim_no,
      daysOld:   days,
    });
  }

  // SLA warnings
  for (const c of slaWarning) {
    const ct = (c.contracts as { contract_no?: string; title_ar?: string; title?: string } | null);
    const days = daysSince(c.last_transition_at || c.updated_at);
    attentionItems.push({
      type:      'sla_warning',
      severity:  'warning',
      title:     `مطالبة #${c.claim_no} — اقترابٌ من نهاية مهلة الإشراف`,
      subtitle:  `${ct?.contract_no || ''} | اليوم ${days} من أصل 3`,
      claimId:   c.id,
      claimNo:   c.claim_no,
      daysOld:   days,
    });
  }

  // Contracts near ceiling
  for (const cs of contractSpends.filter(c => c.riskLevel !== 'normal')) {
    attentionItems.push({
      type:       'near_ceiling',
      severity:   cs.riskLevel === 'critical' ? 'critical' : 'warning',
      title:      `${cs.title.substring(0, 50)} — ${cs.pctConsumed.toFixed(0)}% من السقف`,
      subtitle:   `${cs.contractNo} | الرصيد: ${Math.round(cs.remaining).toLocaleString('ar-SA')} ريال`,
      contractId: cs.contractId,
      pct:        cs.pctConsumed,
    });
  }

  // Returned claims (awaiting contractor)
  const returnedClaims = claims.filter(c =>
    c.status === 'returned_by_supervisor' || c.status === 'returned_by_auditor'
  );
  for (const c of returnedClaims.slice(0, 5)) {
    const ct = (c.contracts as { contract_no?: string; title_ar?: string; title?: string } | null);
    const days = daysSince(c.last_transition_at || c.updated_at);
    attentionItems.push({
      type:      'returned',
      severity:  'warning',
      title:     `مطالبة #${c.claim_no} — مُرجَّعة بانتظار المقاول`,
      subtitle:  `${ct?.contract_no || ''} | منذ ${days} يوم`,
      claimId:   c.id,
      claimNo:   c.claim_no,
      daysOld:   days,
    });
  }

  // Pending amendments
  const pendingAmendments = amendments.filter(a => a.status === 'pending');
  if (pendingAmendments.length > 0) {
    attentionItems.push({
      type:     'pending_amendment',
      severity: 'info',
      title:    `${pendingAmendments.length} تعديل عقد بانتظار الاعتماد`,
      subtitle: 'يتطلب إجراءً من المدير',
    });
  }

  // Sort: critical first, then warning, then info
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  attentionItems.sort((a, b) =>
    severityOrder[a.severity] - severityOrder[b.severity]
  );

  // ── Recent activity (operations panel) ────────────────────────
  const recentActivity: ClaimActivity[] = claims.slice(0, 30).map(c => {
    const ct = (c.contracts as { contract_no?: string; title_ar?: string; title?: string } | null);
    return {
      id:            c.id,
      claimNo:       c.claim_no,
      contractNo:    ct?.contract_no || '',
      contractTitle: ct?.title_ar || ct?.title || '',
      status:        c.status as ClaimStatus,
      totalAmount:   safeNum(c.gross_amount),   // ex-VAT (gross = boq + staff)
      daysOld:       daysSince(c.last_transition_at || c.submitted_at || c.updated_at),
      submittedAt:   c.submitted_at,
      updatedAt:     c.updated_at,
      returnReason:  c.return_reason,
    };
  });

  return {
    kpis,
    claimsByStatus,
    contractSpends,
    delayedByStage,
    attentionItems,
    recentActivity,
    changeOrders,
    loadedAt: new Date().toISOString(),
  };
}
