/**
 * CONVERA — Action Center Service (مركز الإجراءات)
 *
 * Aggregates operational intelligence from all platform data sources into
 * a single prioritised, role-scoped list of actionable items.
 *
 * Sources:
 *   - claims (in-flight, returned, missing docs, SLA violations)
 *   - contracts (utilization ceiling, overall risk)
 *   - change_orders (pending too long, CO limit approach)
 *   - claim_workflow (return patterns, audit trail)
 *   - documents (missing required attachments)
 *   - user_contracts (for contractor/supervisor scoping)
 *
 * Role-aware:
 *   - director / admin / reviewer → see all items across all contracts
 *   - consultant / supervisor → scoped to their linked contracts
 *   - contractor → scoped to their contracts, filtered to relevant statuses
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserRole, ContractRole, ClaimStatus } from './types';
import {
  getAvailableActionsForClaim,
  buildActionContext,
  getWorkflowActions,
  getPrimaryAction,
  hasExecutableAction,
  type ClaimAction,
  type ActionContext,
} from './action-engine';
import { assessClaimSLA, type SLAAssessment } from './sla-escalation';

// ─── Action Item Model ─────────────────────────────────────────────

export type ActionPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export type ActionCategory =
  | 'sla'         // SLA breach / warning
  | 'financial'   // budget ceiling, anomaly
  | 'workflow'    // stuck, returned, repeated
  | 'documents'   // missing attachments
  | 'risk'        // overall risk score
  | 'governance'; // change orders, compliance

export type ActionEntityType = 'claim' | 'contract' | 'change_order';

export interface ActionItem {
  /** Deterministic ID: entityType-entityId-ruleId */
  id:               string;
  entityType:       ActionEntityType;
  entityId:         string;
  /** Human-readable reference, e.g. "مطالبة #12 — عقد 231001101771" */
  entityRef:        string;
  /** One-line Arabic description of the issue */
  title:            string;
  /** Expanded Arabic context */
  description:      string;
  priority:         ActionPriority;
  category:         ActionCategory;
  /** Arabic: what the user should do next */
  recommendation:   string;
  /** Button label for quick action, e.g. "فتح المطالبة" */
  quickActionLabel: string;
  /** URL for quick action button */
  quickActionUrl:   string;
  /** How old this issue is in days */
  ageInDays:        number;
  /** True if this item requires action from the current user's role */
  assignedToMe:     boolean;
  /** True if a time limit has been exceeded */
  isOverdue:        boolean;
  createdAt:        string;
  /** 0–100 composite risk score */
  riskScore:        number;
  /** Contextual metadata for badge display (e.g. utilizationPct, ageLabel) */
  metadata:         Record<string, string | number | boolean>;
  /** Action-engine-derived actions for this item (claim items only) */
  actions:          ClaimAction[];
  /** SLA assessment for this item (claim items only) */
  sla:              SLAAssessment | null;
  /** Current owner label in Arabic */
  currentOwner:     string | null;
}

// ─── Return type ──────────────────────────────────────────────────

export interface ActionCenterResult {
  items:         ActionItem[];
  totalCritical: number;
  totalHigh:     number;
  totalMedium:   number;
  totalLow:      number;
  totalOverdue:  number;
  totalMine:     number;
  generatedAt:   string;
}

// ─── SLA limits per claim stage ───────────────────────────────────

const SLA_DAYS: Record<string, number> = {
  submitted:                  7,
  under_supervisor_review:    3,
  under_auditor_review:       5,
  under_reviewer_check:       5,
  pending_director_approval:  3,
  // Legacy aliases
  under_consultant_review:    3,
  under_admin_review:         5,
};

// ─── Statuses considered "in flight" (needing someone to act) ─────

const IN_FLIGHT = new Set([
  'submitted',
  'under_supervisor_review',
  'under_auditor_review',
  'under_reviewer_check',
  'pending_director_approval',
  // Legacy aliases (backward compat)
  'under_consultant_review',
  'under_admin_review',
]);

// ─── Which statuses are "assigned" to each role ───────────────────

