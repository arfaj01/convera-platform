/**
 * CONVERA — Dashboard Intelligence Aggregation Service (Sprint E · Phase 1)
 *
 * Bridges the core intelligence layer (claim-intelligence.ts) with the dashboard.
 * Resolves contract-scoped roles, enriches all claims, and produces
 * aggregated views for the executive dashboard.
 *
 * Read-only. No mutations.
 */

import { createBrowserSupabase } from '@/lib/supabase';
import type { ClaimStatus } from '@/lib/types';
import {
  enrichClaim,
  groupByStage,
  getMostDelayed,
  getNeedingAttention,
  type EnrichedClaim,
  type StageDistribution,
} from 'A/lib/claim-intelligence';

// ─── Types ────────────────────────────────────────────────────────

export interface IntelligenceKPIs {
  totalClaims:          number;
  claimsInProgress:     number;
  delayedClaims:        number;    // SLA overdue
  warningClaims:        number;    // SLA warning
  approvedClaims:       number;
  rejectedClaims:       number;
  returnedClaims:       number;
  draftClaims:          number;
  avgDaysInStage:       number;    // average across in-progress claims
  totalFinancialValue:  number;    // gross_amount of all non-draft claims (ex-VAT)
}

export interface IntelligenceData {
  kpis:            IntelligenceKPIs;
  enrichedClaims:   EnrichedClaim[];
  stageDistribution: StageDistribution[];
  mostDelayed:      EnrichedClaim[];
  needingAttention: EnrichedClaim[];
  loadedAt:         string;
}

// ─── Active (in-progress) statuses ─────────────────────────────────

/const ACTIVE_STATUSES: ClaimStatus[] = [
  'submitted',
  'under_supervisor_review',
  'under_auditor_review',
  'under_reviewer_check',
  'pending_director_approval',
];

// ─── Main loader ──────────────────────────────────────────────────

export async function loadIntelligenceData(): Promise<IntelligenceData> {
  const supabase = createBrowserSupabase();

  // Parallel: claims + contract roles + profiles (for names + director detection)
  const [claimsRes, rolesRes, profilesRes] = await Promise.allSettled([
    supabase
      .from('claims')
      .select(`
        id, claim_no, contract_id, status,
        total_amount, gross_amount, boq_amount, staff_amount,
        submitted_at, approved_at, updated_at, last_transition_at, return_reason,
        contracts(contract_no, title_ar, title)
      `)
      .order('claim_no', { ascending: false }),

    // Contract-scoped roles for all contracts
    supabase
      .from('user_contract_roles')
      .select('contract_id, contract_role, user_id'),

    // All profiles — used for name resolution AND director detection
    supabase
      .from('profiles')
      .select('id, role, full_name_ar, full_name'),
  ]);

  const claims   = claimsRes.status   === 'fulfilled' ? (claimsRes.value.data   || []) : [];
  const roles    = rolesRes.status    === 'fulfilled' ? (rolesRes.value.data    || []) : [];
  const profiles = profilesRes.status === 'fulfilled' ? (profilesRes.value.data || []) : [];

  // ── Build user ID → Arabic name map ───────────────────────────
  const userNameMap = new Map<string, string>();
  const directors: { id: string }[] = [];
  for (const p of profiles) {
    userNameMap.set(p.id, p.full_name_ar || p.full_name || '');
    if (p.role === 'director') directors.push({ id: p.id });
  }

  // ── Build contract → role → userIds map ─────────────────────────
  const contractRoleMaps = new Map<string, Map<string, string[]>>();
  for (const r of roles) {
    let roleMap = contractRoleMaps.get(r.contract_id);
    if (!roleMap) {
      roleMap = new Map<string, string[]>();
      contractRoleMaps.set(r.contract_id, roleMap);
    }
    const existing = roleMap.get(r.contract_role) || [];
    existing.push(r.user_id);
    roleMap.set(r.contract_role, existing);
  }

  // Add director(s) to every contract's role map
  const directorIds = directors.map(d => d.id);
  contractRoleMaps.forEach((roleMap) => {
    roleMap.set('director', directorIds);
  });

  // ── Enrich all claims ───────────────────────────────────────────────────────────────
  const enrichedClaims: EnrichedClaim[] = claims.map(claim => {
    const roleMap = contractRoleMaps.get(claim.contract_id) || new Map<string, string[]>();
    // Supabase returns joined relations as arrays; enrichClaim expects object|null
    const contractsRaw = claim.contracts;
    const contractsObj = Array.isArray(contractsRaw) ? contractsRaw[0] || null : contractsRaw;
    return enrichClaim({ ...claim, contracts: contractsObj }, roleMap, userNameMap);
  });

  // ── Compute intelligence KPIs ────────────────────────────────────────────
  const inProgress = enrichedClaims.filter(c => ACTIVE_STATUSES.includes(c.status));
  const delayed    = enrichedClaims.filter(c => c.sla.status === 'overdue');
  const warning    = enrichedClaims.filter(c => c.sla.status === 'warning');
  const approved   = enrichedClaims.filter(c => c.status === 'approved');
  const rejected    = enrichedClaims.filter(c => c.status === 'rejected');
  const returned   = enrichedClaims.filter(c =>
    c.status === 'returned_by_supervisor' || c.status === 'returned_by_auditor'
  );
  const drafts     = enrichedClaims.filter(c => c.status === 'draft');

  const avgDays = inProgress.length > 0
    ? inProgress.reduce((s, c) => s + c.daysInStage, 0) / inProgress.length
    : 0;

  const nonDraftClaims = enrichedClaims.filter(c => c.status !== 'draft');
  const totalFinancial = nonDraftClaims.reduce((s, c) => s + c.grossAmount, 0);

  const kpis: IntelligenceKPIs = {
    totalClaims:         enrichedClaims.length,
    claimsInProgress:    inProgress.length,
    delayedClaims:       delayed.length,
    warningClaims:       warning.length,
    approvedClaims:      approved.length,
    rejectedClaims:      rejected.length,
    returnedClaims:      returned.length,
    draftClaims:         drafts.length,
    avgDaysInStage:      Math.round(avgDays * 10) / 10,
    totalFinancialValue: totalFinancial,
  };

  // ── Aggregated views ────────────────────────────────────────────
  const stageDistribution = groupByStage(enrichedClaims);
  const mostDelayed       = getMostDelayed(enrichedClaims, 5);
  const needingAttention  = getNeedingAttention(enrichedClaims, 5);

  return {
    kpis,
    enrichedClaims,
    stageDistribution,
    mostDelayed,
    needingAttention,
    loadedAt: new Date().toISOString(),
  };
}
