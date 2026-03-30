/**
 * CONVERA — Unified Action Engine (محرك الإجراءات الموحد)
 *
 * THE SINGLE SOURCE OF TRUTH for all user actions across the platform.
 *
 * Every action shown anywhere — claim detail, workflow page, action center,
 * notifications, dashboard attention panels — MUST originate from this engine.
 *
 * Core principle:
 *   If the system says "You need to do something", then:
 *   1. The action must be real
 *   2. The user must have permission
 *   3. The action must be executable
 *   4. The UI must expose the button / entry point
 *   5. The backend must support it
 *
 * Architecture:
 *   - Built on top of CLAIM_TRANSITIONS (workflow-engine.ts) for workflow actions
 *   - Extends with business actions (upload, resubmit, fix_validation)
 *   - Evaluates document requirements, SLA state, and contract permissions
 *   - Returns structured ClaimAction objects consumed by ALL UI surfaces
 *
 * Rules:
 *   - Does NOT modify RLS, auth, or workflow routing
 *   - Does NOT replace CLAIM_TRANSITIONS — consumes it
 *   - All actions validated by: contract role + workflow stage + claim state + prerequisites
 */

import {
  CLAIM_TRANSITIONS,
  type TransitionDef,
  isTerminalStatus,
  getStageLabel,
  getExpectedActorRole,
} from './workflow-engine';
import type { ClaimStatus, UserRole, ContractRole } from './types';

// ─── Action Types ────────────────────────────────────────────────

export type ActionType =
  | 'approve'
  | 'return'
  | 'reject'
  | 'submit'
  | 'resubmit'
  | 'withdraw'
  | 'cancel'
  | 'upload_documents'
  | 'upload_certificate'
  | 'download_certificate'
  | 'fix_validation'
  | 'view_only'
  | 'director_override';

export type ActionVariant = 'primary' | 'secondary' | 'danger' | 'warning';

export type ActionTarget = 'claim_detail' | 'modal' | 'workflow' | 'upload_section';

export type ActionInputType = 'reason' | 'file_upload' | 'comment' | null;

// ─── ClaimAction — the universal action object ───────────────────

export interface ClaimAction {
  /** Canonical action type */
  type: ActionType;
  /** Workflow action name for API calls (matches CLAIM_TRANSITIONS) */
  workflowAction: string | null;
  /** Arabic label for the button */
  label_ar: string;
  /** Optional description for tooltips / action cards */
  description_ar: string;
  /** Button visual variant */
  variant: ActionVariant;
  /** Does this action require user input? */
  requires_input: boolean;
  /** What type of input? */
  input_type: ActionInputType;
  /** Minimum input length (for reasons) */
  min_input_length: number;
  /** Should the action button be shown? */
  visible: boolean;
  /** Can the user click it right now? */
  enabled: boolean;
  /** Arabic explanation if disabled */
  reason_if_disabled: string | null;
  /** Where does this action lead? */
  target: ActionTarget;
  /** Target status after transition (for workflow actions) */
  toStatus: ClaimStatus | null;
  /** Sorting priority (lower = show first) */
  sortOrder: number;
}

// ─── Action Context — everything needed to resolve actions ───────

export interface ActionContext {
  /** Current user's profile ID */
  userId: string;
  /** User's global role (from profiles.role) */
  globalRole: UserRole;
  /** User's contract-scoped role on this claim's contract (null = global access) */
  contractRole: ContractRole | null;
  /** Is this a global-role user (e.g. director) with unrestricted access? */
  isGlobalRole: boolean;
  /** Current claim status */
  claimStatus: ClaimStatus;
  /** ID of the user who submitted the claim */
  submittedBy: string | null;
  /** Does the claim have an invoice attached? */
  hasInvoice: boolean;
  /** Does the claim have a technical report attached? */
  hasTechnicalReport: boolean;
  /** Total number of document attachments */
  documentCount: number;
  /** Is there a return reason from the last return? */
  returnReason: string | null;
  /** SLA days elapsed in current stage */
  slaDaysElapsed: number;
  /** Is SLA breached? */
  slaBreached: boolean;
  /** Does the claim have a completion certificate uploaded? */
  hasCompletionCertificate: boolean;
  /** Is the current user the expected actor for this stage? */
  isExpectedActor: boolean;
}

