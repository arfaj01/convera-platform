/**
 * CONVERA — Reports Data Service
 *
 * Provides data-fetching functions for all 5 report types.
 * Financial basis is consistent with dashboard + certificate module:
 *   gross = boq + staff
 *   net   = gross - retention
 *   total = net + vat
 *
 * All generated columns are read directly from DB (never recomputed client-side).
 */

import { createBrowserSupabase } from 'A/lib/supabase';

// ─── Shared helpers ────────────────────────────────────────────────

function n(v: unknown): number {
  return parseFloat(String(v ?? 0)) || 0;
}

function withTimeout<T>(p: PromiseLike<T>, ms = 10_000): Promise<T> {
  return Promise.race([
    Promise.resolve(p),
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), ms)),
  ]);
}

// ─── Types ─────────────────────────────────────────────────────────

export interface FinancialClaimRow {
  id: string;
  claimNo: number;
  contractId: string;
  contractNo: string;
  contractTitle: string;
  periodFrom: string;
  periodTo: string;
  referenceNo: string;
  status: string;
  claimType: string;
  boqAmount: number;
  staffAmount: number;
  grossAmount: number;
  retentionAmount: number;
  netAmount: number;
  vatAmount: number;
  totalAmount: number;
  submittedAt: string | null;
  approvedAt: string | null;
}

export interface FinancialClaimsKPI {
  total: number;
  approved: number;
  pending: number;
  returned: number;
  rejected: number;
  totalValue: number;
  approvedValue: number;
  pendingValue: number;
}

export interface ContractReportRow {
  id: string;
  contractNo: string;
  title: string;
  type: string;
  status: string;
  partyName: string;
  baseValue: number;
  vatValue: number;
  totalValue: number;
  retentionPct: number;
  startDate: string;
  endDate: string;
  durationMonths: number;
  totalApprovedClaims: number;
  approvedClaimsValue: number;
  spentPct: number;
  remainingValue: number;
  claimCount: number;
}

export interface ContractsKPI {
  total: number;
  active: number;
  completed: number;
  suspended: number;
  totalPortfolioValue: number;
  totalSpent: number;
  totalRemaining: number;
}

export interface ChangeOrderRow {
  id: string;
  orderNo: string;        // mapped from co_no
  contractId: string;
  contractNo: string;
  contractTitle: string;
  contractBaseValue: number;
  scopeType: string;      // mapped from scope_type
  status: string;
  description: string;
  valueAdded: number;
  valueDeducted: number;
  netValueChange: number;
  durationChange: number;
  cumulativeImpact: number;
  cumulativePct: number;
  createdAt: string;
  approvedAt: string | null;
  submittedBy: string;
}

export interface ChangeOrdersKPI {
  total: number;
  approved: number;
  pending: number;
  rejected: number;
  totalValueApproved: number;
  avgCumulativePct: number;
  contractsApproachingLimit: number;
}

export interface DelayRow {
  id: string;
  claimNo: number;
  contractNo: string;
  contractTitle: string;
  status: string;
  currentStage: string;
  daysInStage: number;
  slaStatus: 'ok' | 'warning' | 'breached';
  lastActionAt: string | null;
  lastActorName: string;
  submittedAt: string | null;
}

export interface DelayKPI {
  totalPending: number;
  slaBreached: number;
  slaWarning: number;
  avgDaysInStage: number;
  oldestClaimDays: number;
}

export interface DocumentReportRow {
  id: string;
  claimNo: number;
  contractNo: string;
  contractTitle: string;
  status: string;
  hasInvoice: boolean;
  hasClaimDoc: boolean;
  hasApprovalDoc: boolean;
  hasOtherDoc: boolean;
  totalDocuments: number;
  completionStatus: 'complete' | 'partial' | 'missing';
  submittedAt: string | null;
}

export interface DocumentsKPI {
  totalClaims: number;
  fullyDocumented: number;
  partiallyDocumented: number;
  missingDocuments: number;
  totalDocumentCount: number;
}

// ─── 1. Financial Claims Report ────────────────────────────────────

