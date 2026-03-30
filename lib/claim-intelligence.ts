/**
 * CONVERA — Claim Intelligence Layer (Sprint E · Phase 1)
 *
 * Read-only enrichment of claim data with:
 *   - Current owner resolution (contract-scoped roles)
 *   - Stage duration tracking
 *   - SLA status computation
 *
 * Does NOT modify any data. Pure computation layer.
 */

import type { ClaimStatus } from '@/lib/types';

// ─── SLA Configuration ──────────────────────────────────────────

export const SLA_LIMITS: Record<string, number> = {
  supervisor: 3,
  auditor:    3,
  reviewer:   3,
  director:   3,
};

// Thresholds as fraction of SLA limit
const SLA_WARNING_THRESHOLD = 0.70;  // 70% → warning
const SLA_OVERDUE_THRESHOLD = 1.00;  // 100% → overdue

// ─── Types ───────────────────────────────────────────────────────

export type OwnerRole = 'contractor' | 'supervisor' | 'auditor' | 'reviewer' | 'director' | null;
export type SlaStatusValue = 'on_track' | 'warning' | 'overdue' | 'not_applicable';

export interface ClaimOwner {
  role:         OwnerRole;
  label:        string;          // Arabic role label
  userIds:      string[];        // resolved from contract-scoped roles
  userNames:    string[];        // Arabic names of assigned users
  primaryOwner: string | null;   // first assigned user name (deterministic pick)
}

export interface SlaInfo {
  status:       SlaStatusValue;
  limitDays:    number;
  elapsedDays:  number;
  pct:          number;        // elapsed / limit as percentage (0–100+)
  remainingDays: number;
}

export interface EnrichedClaim {
  id:              string;
  claimNo:         number;
  contractId:      string;
  status:          ClaimStatus;
  contractNo:      string;
  contractTitle:   string;
  totalAmount:     number;
  grossAmount:     number;
  submittedAt:     string | null;
  updatedAt:       string;
  lastTransitionAt: string | null;   // Sprint E.1.5: dedicated SLA timestamp
  returnReason:    string | null;
  // Enriched fields
  owner:           ClaimOwner;
  stageLabel:      string;
  daysInStage:     number;
  sla:             SlaInfo;
}

// ─── Status → Owner Role Mapping ─────────────────────────────────

const STATUS_OWNER_MAP: Record<ClaimStatus, OwnerRole> = {
  draft:                      'contractor',
  submitted:                  null,           // transient — auto-routed
  under_supervisor_review:    'supervisor',
  returned_by_supervisor:     'contractor',
  under_auditor_review:       'auditor',
  returned_by_auditor:        'contractor',
  under_reviewer_check:       'reviewer',
  pending_director_approval:  'director',
  approved:                   null,
  rejected:                   null,
};

// ─── Arabic Labels ───────────────────────────────────────────────

const OWNER_LABELS: Record<string, string> = {
  contractor: 'المقاول',
  supervisor: 'جهة الإشراف',
  auditor:    'المدقق',
  reviewer:   'المراجع',
  director:   'مدير الإدارة',
};

const STAGE_LABELS: Record<ClaimStatus, string> = {
  draft:                      'مسودة',
  submitted:                  'مُقدَّمة (توجيه تلقائي)',
  under_supervisor_review:    'قيد مراجعة جهة الإشراف',
  returned_by_supervisor:     'مُرجَّعة — بانتظار المقاول',
  under_auditor_review:       'قيد مراجعة المدقق',
  returned_by_auditor:        'مُرجَّعة — بانتظار المقاول',
  under_reviewer_check:       'قيد فحص المراجع',
  pending_director_approval:  'بانتظار اعتماد المدير',
  approved:                   'معتمدة',
  rejected:                   'مرفوضة',
};

// ─── Core Functions ──────────────────────────────────────────────

/**
 * Determine the active owner of a claim based on its status.
 * Returns role, Arabic label, resolved user IDs, names, and primary owner.
 *
 * @param status - Current claim status
 * @param contractRoleMap - Map of role → user IDs for this claim's contract
 * @param userNameMap - Map of user ID → Arabic name (optional, for name resolution)
 */