// ─── Status → Stage-Specific Approve Labels ─────────────────────

const APPROVE_LABELS: Partial<Record<ClaimStatus, string>> = {
  under_supervisor_review:    'إحالة للتدقيق',
  under_auditor_review:       'إحالة للمراجع',
  under_reviewer_check:       'رفع للمدير',
  pending_director_approval:  'اعتماد نهائي',
};

// ─── Workflow Role Resolution ────────────────────────────────────

/**
 * Legacy profiles.role → workflow role mapping.
 * profiles.role uses legacy names (consultant, admin) that don't match
 * CLAIM_TRANSITIONS.allowedRoles (supervisor, auditor).
 */
const LEGACY_WORKFLOW_MAP: Partial<Record<UserRole, UserRole>> = {
  consultant: 'supervisor',
  admin:      'auditor',
};

/**
 * Resolves the effective UserRole used for CLAIM_TRANSITIONS lookup.
 *
 * Priority:
 *   1. Global role (director) → 'director'
 *   2. Contract role → mapped UserRole
 *   3. Legacy fallback: map profiles.role to workflow role
 *      (consultant → supervisor, admin → auditor)
 */
function resolveWorkflowRole(ctx: ActionContext): UserRole {
  if (ctx.isGlobalRole) return ctx.globalRole;
  if (ctx.contractRole) {
    const map: Record<ContractRole, UserRole> = {
      contractor: 'contractor',
      supervisor: 'supervisor',
      auditor:    'auditor',
      reviewer:   'reviewer',
      viewer:     ctx.globalRole, // viewer has no workflow actions
    };
    return map[ctx.contractRole];
  }
  // Legacy fallback: profiles.role uses old names
  return LEGACY_WORKFLOW_MAP[ctx.globalRole] || ctx.globalRole;
}

// ─── Document Validation ─────────────────────────────────────────

/** Statuses where document upload is possible and relevant */
const UPLOAD_ELIGIBLE_STATUSES: ClaimStatus[] = [
  'draft',
  'under_supervisor_review', // contractor can edit attachments before supervisor acts
  'returned_by_supervisor',
  'returned_by_auditor',
];

/** Statuses where the contractor can resubmit */
const RESUBMIT_STATUSES: ClaimStatus[] = [
  'returned_by_supervisor',
  'returned_by_auditor',
];

/** Statuses requiring documents before approval can proceed */
const NEEDS_DOCS_FOR_APPROVAL: ClaimStatus[] = [
  'submitted',
  'under_supervisor_review',
  'under_auditor_review',
  'under_reviewer_check',
  'pending_director_approval',
];

// ─── Core Engine ─────────────────────────────────────────────────

/**
 * THE unified action resolver.
 *
 * Returns ALL actions available for a claim given the full context.
 * Every UI surface consumes this same output.
 */