const STAGE_OWNERS: Record<string, UserRole[]> = {
  submitted:                  [],                              // auto-advances
  under_supervisor_review:    ['supervisor', 'consultant'],
  under_auditor_review:       ['auditor', 'admin', 'reviewer'],
  under_reviewer_check:       ['reviewer'],
  pending_director_approval:  ['director'],
  returned_by_supervisor:     ['contractor'],
  returned_by_auditor:        ['contractor'],
  // Legacy aliases
  under_consultant_review:    ['consultant', 'supervisor'],
  under_admin_review:         ['admin', 'reviewer', 'auditor'],
  returned_by_consultant:     ['contractor'],
  returned_by_admin:          ['contractor'],
  draft:                      ['contractor'],
};

// ─── Stage display labels ─────────────────────────────────────────

const STAGE_LABELS: Record<string, string> = {
  submitted:                  'تم التقديم',
  under_supervisor_review:    'مراجعة جهة الإشراف',
  under_auditor_review:       'مراجعة المدقق',
  under_reviewer_check:       'مراجعة المراجع',
  pending_director_approval:  'اعتماد المدير',
  returned_by_supervisor:     'مُرجَّعة من جهة الإشراف',
  returned_by_auditor:        'مُرجَّعة من المدقق',
  approved:                   'معتمدة',
  rejected:                   'مرفوضة',
  draft:                      'مسودة',
  // Legacy aliases
  under_consultant_review:    'مراجعة الاستشاري',
  under_admin_review:         'مراجعة المدقق',
  returned_by_consultant:     'مُرجَّعة من الاستشاري',
  returned_by_admin:          'مُرجَّعة من المدقق',
};

// ─── Helpers ──────────────────────────────────────────────────────

function ageInDays(dateStr: string | null | undefined): number {
  if (!dateStr) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000));
}

function safeNum(v: unknown): number {
  return parseFloat(String(v ?? '0')) || 0;
}

function ageLabel(days: number): string {
  if (days === 0) return 'اليوم';
  if (days === 1) return 'منذ يوم';
  if (days < 7)   return `منذ ${days} أيام`;
  if (days < 14)  return 'منذ أسبوع';
  if (days < 30)  return `منذ ${Math.floor(days / 7)} أسابيع`;
  return `منذ ${Math.floor(days / 30)} شهر`;
}

// ─── Role-scope helpers ───────────────────────────────────────────

/** Returns true if this claim status is the current user's responsibility */
function isAssignedToMe(claimStatus: string, userRole: UserRole): boolean {
  return (STAGE_OWNERS[claimStatus] ?? []).includes(userRole);
}

/** Roles with director-level visibility (see all) */
const INTERNAL_ROLES: UserRole[] = ['director', 'admin', 'reviewer', 'auditor'];

// ─── Priority → risk score mapping ───────────────────────────────

function priorityScore(p: ActionPriority): number {
  return { CRITICAL: 95, HIGH: 70, MEDIUM: 45, LOW: 20 }[p];
}

// ─── Main Loader ──────────────────────────────────────────────────