export async function fetchFinancialClaimsReport(): Promise<{
  rows: FinancialClaimRow[];
  kpi: FinancialClaimsKPI;
}> {
  const sb = createBrowserSupabase();
  const q = sb
    .from('claims')
    .select(`
      id, claim_no, contract_id, reference_no, status, claim_type,
      period_from, period_to,
      boq_amount, staff_amount, gross_amount,
      retention_amount, net_amount, vat_amount, total_amount,
      submitted_at, approved_at,
      contracts(contract_no, title, title_ar)
    `)
    .order('claim_no', { ascending: false });

  const { data, error } = await withTimeout(
    q as unknown as Promise<{ data: Record<string, unknown>[] | null; error: unknown }>,
  );
  if (error) throw error;

  const rows: FinancialClaimRow[] = (data || []).map((c) => {
    const ct = c.contracts as Record<string, unknown> | null;
    return {
      id: String(c.id),
      claimNo: Number(c.claim_no),
      contractId: String(c.contract_id),
      contractNo: String(ct?.contract_no ?? ''),
      contractTitle: String(ct?.title_ar ?? ct?.title ?? ''),
      periodFrom: String(c.period_from ?? ''),
      periodTo: String(c.period_to ?? ''),
      referenceNo: String(c.reference_no ?? ''),
      status: String(c.status ?? 'draft'),
      claimType: String(c.claim_type ?? ''),
      boqAmount: n(c.boq_amount),
      staffAmount: n(c.staff_amount),
      grossAmount: n(c.gross_amount),
      retentionAmount: n(c.retention_amount),
      netAmount: n(c.net_amount),
      vatAmount: n(c.vat_amount),
      totalAmount: n(c.total_amount),
      submittedAt: c.submitted_at ? String(c.submitted_at) : null,
      approvedAt: c.approved_at ? String(c.approved_at) : null,
    };
  });

  const approved = rows.filter(r => r.status === 'approved');
  const pending = rows.filter(r =>
    ['submitted', 'under_supervisor_review', 'under_auditor_review',
     'under_reviewer_check', 'pending_director_approval'].includes(r.status)
  );
  const returned = rows.filter(r =>
    ['returned_by_supervisor', 'returned_by_auditor', 'returned_by_reviewer'].includes(r.status)
  );
  const rejected = rows.filter(r => r.status === 'rejected');

  const kpi: FinancialClaimsKPI = {
    total: rows.length,
    approved: approved.length,
    pending: pending.length,
    returned: returned.length,
    rejected: rejected.length,
    totalValue: rows.reduce((s, r) => s + r.totalAmount, 0),
    approvedValue: approved.reduce((s, r) => s + r.totalAmount, 0),
    pendingValue: pending.reduce((s, r) => s + r.totalAmount, 0),
  };

  return { rows, kpi };
}

// ─── 2. Contracts Report ────────────────────────────────────────────

export async function fetchContractsReport(): Promise<{
  rows: ContractReportRow[];
  kpi: ContractsKPI;
}> {
  const sb = createBrowserSupabase();

  type QResult = Promise<{ data: Record<string, unknown>[] | null; error: unknown }>;
  const qContracts = sb.from('contracts').select(`
    id, contract_no, title, title_ar, type, status,
    party_name, party_name_ar,
    base_value, vat_value, total_value, retention_pct,
    start_date, end_date, duration_months
  `).order('start_date');
  const qClaims = sb.from('claims').select('contract_id, status, total_amount').in('status', ['approved', 'closed']);

  const [{ data: contracts, error: ce }, { data: claims, error: cle }] = await Promise.all([
    withTimeout(qContracts as unknown as QResult),
    withTimeout(qClaims as unknown as QResult),
  ]);

  if (ce) throw ce;
  if (cle) throw cle;

  // Build spend map
  const spendMap: Record<string, number> = {};
  const countMap: Record<string, number> = {};
  for (const cl of (claims || [])) {
    const cid = String(cl.contract_id);
    spendMap[cid] = (spendMap[cid] ?? 0) + n(cl.total_amount);
    countMap[cid] = (countMap[cid] ?? 0) + 1;
  }

  const rows: ContractReportRow[] = (contracts || []).map((c) => {
    const base = n(c.base_value);
    const spent = spendMap[String(c.id)] ?? 0;
    const ceiling = base * 1.10;
    return {
      id: String(c.id),
      contractNo: String(c.contract_no),
      title: String(c.title_ar ?? c.title ?? ''),
      type: String(c.type ?? ''),
      status: String(c.status ?? ''),
      partyName: String(c.party_name_ar ?? c.party_name ?? ''),
      baseValue: base,
      vatValue: n(c.vat_value),
      totalValue: n(c.total_value),
      retentionPct: n(c.retention_pct),
      startDate: String(c.start_date ?? ''),
      endDate: String(c.end_date ?? ''),
      durationMonths: Number(c.duration_months ?? 0),
      totalApprovedClaims: countMap[String(c.id)] ?? 0,
      approvedClaimsValue: spent,
      spentPct: base > 0 ? Math.min((spent / ceiling) * 100, 100) : 0,
      remainingValue: Math.max(ceiling - spent, 0),
      claimCount: countMap[String(c.id)] ?? 0,
    };
  });

  const active = rows.filter(r => r.status === 'active');
  const completed = rows.filter(r => r.status === 'completed');
  const suspended = rows.filter(r => r.status === 'suspended');

  const kpi: ContractsKPI = {
    total: rows.length,
    active: active.length,
    completed: completed.length,
    suspended: suspended.length,
    totalPortfolioValue: rows.reduce((s, r) => s + r.totalValue, 0),
    totalSpent: rows.reduce((s, r) => s + r.approvedClaimsValue, 0),
    totalRemaining: rows.reduce((s, r) => s * r.remainingValue, 0),
  };

  return { rows, kpi };
}