export function getAvailableActionsForClaim(ctx: ActionContext): ClaimAction[] {
  const actions: ClaimAction[] = [];
  const workflowRole = resolveWorkflowRole(ctx);

  // Terminal states: view-only, no actions
  if (isTerminalStatus(ctx.claimStatus)) {
    actions.push({
      type: 'view_only',
      workflowAction: null,
      label_ar: 'عرض التفاصيل',
      description_ar: ctx.claimStatus === 'approved'
        ? 'هذه المطالبة معتمدة — يمكن عرض التفاصيل فقط'
        : 'هذه المطالبة مرفوضة — يمكن عرض التفاصيل فقط',
      variant: 'secondary',
      requires_input: false,
      input_type: null,
      min_input_length: 0,
      visible: true,
      enabled: true,
      reason_if_disabled: null,
      target: 'claim_detail',
      toStatus: null,
      sortOrder: 99,
    });
    return actions;
  }

  // ── A) Workflow Actions (from CLAIM_TRANSITIONS state machine) ──

  const transitions = CLAIM_TRANSITIONS[ctx.claimStatus] || [];
  for (const t of transitions) {
    if (!t.allowedRoles.includes(workflowRole)) continue;

    // Permission gate: verify user actually has the right to act
    const isDirectorAction = t.allowedRoles.includes('director');
    let hasPermission = false;

    if (isDirectorAction) {
      // Director-stage actions: only actual directors
      hasPermission = ctx.isGlobalRole && ctx.globalRole === 'director';
    } else if (ctx.contractRole && ctx.contractRole !== 'viewer') {
      // Explicit contract role from user_contract_roles table
      hasPermission = true;
    } else if (!ctx.contractRole && !ctx.isGlobalRole) {
      // Legacy fallback: no user_contract_roles entry, but globalRole
      // maps to a valid workflow role via LEGACY_WORKFLOW_MAP.
      // resolveWorkflowRole already applied the mapping and it passed
      // the allowedRoles check above, so allow it.
      hasPermission = true;
    }

    if (!hasPermission) continue;

    const action = buildWorkflowAction(t, ctx);
    if (action) actions.push(action);
  }

  // ── B) Business Actions — Contractor: Upload Documents ──

  if (isContractorOnClaim(ctx) && UPLOAD_ELIGIBLE_STATUSES.includes(ctx.claimStatus)) {
    const missingInvoice = !ctx.hasInvoice;
    const missingReport = !ctx.hasTechnicalReport;
    const hasMissing = missingInvoice || missingReport;

    actions.push({
      type: 'upload_documents',
      workflowAction: null,
      label_ar: 'رفع المستندات',
      description_ar: hasMissing
        ? buildMissingDocsDescription(missingInvoice, missingReport)
        : 'يمكنك إضافة مستندات داعمة إضافية',
      variant: hasMissing ? 'warning' : 'secondary',
      requires_input: true,
      input_type: 'file_upload',
      min_input_length: 0,
      visible: true,
      enabled: true,
      reason_if_disabled: null,
      target: 'upload_section',
      toStatus: null,
      sortOrder: hasMissing ? 5 : 50,
    });
  }

  // ── C) Business Actions — Contractor: Fix Validation ──

  if (isContractorOnClaim(ctx) && RESUBMIT_STATUSES.includes(ctx.claimStatus)) {
    const missingDocs = !ctx.hasInvoice || !ctx.hasTechnicalReport;
    if (missingDocs) {
      actions.push({
        type: 'fix_validation',
        workflowAction: null,
        label_ar: 'تصحيح المتطلبات',
        description_ar: 'يجب إرفاق المستندات المطلوبة قبل إعادة التقديم',
        variant: 'warning',
        requires_input: false,
        input_type: null,
        min_input_length: 0,
        visible: true,
        enabled: true,
        reason_if_disabled: null,
        target: 'upload_section',
        toStatus: null,
        sortOrder: 3,
      });
    }
  }

  // ── D) Director Override (always available on non-terminal claims) ──

  if (ctx.isGlobalRole && ctx.globalRole === 'director' && !isTerminalStatus(ctx.claimStatus)) {
    // Skip override on: director's own stage, and transient 'submitted' (auto-routed by system)
    if (ctx.claimStatus !== 'pending_director_approval' && ctx.claimStatus !== 'submitted') {
      actions.push({
        type: 'director_override',
        workflowAction: 'director_override',
        label_ar: 'تعديل الإحالة',
        description_ar: 'نقل المطالبة إلى مرحلة مختلفة (صلاحية المدير فقط)',
        variant: 'secondary',
        requires_input: true,
        input_type: 'reason',
        min_input_length: 10,
        visible: true,
        enabled: true,
        reason_if_disabled: null,
        target: 'modal',
        toStatus: null,
        sortOrder: 90,
      });
    }
  }

  // ── E) Business Actions — Supervisor: Upload Completion Certificate ──

  if (isSupervisorOnClaim(ctx) && ctx.claimStatus === 'under_supervisor_review') {
    if (!ctx.hasCompletionCertificate) {
      actions.push({
        type: 'upload_certificate',
        workflowAction: null,
        label_ar: 'رفع شهادة الإنجاز',
        description_ar: 'يجب رفع شهادة الإنجاز قبل الموافقة على المطالبة',
        variant: 'warning',
        requires_input: true,
        input_type: 'file_upload',
        min_input_length: 0,
        visible: true,
        enabled: true,
        reason_if_disabled: null,
        target: 'upload_section',
        toStatus: null,
        sortOrder: 4, // Before approve button
      });
    } else {
      actions.push({
        type: 'upload_certificate',
        workflowAction: null,
        label_ar: 'شهادة الإنجاز مرفقة',
        description_ar: 'تم رفع شهادة الإنجاز — يمكنك الآن الموافقة على المطالبة',
        variant: 'secondary',
        requires_input: false,
        input_type: null,
        min_input_length: 0,
        visible: true,
        enabled: false,
        reason_if_disabled: 'تم رفع شهادة الإنجاز بالفعل',
        target: 'upload_section',
        toStatus: null,
        sortOrder: 55,
      });
    }
  }

  // ── F) Business Actions — Contractor: Download Certificate After Approval ──

  if (isContractorOnClaim(ctx) && ctx.claimStatus === 'approved' && ctx.hasCompletionCertificate) {
    actions.push({
      type: 'download_certificate',
      workflowAction: null,
      label_ar: 'تحميل شهادة الإنجاز',
      description_ar: 'تحميل شهادة الإنجاز المرفقة بالمطالبة المعتمدة',
      variant: 'primary',
      requires_input: false,
      input_type: null,
      min_input_length: 0,
      visible: true,
      enabled: true,
      reason_if_disabled: null,
      target: 'claim_detail',
      toStatus: null,
      sortOrder: 10,
    });
  }

  // Sort by priority
  actions.sort((a, b) => a.sortOrder - b.sortOrder);

  return actions;
}