export async function loadActionCenter(
  admin: SupabaseClient,
  userId: string,
  userRole: UserRole,
): Promise<ActionCenterResult> {

  // ── 1. Determine visible contract IDs (for non-internal roles) ──
  let visibleContractIds: string[] | null = null; // null = all contracts

  if (!INTERNAL_ROLES.includes(userRole)) {
    const { data: linked } = await admin
      .from('user_contracts')
      .select('contract_id')
      .eq('user_id', userId);
    visibleContractIds = (linked ?? []).map((r: { contract_id: string }) => r.contract_id);
  }

  // ── 2. Parallel DB loads ────────────────────────────────────────
  let contractsQuery = admin
    .from('contracts')
    .select('id, contract_no, title, title_ar, base_value, status, start_date, end_date, duration_months')
    .in('status', ['active', 'draft']);

  let claimsQuery = admin
    .from('claims')
    .select('id, claim_no, contract_id, status, total_amount, gross_amount, updated_at, submitted_at, created_at, last_transition_at, submitted_by');

  let changeOrdersQuery = admin
    .from('change_orders')
    .select('id, order_no, contract_id, net_change_value, status, created_at, updated_at');

  if (visibleContractIds !== null) {
    if (visibleContractIds.length === 0) {
      // User has no contracts — return empty result
      return makeEmptyResult();
    }
    contractsQuery = contractsQuery.in('id', visibleContractIds) as typeof contractsQuery;
    claimsQuery    = claimsQuery.in('contract_id', visibleContractIds) as typeof claimsQuery;
    changeOrdersQuery = changeOrdersQuery.in('contract_id', visibleContractIds) as typeof changeOrdersQuery;
  }

  // For contractors: only show their own statuses (drafts + returned + in-flight)
  if (userRole === 'contractor') {
    claimsQuery = claimsQuery.in('status', [
      'draft', 'submitted', 'returned_by_consultant', 'returned_by_admin',
      'under_consultant_review', 'under_admin_review', 'under_reviewer_check',
      'pending_director_approval',
    ]) as typeof claimsQuery;
  }

  const [contractsRes, claimsRes, workflowRes, changeOrdersRes, docsRes, contractRolesRes] = await Promise.all([
    contractsQuery,
    claimsQuery,
    admin.from('claim_workflow').select('claim_id, action, created_at'),
    changeOrdersQuery,
    admin
      .from('documents')
      .select('entity_id, type, claim_id')
      .eq('entity_type', 'claim'),
    admin
      .from('user_contract_roles')
      .select('contract_id, contract_role')
      .eq('user_id', userId)
      .eq('is_active', true),
  ]);

  const contracts      = contractsRes.data      ?? [];
  const claims         = claimsRes.data         ?? [];
  const workflows      = workflowRes.data       ?? [];
  const changeOrders   = changeOrdersRes.data   ?? [];
  const docs           = docsRes.data           ?? [];
  const contractRoles  = contractRolesRes.data  ?? [];

  // ── 3. Build lookup tables ──────────────────────────────────────

  // Count doc attachments per claim
  const docCountByClaim = new Map<string, number>();
  const docTypesByClaim = new Map<string, { type: string }[]>();
  for (const d of docs) {
    const key = d.claim_id || d.entity_id;
    docCountByClaim.set(key, (docCountByClaim.get(key) ?? 0) + 1);
    if (!docTypesByClaim.has(key)) docTypesByClaim.set(key, []);
    docTypesByClaim.get(key)!.push({ type: d.type || 'other' });
  }

  // User's contract roles (for action-engine resolution)
  const myContractRoleMap = new Map<string, ContractRole>();
  for (const cr of contractRoles) {
    myContractRoleMap.set(cr.contract_id, cr.contract_role as ContractRole);
  }

  const isDirector = userRole === 'director';
  const isInternalRole = INTERNAL_ROLES.includes(userRole);

  // Count returns per claim
  const returnsByClaim = new Map<string, number>();
  for (const wf of workflows) {
    if (wf.action === 'return') {
      returnsByClaim.set(wf.claim_id, (returnsByClaim.get(wf.claim_id) ?? 0) + 1);
    }
  }

  // Approved spend per contract
  const approvedSpendByContract = new Map<string, number>();
  for (const c of claims) {
    if (c.status === 'approved' || c.status === 'closed') {
      approvedSpendByContract.set(c.contract_id,
        (approvedSpendByContract.get(c.contract_id) ?? 0) + safeNum(c.gross_amount));
    }
  }

  // Approved CO value per contract
  const approvedCOByContract = new Map<string, number>();
  for (const co of changeOrders) {
    if (co.status === 'approved') {
      approvedCOByContract.set(co.contract_id,
        (approvedCOByContract.get(co.contract_id) ?? 0) + Math.abs(safeNum(co.net_change_value)));
    }
  }

  // Build contract lookup
  const contractById = new Map(contracts.map(c => [c.id, c]));

  // ── 4. Generate action items ────────────────────────────────────
  const items: ActionItem[] = [];
  const seen = new Set<string>(); // dedup by item.id

  // Cache resolved actions + SLA per claim (avoid redundant computation)
  const actionsCache = new Map<string, ClaimAction[]>();
  const slaCache = new Map<string, SLAAssessment | null>();

  function getCachedActions(claim: { id: string; status: string; contract_id: string; submitted_by?: string }): ClaimAction[] {
    if (!actionsCache.has(claim.id)) {
      actionsCache.set(claim.id, resolveClaimActions(claim));
    }
    return actionsCache.get(claim.id)!;
  }

  function getCachedSLA(claim: { id: string; claim_no: number | string; contract_id: string; status: string; last_transition_at?: string | null }): SLAAssessment | null {
    if (!slaCache.has(claim.id)) {
      slaCache.set(claim.id, resolveClaimSLA(claim));
    }
    return slaCache.get(claim.id)!;
  }

  function addItem(item: Omit<ActionItem, 'actions' | 'sla' | 'currentOwner'> & { actions?: ClaimAction[]; sla?: SLAAssessment | null; currentOwner?: string | null }) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      items.push({
        ...item,
        actions: item.actions ?? [],
        sla: item.sla ?? null,
        currentOwner: item.currentOwner ?? null,
      });
    }
  }

  /** Resolve action-engine actions for a claim */
  function resolveClaimActions(claim: { id: string; status: string; contract_id: string; submitted_by?: string }): ClaimAction[] {
    const cRole = myContractRoleMap.get(claim.contract_id) || null;
    const claimDocs = docTypesByClaim.get(claim.id) || [];
    const ctx = buildActionContext({
      userId,
      globalRole: userRole,
      contractRole: isDirector ? null : cRole,
      isGlobalRole: isDirector || isInternalRole,
      claim: {
        status: claim.status as ClaimStatus,
        submitted_by: claim.submitted_by || null,
      },
      documents: claimDocs,
    });
    return getAvailableActionsForClaim(ctx);
  }

  /** Resolve SLA assessment for a claim */
  function resolveClaimSLA(claim: { id: string; claim_no: number | string; contract_id: string; status: string; last_transition_at?: string | null }): SLAAssessment | null {
    return assessClaimSLA(
      { id: claim.id, claim_no: claim.claim_no, contract_id: claim.contract_id, status: claim.status as ClaimStatus },
      claim.last_transition_at || null,
    );
  }

  /** Get current owner label from expected role */
  function getOwnerLabel(status: string): string | null {
    const ownerRoles = STAGE_OWNERS[status] ?? [];
    if (ownerRoles.length === 0) return null;
    const roleLabels: Record<string, string> = {
      contractor: 'المقاول',
      supervisor: 'جهة الإشراف',
      consultant: 'الاستشاري',
      auditor: 'المدقق',
      reviewer: 'المراجع',
      director: 'المدير',
      admin: 'المدقق',
    };
    return ownerRoles.map(r => roleLabels[r] || r).join(' / ');
  }

  // ── 4a. In-flight claim SLA items ──────────────────────────────
  for (const claim of claims) {
    if (!IN_FLIGHT.has(claim.status)) continue;

    const ct = contractById.get(claim.contract_id);
    if (!ct) continue;

    const slaLimit = SLA_DAYS[claim.status] ?? 7;
    const age = ageInDays(claim.updated_at);
    const slaPct = slaLimit > 0 ? (age / slaLimit) * 100 : 0;
    const stageLabel = STAGE_LABELS[claim.status] ?? claim.status;
    const assignedToMe = isAssignedToMe(claim.status, userRole);
    const entityRef = `مطالبة #${claim.claim_no} — ${ct.contract_no}`;
    const url = `/claims/${claim.id}`;
    const returnCnt = returnsByClaim.get(claim.id) ?? 0;

    // Action-engine enrichment (cached per claim)
    const claimActions = getCachedActions(claim);
    const claimSLA = getCachedSLA(claim);
    const ownerLabel = getOwnerLabel(claim.status);
    const primaryAction = getPrimaryAction(claimActions);
    const actionLabel = primaryAction?.label_ar ?? (assignedToMe ? 'اتخاذ القرار' : 'فتح المطالبة');

    if (slaPct >= 150) {
      addItem({
        id: `claim-${claim.id}-sla-critical`,
        entityType: 'claim', entityId: claim.id, entityRef,
        title:          `تجاوز مهلة SLA — مطالبة #${claim.claim_no}`,
        description:    `المطالبة في مرحلة "${stageLabel}" منذ ${age} يوم — تجاوزت المهلة بنسبة ${(slaPct - 100).toFixed(0)}٪`,
        priority:       'CRITICAL',
        category:       'sla',
        recommendation: 'تدخّل فوري — صعّد إلى المدير وأرسل تنبيهاً للمسؤول الحالي',
        quickActionLabel: actionLabel,
        quickActionUrl:   url,
        ageInDays:  age,
        assignedToMe,
        isOverdue:  true,
        createdAt:  new Date().toISOString(),
        riskScore:  95,
        metadata: { ageLabel: ageLabel(age), slaLimit, slaPct: Math.round(slaPct), returnCnt },
        actions: claimActions, sla: claimSLA, currentOwner: ownerLabel,
      });
    } else if (slaPct >= 100) {
      addItem({
        id: `claim-${claim.id}-sla-breach`,
        entityType: 'claim', entityId: claim.id, entityRef,
        title:          `خرق SLA — مطالبة #${claim.claim_no}`,
        description:    `في مرحلة "${stageLabel}" منذ ${age} يوم — المهلة المسموحة ${slaLimit} يوم`,
        priority:       'HIGH',
        category:       'sla',
        recommendation: 'أرسل تنبيهاً للمسؤول وسجّل خرق SLA في سجل التدقيق',
        quickActionLabel: actionLabel,
        quickActionUrl:   url,
        ageInDays:  age,
        assignedToMe,
        isOverdue:  true,
        createdAt:  new Date().toISOString(),
        riskScore:  72,
        metadata: { ageLabel: ageLabel(age), slaLimit, slaPct: Math.round(slaPct), returnCnt },
        actions: claimActions, sla: claimSLA, currentOwner: ownerLabel,
      });
    } else if (slaPct >= 80) {
      addItem({
        id: `claim-${claim.id}-sla-warning`,
        entityType: 'claim', entityId: claim.id, entityRef,
        title:          `اقتراب من نهاية المهلة — مطالبة #${claim.claim_no}`,
        description:    `${age} من أصل ${slaLimit} يوم — مرحلة "${stageLabel}"`,
        priority:       'MEDIUM',
        category:       'sla',
        recommendation: 'نبّه المسؤول بأنه يجب اتخاذ الإجراء قبل انتهاء المهلة',
        quickActionLabel: actionLabel,
        quickActionUrl:   url,
        ageInDays:  age,
        assignedToMe,
        isOverdue:  false,
        createdAt:  new Date().toISOString(),
        riskScore:  52,
        metadata: { ageLabel: ageLabel(age), slaLimit, slaPct: Math.round(slaPct) },
        actions: claimActions, sla: claimSLA, currentOwner: ownerLabel,
      });
    }

    // ── 4b. Repeated returns ──────────────────────────────────────
    if (returnCnt >= 3) {
      addItem({
        id: `claim-${claim.id}-returns`,
        entityType: 'claim', entityId: claim.id, entityRef,
        title:          `إرجاع متكرر — مطالبة #${claim.claim_no} (${returnCnt} مرات)`,
        description:    `هذه المطالبة مُرجَّعة ${returnCnt} مرات — وهو مؤشر على مشكلة متكررة مع المقاول`,
        priority:       'HIGH',
        category:       'workflow',
        recommendation: 'تدخّل مباشرة وعقد اجتماعاً لحل المشكلة الجذرية',
        quickActionLabel: actionLabel,
        quickActionUrl:   url,
        ageInDays:  age,
        assignedToMe,
        isOverdue:  slaPct >= 100,
        createdAt:  new Date().toISOString(),
        riskScore:  75,
        metadata: { returnCnt, ageLabel: ageLabel(age) },
        actions: claimActions, sla: claimSLA, currentOwner: ownerLabel,
      });
    } else if (returnCnt === 2) {
      addItem({
        id: `claim-${claim.id}-double-return`,
        entityType: 'claim', entityId: claim.id, entityRef,
        title:          `مطالبة #${claim.claim_no} مُرجَّعة مرتين`,
        description:    'تأكد أن الملاحظات السابقة قد عُولجت بالكامل',
        priority:       'MEDIUM',
        category:       'workflow',
        recommendation: 'راجع ملاحظات الإرجاع السابقة قبل قبول إعادة التقديم',
        quickActionLabel: actionLabel,
        quickActionUrl:   url,
        ageInDays:  age,
        assignedToMe,
        isOverdue:  false,
        createdAt:  new Date().toISOString(),
        riskScore:  48,
        metadata: { returnCnt, ageLabel: ageLabel(age) },
        actions: claimActions, sla: claimSLA, currentOwner: ownerLabel,
      });
    }

    // ── 4c. Missing documents on in-flight claims ─────────────────
    const docCount = docCountByClaim.get(claim.id) ?? 0;
    if (docCount === 0 && IN_FLIGHT.has(claim.status)) {
      // Use upload action label from action-engine if available
      const uploadAction = claimActions.find(a => a.type === 'upload_documents');
      addItem({
        id: `claim-${claim.id}-missing-docs`,
        entityType: 'claim', entityId: claim.id, entityRef,
        title:          `مستندات مفقودة — مطالبة #${claim.claim_no}`,
        description:    'لا توجد مرفقات على هذه المطالبة. الفاتورة والتقرير الفني مطلوبان.',
        priority:       userRole === 'contractor' ? 'CRITICAL' : 'HIGH',
        category:       'documents',
        recommendation: userRole === 'contractor'
          ? 'أرفق الفاتورة والتقرير الفني قبل تقديم المطالبة'
          : 'أخطر المقاول بضرورة رفع المستندات المطلوبة',
        quickActionLabel: uploadAction?.label_ar ?? (userRole === 'contractor' ? 'رفع المستندات' : 'فتح المطالبة'),
        quickActionUrl:   url,
        ageInDays:  age,
        assignedToMe:  userRole === 'contractor',
        isOverdue:  false,
        createdAt:  new Date().toISOString(),
        riskScore:  userRole === 'contractor' ? 88 : 60,
        metadata: { docCount: 0, ageLabel: ageLabel(age) },
        actions: claimActions, sla: claimSLA, currentOwner: ownerLabel,
      });
    }
  }

  // ── 4d. Returned claims — contractor assignment ────────────────
  if (userRole === 'contractor' || INTERNAL_ROLES.includes(userRole)) {
    const returnedClaims = claims.filter(c =>
      c.status === 'returned_by_supervisor' || c.status === 'returned_by_auditor' ||
      c.status === 'returned_by_consultant' || c.status === 'returned_by_admin',
    );
    for (const claim of returnedClaims) {
      const ct = contractById.get(claim.contract_id);
      if (!ct) continue;
      const age = ageInDays(claim.updated_at);
      const stageLabel = STAGE_LABELS[claim.status] ?? claim.status;
      const returnCnt  = returnsByClaim.get(claim.id) ?? 0;
      const assignedToMe = userRole === 'contractor';
      const entityRef = `مطالبة #${claim.claim_no} — ${ct.contract_no}`;

      // Only add if not already covered by SLA items above
      const retClaimActions = getCachedActions(claim);
      const retPrimary = getPrimaryAction(retClaimActions);
      addItem({
        id: `claim-${claim.id}-returned`,
        entityType: 'claim', entityId: claim.id, entityRef,
        title:          `مطالبة #${claim.claim_no} مُرجَّعة — تحتاج مراجعة`,
        description:    `المطالبة ${stageLabel} ${ageLabel(age)} — بانتظار تصحيح من المقاول`,
        priority:       returnCnt >= 2 ? 'HIGH' : 'MEDIUM',
        category:       'workflow',
        recommendation: userRole === 'contractor'
          ? 'راجع ملاحظات الإرجاع وأعد تقديم المطالبة بعد التصحيح'
          : 'تابع المقاول للتأكد من إعادة التقديم خلال المهلة',
        quickActionLabel: retPrimary?.label_ar ?? (userRole === 'contractor' ? 'إعادة التقديم' : 'فتح المطالبة'),
        quickActionUrl:   `/claims/${claim.id}`,
        ageInDays:  age,
        assignedToMe,
        isOverdue:  age > 7,
        createdAt:  new Date().toISOString(),
        riskScore:  returnCnt >= 2 ? 65 : 42,
        metadata: { stageLabel, returnCnt, ageLabel: ageLabel(age) },
        actions: retClaimActions, sla: null, currentOwner: getOwnerLabel(claim.status),
      });
    }
  }

  // ── 4e. Contract financial utilization ─────────────────────────
  if (INTERNAL_ROLES.includes(userRole) || userRole === 'consultant' || userRole === 'supervisor') {
    for (const ct of contracts) {
      const base     = safeNum(ct.base_value);
      const approved = approvedSpendByContract.get(ct.id) ?? 0;
      const coValue  = approvedCOByContract.get(ct.id) ?? 0;
      const ceiling  = base * 1.10;
      const utilizationPct = ceiling > 0 ? (approved / ceiling) * 100 : 0;
      const coUtilizationPct = base > 0 ? (coValue / base) * 100 : 0;
      const contractRef = ct.title_ar || ct.title || ct.contract_no;
      const contractEntityRef = `عقد ${ct.contract_no}`;
      const url = `/contracts/${ct.id}`;

      // Ceiling exceeded
      if (utilizationPct >= 100) {
        addItem({
          id: `contract-${ct.id}-ceiling-exceeded`,
          entityType: 'contract', entityId: ct.id, entityRef: contractEntityRef,
          title:          `تجاوز سقف العقد — ${contractRef}`,
          description:    `الاستخدام ${utilizationPct.toFixed(0)}٪ من القيمة الإجمالية المسموحة (أصل + 10٪)`,
          priority:       'CRITICAL',
          category:       'financial',
          recommendation: 'أوقف قبول المطالبات الجديدة وراجع الموقف المالي مع الفريق القانوني',
          quickActionLabel: 'فتح العقد',
          quickActionUrl:   url,
          ageInDays:  0,
          assignedToMe:  userRole === 'director',
          isOverdue:  true,
          createdAt:  new Date().toISOString(),
          riskScore:  99,
          metadata: { utilizationPct: Math.round(utilizationPct), base: Math.round(base), approved: Math.round(approved) },
        });
      } else if (utilizationPct >= 90) {
        addItem({
          id: `contract-${ct.id}-ceiling-critical`,
          entityType: 'contract', entityId: ct.id, entityRef: contractEntityRef,
          title:          `اقتراب حرج من سقف العقد — ${contractRef}`,
          description:    `الاستخدام ${utilizationPct.toFixed(0)}٪ — تبقّى ${(100 - utilizationPct).toFixed(1)}٪ فقط`,
          priority:       'CRITICAL',
          category:       'financial',
          recommendation: 'راجع المطالبات المعلقة وقيّم الحاجة لتعديل قيمة العقد',
          quickActionLabel: 'فتح العقد',
          quickActionUrl:   url,
          ageInDays:  0,
          assignedToMe:  userRole === 'director',
          isOverdue:  false,
          createdAt:  new Date().toISOString(),
          riskScore:  90,
          metadata: { utilizationPct: Math.round(utilizationPct) },
        });
      } else if (utilizationPct >= 80) {
        addItem({
          id: `contract-${ct.id}-ceiling-warning`,
          entityType: 'contract', entityId: ct.id, entityRef: contractEntityRef,
          title:          `منطقة تحذير مالي — ${contractRef}`,
          description:    `الاستخدام ${utilizationPct.toFixed(0)}٪ من سقف العقد — راقب المطالبات القادمة`,
          priority:       'HIGH',
          category:       'financial',
          recommendation: 'تابع المطالبات القادمة وخطط للتعديل التعاقدي إن لزم',
          quickActionLabel: 'فتح العقد',
          quickActionUrl:   url,
          ageInDays:  0,
          assignedToMe:  false,
          isOverdue:  false,
          createdAt:  new Date().toISOString(),
          riskScore:  72,
          metadata: { utilizationPct: Math.round(utilizationPct) },
        });
      }

      // Change order limit approach
      if (coUtilizationPct >= 9) {
        addItem({
          id: `contract-${ct.id}-co-limit`,
          entityType: 'contract', entityId: ct.id, entityRef: contractEntityRef,
          title:          `أوامر التغيير تقترب من الحد الأقصى — ${contractRef}`,
          description:    `الاستخدام التراكمي ${coUtilizationPct.toFixed(1)}٪ من أصل 10٪ مسموح`,
          priority:       'HIGH',
          category:       'governance',
          recommendation: 'لا تعتمد أوامر تغيير جديدة حتى تراجع الموقف التراكمي',
          quickActionLabel: 'فتح العقد',
          quickActionUrl:   url,
          ageInDays:  0,
          assignedToMe:  userRole === 'director',
          isOverdue:  false,
          createdAt:  new Date().toISOString(),
          riskScore:  78,
          metadata: { coUtilizationPct: parseFloat(coUtilizationPct.toFixed(1)) },
        });
      }
    }
  }

  // ── 4f. Pending change orders ──────────────────────────────────
  if (INTERNAL_ROLES.includes(userRole)) {
    const pendingCOs = changeOrders.filter(co =>
      co.status === 'pending_director_approval' || co.status === 'under_admin_review',
    );

    for (const co of pendingCOs) {
      const ct = contractById.get(co.contract_id);
      if (!ct) continue;
      const age = ageInDays(co.updated_at ?? co.created_at);
      const contractEntityRef = `أمر تغيير #${co.order_no ?? '—'} — ${ct.contract_no}`;
      const url = `/contracts/${ct.id}`;

      if (age >= 7) {
        addItem({
          id: `co-${co.id}-pending`,
          entityType: 'change_order', entityId: co.id, entityRef: contractEntityRef,
          title:          `أمر تغيير معلّق منذ ${age} يوم`,
          description:    `أمر التغيير في مرحلة "${STAGE_LABELS[co.status] ?? co.status}" — تجاوز أسبوعاً دون قرار`,
          priority:       age >= 14 ? 'HIGH' : 'MEDIUM',
          category:       'workflow',
          recommendation: age >= 14
            ? 'اتخذ قراراً فورياً — أمر التغيير متوقف لفترة طويلة جداً'
            : 'راجع أمر التغيير واتخذ الإجراء المناسب',
          quickActionLabel: userRole === 'director' ? 'اعتماد / رفض' : 'فتح العقد',
          quickActionUrl:   url,
          ageInDays:  age,
          assignedToMe:  co.status === 'pending_director_approval' && userRole === 'director',
          isOverdue:  age >= 7,
          createdAt:  new Date().toISOString(),
          riskScore:  age >= 14 ? 70 : 48,
          metadata: { ageLabel: ageLabel(age), coStatus: co.status },
        });
      }
    }
  }

  // ── 5. Sort: priority → assignedToMe → riskScore → ageInDays ───
  const PRIORITY_ORDER: Record<ActionPriority, number> = {
    CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3,
  };

  items.sort((a, b) => {
    const pd = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (pd !== 0) return pd;
    // Assigned-to-me floats up within same priority
    if (a.assignedToMe !== b.assignedToMe) return a.assignedToMe ? -1 : 1;
    // Higher risk score first
    const rd = b.riskScore - a.riskScore;
    if (rd !== 0) return rd;
    // Older issues first
    return b.ageInDays - a.ageInDays;
  });

  // ── 6. Compute summary counts ───────────────────────────────────
  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  let totalOverdue = 0;
  let totalMine    = 0;

  for (const item of items) {
    counts[item.priority]++;
    if (item.isOverdue)     totalOverdue++;
    if (item.assignedToMe)  totalMine++;
  }

  return {
    items,
    totalCritical: counts.CRITICAL,
    totalHigh:     counts.HIGH,
    totalMedium:   counts.MEDIUM,
    totalLow:      counts.LOW,
    totalOverdue,
    totalMine,
    generatedAt:   new Date().toISOString(),
  };
}

function makeEmptyResult(): ActionCenterResult {
  return {
    items: [], totalCritical: 0, totalHigh: 0, totalMedium: 0, totalLow: 0,
    totalOverdue: 0, totalMine: 0, generatedAt: new Date().toISOString(),
  };
}