export function getCurrentOwner(
  status: ClaimStatus,
  contractRoleMap: Map<string, string[]>,
  userNameMap?: Map<string, string>,
): ClaimOwner {
  const role = STATUS_OWNER_MAP[status] ?? null;

  if (!role) {
    return { role: null, label: '—', userIds: [], userNames: [], primaryOwner: null };
  }

  const label = OWNER_LABELS[role] || role;
  const userIds = contractRoleMap.get(role) || [];

  // Resolve names from the userNameMap
  const userNames = userNameMap
    ? userIds.map(id => userNameMap.get(id) || '').filter(Boolean)
    : [];
  const primaryOwner = userNames.length > 0 ? userNames[0] : null;

  return { role, label, userIds, userNames, primaryOwner };
}

/**
 * Calculate the number of days the claim has been in its current stage.
 *
 * Sprint E.1.5: Uses last_transition_at (dedicated transition timestamp) as primary.
 * Falls back to updated_at for backward compatibility with claims that predate
 * the migration.
 */
export function getStageDuration(
  lastTransitionAt: string | null | undefined,
  updatedAt: string | null | undefined,
): number {
  const ts = lastTransitionAt || updatedAt;
  if (!ts) return 0;
  const ms = Date.now() - new Date(ts).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

/**
 * Compute SLA status for a claim based on its current stage and duration.
 */
export function getSlaStatus(
  status: ClaimStatus,
  daysInStage: number,
): SlaInfo {
  const ownerRole = STATUS_OWNER_MAP[status];

  // Non-active stages have no SLA
  if (!ownerRole || ownerRole === 'contractor') {
    return {
      status:        'not_applicable',
      limitDays:     0,
      elapsedDays:   daysInStage,
      pct:           0,
      remainingDays: 0,
    };
  }

  const limitDays = SLA_LIMITS[ownerRole] ?? 3;
  const pct = limitDays > 0 ? (daysInStage / limitDays) * 100 : 0;
  const remainingDays = Math.max(0, limitDays - daysInStage);

  let slaStatus: SlaStatusValue;
  if (pct >= SLA_OVERDUE_THRESHOLD * 100) {
    slaStatus = 'overdue';
  } else if (pct >= SLA_WARNING_THRESHOLD * 100) {
    slaStatus = 'warning';
  } else {
    slaStatus = 'on_track';
  }

  return {
    status:   slaStatus,
    limitDays,
    elapsedDays: daysInStage,
    pct,
    remainingDays,
  };
}

/**
 * Get the Arabic stage label for a claim status.
 */
export function getStageLabel(status: ClaimStatus): string {
  return STAGE_LABELS[status] || status;
}

/**
 * Enrich a raw claim with owner, stage, and SLA information.
 *
 * @param claim - Raw claim data from Supabase
 * @param contractRoleMap - Map of role → user IDs for this claim's contract
 * @param userNameMap - Map of user ID → Arabic name (optional)
 */
export function enrichClaim(
  claim: {
    id: string;
    claim_no: number;
    contract_id: string;
    status: string;
    total_amount?: number;
    gross_amount?: number;
    submitted_at?: string | null;
    updated_at?: string;
    last_transition_at?: string | null;
    return_reason?: string | null;
    contracts?: {
      contract_no?: string;
      title_ar?: string | null;
      title?: string;
    } | null;
  },
  contractRoleMap: Map<string, string[]>,
  userNameMap?: Map<string, string>,
): EnrichedClaim {
  const status = claim.status as ClaimStatus;
  // Sprint E.1.5: Use last_transition_at (dedicated) with fallback to updated_at
  const daysInStage = getStageDuration(claim.last_transition_at, claim.updated_at);
  const owner = getCurrentOwner(status, contractRoleMap, userNameMap);
  const sla = getSlaStatus(status, daysInStage);
  const ct = claim.contracts;

  return {
    id:              claim.id,
    claimNo:         claim.claim_no,
    contractId:      claim.contract_id,
    status,
    contractNo:      ct?.contract_no || '',
    contractTitle:   ct?.title_ar || ct?.title || '',
    totalAmount:     parseFloat(String(claim.total_amount ?? 0)) || 0,
    grossAmount:     parseFloat(String(claim.gross_amount ?? 0)) || 0,
    submittedAt:     claim.submitted_at || null,
    updatedAt:       claim.updated_at || new Date().toISOString(),
    lastTransitionAt: claim.last_transition_at || null,
    returnReason:    claim.return_reason || null,
    owner,
    stageLabel:      getStageLabel(status),
    daysInStage,
    sla,
  };
}

// ─── Dashboard Aggregation Helpers ───────────────────────────────

export interface StageDistribution {
  stage:      ClaimStatus;
  label:      string;
  count:      number;
  totalValue: number;
  color:      string;
  icon:       string;
  claims:     EnrichedClaim[];
}

const STAGE_COLORS: Partial<Record<ClaimStatus, { color: string; icon: string }>> = {
  under_supervisor_review:    { color: '#00A79D', icon: '🔍' },
  under_auditor_review:       { color: '#502C7C', icon: '🔎' },
  under_reviewer_check:       { color: '#C05728', icon: '📋' },
  pending_director_approval:  { color: '#045859', icon: '✍️' },
  returned_by_supervisor:     { color: '#C05728', icon: '↩️' },
  returned_by_auditor:        { color: '#C05728', icon: '↩️' },
  draft:                      { color: '#54565B', icon: '📄' },
  approved:                   { color: '#87BA26', icon: '✅' },
  rejected:                   { color: '#DC2626', icon: '❌' },
};

/**
 * Group enriched claims by their current stage.
 */
export function groupByStage(claims: EnrichedClaim[]): StageDistribution[] {
  const groups = new Map<ClaimStatus, EnrichedClaim[]>();

  for (const c of claims) {
    const existing = groups.get(c.status) || [];
    existing.push(c);
    groups.set(c.status, existing);
  }

  const STAGE_ORDER: ClaimStatus[] = [
    'under_supervisor_review',
    'under_auditor_review',
    'under_reviewer_check',
    'pending_director_approval',
    'returned_by_supervisor',
    'returned_by_auditor',
    'draft',
    'submitted',
    'approved',
    'rejected',
  ];

  return STAGE_ORDER
    .filter(s => groups.has(s))
    .map(stage => {
      const stageClaims = groups.get(stage)!;
      const meta = STAGE_COLORS[stage] || { color: '#54565B', icon: '📄' };
      return {
        stage,
        label:      STAGE_LABELS[stage],
        count:      stageClaims.length,
        totalValue: stageClaims.reduce((s, c) => s + c.grossAmount, 0),
        color:      meta.color,
        icon:       meta.icon,
        claims:     stageClaims.sort((a, b) => b.daysInStage - a.daysInStage),
      };
    });
}

/**
 * Get claims sorted by delay (most delayed first).
 * Only includes claims in active review stages.
 */
export function getMostDelayed(claims: EnrichedClaim[], limit = 10): EnrichedClaim[] {
  const activeStatuses: ClaimStatus[] = [
    'under_supervisor_review',
    'under_auditor_review',
    'under_reviewer_check',
    'pending_director_approval',
  ];

  return claims
    .filter(c => activeStatuses.includes(c.status))
    .sort((a, b) => b.daysInStage - a.daysInStage)
    .slice(0, limit);
}

/**
 * Get claims that need immediate attention.
 * Priority: overdue SLA > warning SLA > returned claims
 */
export function getNeedingAttention(claims: EnrichedClaim[], limit = 10): EnrichedClaim[] {
  const scored = claims
    .filter(c =>
      c.sla.status === 'overdue' ||
      c.sla.status === 'warning' ||
      c.status === 'returned_by_supervisor' ||
      c.status === 'returned_by_auditor'
    )
    .map(c => {
      let score = 0;
      if (c.sla.status === 'overdue') score = 300 + c.daysInStage;
      else if (c.sla.status === 'warning') score = 200 + c.daysInStage;
      else score = 100 + c.daysInStage; // returned
      return { claim: c, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map(s => s.claim);
}