// ─── Build a single workflow action ──────────────────────────────

function buildWorkflowAction(t: TransitionDef, ctx: ActionContext): ClaimAction | null {
  const actionType = resolveActionType(t.action);

  // Determine enable/disable state based on prerequisites
  let enabled = true;
  let reasonIfDisabled: string | null = null;

  // Approval actions: check document requirements
  if (t.action === 'approve' && NEEDS_DOCS_FOR_APPROVAL.includes(ctx.claimStatus)) {
    if (ctx.documentCount === 0) {
      enabled = false;
      reasonIfDisabled = 'لا يمكن الموافقة بدون إرفاق المستندات المطلوبة (الفاتورة والتقرير الفني)';
    } else if (!ctx.hasInvoice) {
      enabled = false;
      reasonIfDisabled = 'يجب إرفاق الفاتورة المعتمدة قبل الموافقة';
    }
  }

  // Certificate gate: supervisor MUST upload completion certificate before approving
  if (t.action === 'approve' && ctx.claimStatus === 'under_supervisor_review') {
    if (!ctx.hasCompletionCertificate) {
      enabled = false;
      reasonIfDisabled = 'يجب رفع شهادة الإنجاز قبل الموافقة على المطالبة';
    }
  }

  // Resubmit: check if required docs are still missing
  if (t.action === 'resubmit') {
    if (!ctx.hasInvoice && !ctx.hasTechnicalReport && ctx.documentCount === 0) {
      enabled = false;
      reasonIfDisabled = 'لا يمكن إعادة التقديم قبل رفع الفاتورة والتقرير الفني';
    }
  }

  // Resolve Arabic label
  const label_ar = resolveLabel(t, ctx.claimStatus);

  return {
    type: actionType,
    workflowAction: t.action,
    label_ar,
    description_ar: t.description,
    variant: resolveVariant(t.action),
    requires_input: t.requiresNote,
    input_type: t.requiresNote ? 'reason' : null,
    min_input_length: t.minNoteLength || 0,
    visible: true,
    enabled,
    reason_if_disabled: reasonIfDisabled,
    target: t.requiresNote ? 'modal' : 'claim_detail',
    toStatus: t.toStatus,
    sortOrder: actionSortOrder(t.action),
  };
}

// ─── Internal Helpers ────────────────────────────────────────────

function isContractorOnClaim(ctx: ActionContext): boolean {
  if (ctx.contractRole === 'contractor') return true;
  // Legacy: check global role
  if (ctx.globalRole === 'contractor') return true;
  return false;
}

function isSupervisorOnClaim(ctx: ActionContext): boolean {
  if (ctx.contractRole === 'supervisor') return true;
  // Legacy: consultant maps to supervisor
  if (ctx.globalRole === 'consultant' || ctx.globalRole === 'supervisor') return true;
  return false;
}

function resolveActionType(action: string): ActionType {
  const map: Record<string, ActionType> = {
    approve:              'approve',
    return:               'return',
    reject:               'reject',
    submit:               'submit',
    resubmit:             'resubmit',
    withdraw:             'withdraw',
    cancel:               'cancel',
    director_override:    'director_override',
  };
  return map[action] || 'view_only';
}

function resolveVariant(action: string): ActionVariant {
  if (action === 'reject' || action === 'cancel') return 'danger';
  if (action === 'return' || action === 'withdraw') return 'warning';
  if (action === 'approve' || action === 'submit' || action === 'resubmit') return 'primary';
  return 'secondary';
}

function resolveLabel(t: TransitionDef, status: ClaimStatus): string {
  if (t.action === 'approve') {
    return APPROVE_LABELS[status] || 'موافقة';
  }
  const labels: Record<string, string> = {
    submit:    'تقديم المستخلص',
    resubmit:  'إعادة التقديم',
    withdraw:  'سحب المطالبة',
    cancel:    'إلغاء المطالبة',
    return:    'إرجاع',
    reject:    'رفض',
    director_override: 'تعديل الإحالة',
  };
  return labels[t.action] || t.action;
}

function actionSortOrder(action: string): number {
  const order: Record<string, number> = {
    approve:   10,
    submit:    10,
    resubmit:  10,
    return:    20,
    reject:    30,
    withdraw:  40,
    cancel:    45,
    director_override: 90,
  };
  return order[action] ?? 50;
}

function buildMissingDocsDescription(missingInvoice: boolean, missingReport: boolean): string {
  const parts: string[] = [];
  if (missingInvoice) parts.push('الفاتورة المعتمدة');
  if (missingReport) parts.push('التقرير الفني');
  return `يجب إرفاق: ${parts.join(' و ')}`;
}

// ─── Variant Mapping for UI Components ───────────────────────────

/**
 * Maps ActionVariant to the Button component's variant prop.
 * Used by WorkflowActions and other components.
 */
export function actionVariantToButtonVariant(v: ActionVariant): 'teal' | 'red' | 'outline' {
  if (v === 'primary') return 'teal';
  if (v === 'danger') return 'red';
  return 'outline'; // secondary, warning
}

// ─── Convenience: Quick Context Builder ──────────────────────────

/**
 * Builds an ActionContext from raw claim and user data.
 * Used by pages that have all data locally.
 */
export function buildActionContext(params: {
  userId: string;
  globalRole: UserRole;
  contractRole: ContractRole | null;
  isGlobalRole: boolean;
  claim: {
    status: ClaimStatus;
    submitted_by?: string | null;
    return_reason?: string | null;
    has_completion_certificate?: boolean;
  };
  documents: { type: string }[];
  slaDaysElapsed?: number;
  slaBreached?: boolean;
}): ActionContext {
  const hasInvoice = params.documents.some(d => d.type === 'invoice');
  const hasTechnicalReport = params.documents.some(d => d.type === 'report');
  const hasCompletionCertificate = params.claim.has_completion_certificate === true
    || params.documents.some(d => d.type === 'completion_certificate');
  const expectedRole = getExpectedActorRole(params.claim.status as ClaimStatus);

  // Determine if user is the expected actor
  let isExpectedActor = false;
  if (expectedRole) {
    if (expectedRole === 'director' && params.isGlobalRole && params.globalRole === 'director') {
      isExpectedActor = true;
    } else if (params.contractRole) {
      const roleMap: Record<ContractRole, UserRole> = {
        contractor: 'contractor',
        supervisor: 'supervisor',
        auditor:    'auditor',
        reviewer:   'reviewer',
        viewer:     params.globalRole,
      };
      isExpectedActor = roleMap[params.contractRole] === expectedRole;
    } else if (params.globalRole === expectedRole) {
      isExpectedActor = true;
    }
  }

  return {
    userId: params.userId,
    globalRole: params.globalRole,
    contractRole: params.contractRole,
    isGlobalRole: params.isGlobalRole,
    claimStatus: params.claim.status as ClaimStatus,
    submittedBy: params.claim.submitted_by || null,
    hasInvoice,
    hasTechnicalReport,
    hasCompletionCertificate,
    documentCount: params.documents.length,
    returnReason: params.claim.return_reason || null,
    slaDaysElapsed: params.slaDaysElapsed || 0,
    slaBreached: params.slaBreached || false,
    isExpectedActor,
  };
}

// ─── Filtering Helpers ───────────────────────────────────────────

/** Returns only workflow actions (approve/return/reject/submit/resubmit/withdraw/cancel) */
export function getWorkflowActions(actions: ClaimAction[]): ClaimAction[] {
  const wfTypes: ActionType[] = ['approve', 'return', 'reject', 'submit', 'resubmit', 'withdraw', 'cancel'];
  return actions.filter(a => wfTypes.includes(a.type));
}

/** Returns only business actions (upload, fix_validation, certificate) */
export function getBusinessActions(actions: ClaimAction[]): ClaimAction[] {
  const bizTypes: ActionType[] = ['upload_documents', 'upload_certificate', 'download_certificate', 'fix_validation'];
  return actions.filter(a => bizTypes.includes(a.type));
}

/** Returns true if user has at least one executable (enabled) action */
export function hasExecutableAction(actions: ClaimAction[]): boolean {
  return actions.some(a => a.visible && a.enabled && a.type !== 'view_only');
}

/** Returns true if user has any action (even disabled) */
export function hasAnyAction(actions: ClaimAction[]): boolean {
  return actions.some(a => a.visible && a.type !== 'view_only');
}

/** Returns the primary (highest priority) action */
export function getPrimaryAction(actions: ClaimAction[]): ClaimAction | null {
  const executable = actions.filter(a => a.visible && a.enabled && a.type !== 'view_only');
  return executable.length > 0 ? executable[0] : null;
}

// ─── Action Center Integration ───────────────────────────────────

/**
 * Converts ClaimActions into Action Center items.
 * Only returns actions that are visible and relevant to the current user.
 */
export function getActionCenterLabel(action: ClaimAction): string {
  if (!action.enabled && action.reason_if_disabled) {
    return action.reason_if_disabled;
  }
  return action.description_ar || action.label_ar;
}

/**
 * Determines what quick-action label to show in action center
 * based on the user's executable actions.
 */
export function getQuickActionForClaim(actions: ClaimAction[]): {
  label: string;
  type: ActionType;
} | null {
  const primary = getPrimaryAction(actions);
  if (!primary) return null;
  return { label: primary.label_ar, type: primary.type };
}
