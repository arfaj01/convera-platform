/**
 * CONVERA Claim Workflow State Machine
 * 5-Stage Approval Pipeline with Sequential Enforcement
 *
 * Flow: contractor → supervisor (3-day SLA) → auditor → reviewer → director
 * Returns: Always go back to contractor (regardless of return stage)
 *
 * Rules:
 * - No stage skipping
 * - No parallel approvals
 * - All transitions validated by role
 * - Return requires mandatory reason
 * - Approved/rejected claims are immutable
 */

import type { ClaimStatus, ContractRole, UserRole, WorkflowTransition, WorkflowState } from './types';

// ─── Type Definitions ────────────────────────────────────────────

/**
 * Represents a valid state transition with constraints
 */
export interface TransitionDef {
  action: string;
  toStatus: ClaimStatus;
  allowedRoles: UserRole[];
  requiresNote: boolean;
  minNoteLength?: number;
  description: string;
}

/**
 * Result of attempting a transition
 */
export interface TransitionResult {
  success: boolean;
  message: string;
  newStatus?: ClaimStatus;
  error?: string;
}

/**
 * Claim state metadata for workflow tracking
 */
export interface ClaimWorkflowMetadata {
  supervisorReviewStartedAt: string | null;
  supervisorWarningNotifiedAt: string | null;
  supervisorEscalationNotifiedAt: string | null;
  lastReturnedAt: string | null;
  lastReturnedBy: string | null;
  lastReturnReason: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  rejectedAt: string | null;
  rejectedBy: string | null;
  rejectionReason: string | null;
}

// ─── State Machine Definition ────────────────────────────────────

/**
 * Complete state transition matrix
 * Defines all valid transitions per status and role
 */
export const CLAIM_TRANSITIONS: Record<ClaimStatus, TransitionDef[]> = {
  draft: [
    {
      action: 'submit',
      // CRITICAL: toStatus is under_supervisor_review (NOT 'submitted').
      // The atomic DB function submit_claim_atomic() handles draft→submitted→under_supervisor_review
      // as a single transaction. 'submitted' is a transient audit-trail-only state that must
      // NEVER persist in the claims table. Any code that sets claims.status='submitted' directly
      // is a bug. See: SQL/migrations/035_block_submitted_persist.sql
      toStatus: 'under_supervisor_review',
      allowedRoles: ['contractor'],
      requiresNote: false,
      description: 'مقاول يرسل المطالبة للمراجعة الأولية',
    },
  ],

  // 'submitted' is a TRANSIENT state — the submit API route auto-routes to
  // under_supervisor_review immediately. No human action is needed or allowed.
  // This state exists only for audit trail purposes.
  // DB trigger blocks any UPDATE that sets claims.status = 'submitted'.
  submitted: [],

  under_supervisor_review: [
    {
      action: 'approve',
      toStatus: 'under_auditor_review',
      allowedRoles: ['supervisor'],
      requiresNote: false,
      description: 'جهة الإشراف توافق على المطالبة',
    },
    {
      action: 'return',
      toStatus: 'returned_by_supervisor',
      allowedRoles: ['supervisor'],
      requiresNote: true,
      minNoteLength: 20,
      description: 'جهة الإشراف ترجع المطالبة للمقاول',
    },
    {
      action: 'withdraw',
      toStatus: 'draft',
      allowedRoles: ['contractor'],
      requiresNote: false,
      description: 'المقاول يسحب المطالبة قبل اتخاذ إجراء من جهة الإشراف',
    },
    {
      action: 'cancel',
      toStatus: 'cancelled',
      allowedRoles: ['contractor'],
      requiresNote: false,
      description: 'المقاول يلغي المطالبة نهائياً قبل اتخاذ إجراء من جهة الإشراف',
    },
  ],

  returned_by_supervisor: [
    {
      action: 'resubmit',
      toStatus: 'under_supervisor_review',
      allowedRoles: ['contractor'],
      requiresNote: false,
      description: 'مقاول يعيد تقديم المطالبة — توجيه مباشر لجهة الإشراف',
    },
  ],

  under_auditor_review: [
    {
      action: 'approve',
      toStatus: 'under_reviewer_check',
      allowedRoles: ['auditor'],
      requiresNote: false,
      description: 'مدقق يوافق على الجوانب التقنية',
    },
    {
      action: 'return',
      toStatus: 'returned_by_auditor',
      allowedRoles: ['auditor'],
      requiresNote: true,
      minNoteLength: 20,
      description: 'مدقق يرجع المطالبة للمقاول',
    },
  ],

  returned_by_auditor: [
    {
      action: 'resubmit',
      toStatus: 'under_supervisor_review',
      allowedRoles: ['contractor'],
      requiresNote: false,
      description: 'مقاول يعيد تقديم المطالبة — توجيه مباشر لجهة الإشراف',
    },
  ],

  under_reviewer_check: [
    {
      action: 'approve',
      toStatus: 'pending_director_approval',
      allowedRoles: ['reviewer'],
      requiresNote: false,
      description: 'مراجع يؤكد توافق منصة الاعتماد',
    },
    {
      action: 'return',
      toStatus: 'returned_by_auditor',
      allowedRoles: ['reviewer'],
      requiresNote: true,
      minNoteLength: 20,
      description: 'مراجع يرجع للمدقق للتصحيح',
    },
  ],

  // NOTE: 'director' retains full access. Additional final approvers are checked
  // dynamically at the API level via the contract_approvers table (migration 040).
  // The allowedRoles here serve as static client-side hints — the real check
  // for non-director final approvers is in /api/claims/transition.
  // NOTE: 'director' and 'final_approver' both have access here.
  // final_approver is contract-scoped — API enforces contract_approvers check.
  pending_director_approval: [
    {
      action: 'approve',
      toStatus: 'approved',
      allowedRoles: ['director', 'final_approver'],
      requiresNote: false,
      description: 'المعتمد النهائي يعتمد المطالبة نهائياً',
    },
    {
      action: 'reject',
      toStatus: 'rejected',
      allowedRoles: ['director', 'final_approver'],
      requiresNote: true,
      minNoteLength: 20,
      description: 'المعتمد النهائي يرفض المطالبة',
    },
    {
      action: 'return',
      toStatus: 'under_auditor_review',
      allowedRoles: ['director', 'final_approver'],
      requiresNote: true,
      minNoteLength: 20,
      description: 'المعتمد النهائي يرجع للمدقق للمراجعة الإضافية',
    },
  ],

  approved: [],
  rejected: [],
  cancelled: [],
};

// ─── Helper Functions ────────────────────────────────────────────

/**
 * Checks if user role can perform action on claim in current status
 */
export function canTransition(
  currentStatus: ClaimStatus,
  action: string,
  userRole: UserRole,
): boolean {
  const transitions = CLAIM_TRANSITIONS[currentStatus];
  if (!transitions) return false;

  const transition = transitions.find((t) => t.action === action);
  if (!transition) return false;

  return transition.allowedRoles.includes(userRole);
}

/**
 * Gets all available actions for current user role in current status
 */
export function getAvailableActions(
  currentStatus: ClaimStatus,
  userRole: UserRole,
): WorkflowTransition[] {
  const transitions = CLAIM_TRANSITIONS[currentStatus];
  if (!transitions) return [];

  return transitions
    .filter((t) => t.allowedRoles.includes(userRole))
    .map((t) => ({
      ...t,
      fromStatus: currentStatus,
    }));
}

/**
 * Validates transition prerequisites
 * Returns { valid: true } or { valid: false, error: string }
 */
export function validateTransition(
  currentStatus: ClaimStatus,
  action: string,
  userRole: UserRole,
  note?: string | null,
  isApproved?: boolean,
  requiresAttachments?: boolean,
): { valid: boolean; error?: string } {
  // Check if user can perform action
  if (!canTransition(currentStatus, action, userRole)) {
    return {
      valid: false,
      error: `الدور "${userRole}" غير مخول بتنفيذ "${action}" في الحالة "${currentStatus}"`,
    };
  }

  // Get transition definition
  const transitions = CLAIM_TRANSITIONS[currentStatus];
  const transition = transitions.find((t) => t.action === action);

  if (!transition) {
    return {
      valid: false,
      error: `الانتقال "${action}" غير صحيح من الحالة "${currentStatus}"`,
    };
  }

  // Check immutability: approved, rejected, and cancelled claims cannot be modified
  if ((isApproved === true || currentStatus === 'approved' || currentStatus === 'rejected' || currentStatus === 'cancelled') && action !== 'close') {
    return {
      valid: false,
      error: 'المطالبات المعتمدة أو المرفوضة لا يمكن تعديلها',
    };
  }

  // Check mandatory note
  if (transition.requiresNote) {
    if (!note || note.trim().length === 0) {
      return {
        valid: false,
        error: `يجب إدراج تعليق إلزامي للقيام بـ "${transition.description}"`,
      };
    }

    if (transition.minNoteLength && note.trim().length < transition.minNoteLength) {
      return {
        valid: false,
        error: `التعليق يجب أن يكون على الأقل ${transition.minNoteLength} حرف`,
      };
    }
  }

  // Check mandatory attachments for approval
  if ((action === 'approve' || action === 'forward') && requiresAttachments === true) {
    return {
      valid: false,
      error: 'يجب إرفاق المستندات المطلوبة (الفاتورة والتقرير التقني) قبل الموافقة',
    };
  }

  return { valid: true };
}

/**
 * Gets the next expected status after a successful transition
 */
export function getNextStatus(currentStatus: ClaimStatus, action: string): ClaimStatus | null {
  const transitions = CLAIM_TRANSITIONS[currentStatus];
  const transition = transitions?.find((t) => t.action === action);
  return transition?.toStatus || null;
}

/**
 * Calculates workflow state based on current status and user role
 */
export function calculateWorkflowState(
  currentStatus: ClaimStatus,
  userRole: UserRole,
): WorkflowState {
  const availableActions = getAvailableActions(currentStatus, userRole);

  return {
    currentStatus,
    availableActions,
    canReturn: availableActions.some((a) => a.action === 'return'),
    canResubmit: availableActions.some((a) => a.action === 'resubmit'),
    isApproved: currentStatus === 'approved',
    isRejected: currentStatus === 'rejected',
    isBlocked: availableActions.length === 0 && !['approved', 'rejected', 'cancelled'].includes(currentStatus),
  };
}

/**
 * Returns true if claim is in a terminal state (no more transitions possible)
 */
export function isTerminalStatus(status: ClaimStatus): boolean {
  return status === 'approved' || status === 'rejected' || status === 'cancelled';
}

/**
 * Returns true if claim can still be modified
 */
export function isMutableStatus(status: ClaimStatus): boolean {
  return !isTerminalStatus(status) && status !== 'submitted';
}

/**
 * Gets workflow stage name in Arabic
 */
export function getStageLabel(status: ClaimStatus): string {
  const labels: Record<ClaimStatus, string> = {
    draft: 'مسودة',
    submitted: 'مُرسَلة',
    under_supervisor_review: 'مراجعة جهة الإشراف',
    returned_by_supervisor: 'مُرجَّعة من جهة الإشراف',
    under_auditor_review: 'مراجعة المدقق',
    returned_by_auditor: 'مُرجَّعة من المدقق',
    under_reviewer_check: 'فحص المراجع',
    pending_director_approval: 'بانتظار اعتماد المدير',
    approved: 'معتمدة',
    rejected: 'مرفوضة',
    cancelled: 'ملغاة',
  };
  return labels[status];
}

/**
 * Gets actor role name for current status (who should act next)
 */
export function getExpectedActorRole(status: ClaimStatus): UserRole | null {
  const actorMap: Record<ClaimStatus, UserRole | null> = {
    draft: 'contractor',
    submitted: 'supervisor',
    under_supervisor_review: 'supervisor',
    returned_by_supervisor: 'contractor',
    under_auditor_review: 'auditor',
    returned_by_auditor: 'contractor',
    under_reviewer_check: 'reviewer',
    pending_director_approval: 'final_approver',
    approved: null,
    rejected: null,
    cancelled: null,
  };
  return actorMap[status];
}

/**
 * Calculates SLA status for supervisor review stage
 * SLA: 3 working days, warning at day 2
 */
export function calculateSLAStatus(supervisorReviewStartedAt: string | null): {
  daysElapsed: number;
  hoursUntilWarning: number;
  hoursUntilBreach: number;
  isWarningTriggered: boolean;
  isBreached: boolean;
} {
  if (!supervisorReviewStartedAt) {
    return {
      daysElapsed: 0,
      hoursUntilWarning: 48,
      hoursUntilBreach: 72,
      isWarningTriggered: false,
      isBreached: false,
    };
  }

  const startDate = new Date(supervisorReviewStartedAt);
  const now = new Date();
  const elapsedMs = now.getTime() - startDate.getTime();
  const elapsedHours = elapsedMs / (1000 * 60 * 60);
  const elapsedDays = elapsedHours / 24;

  const hoursUntilWarning = Math.max(0, 48 - elapsedHours);
  const hoursUntilBreach = Math.max(0, 72 - elapsedHours);

  return {
    daysElapsed: Math.floor(elapsedDays),
    hoursUntilWarning,
    hoursUntilBreach,
    isWarningTriggered: elapsedHours >= 48,
    isBreached: elapsedHours >= 72,
  };
}

/**
 * Determines if a return reason is sufficient
 */
export function isValidReturnReason(reason: string | null | undefined): boolean {
  if (!reason) return false;
  const trimmed = reason.trim();
  return trimmed.length >= 20;
}

/**
 * Build a user-friendly error message for transition failures
 */
export function getTransitionErrorMessage(
  currentStatus: ClaimStatus,
  action: string,
  userRole: UserRole,
): string {
  const actorRole = getExpectedActorRole(currentStatus);

  if (!canTransition(currentStatus, action, userRole)) {
    return `الدور "${userRole}" غير مخول بـ "${action}". المتوقع: "${actorRole || 'لا أحد'}"`;
  }

  const transitions = CLAIM_TRANSITIONS[currentStatus];
  const transition = transitions?.find((t) => t.action === action);

  if (!transition) {
    return `لا يمكن تنفيذ "${action}" من الحالة الحالية "${getStageLabel(currentStatus)}"`;
  }

  return `خطأ غير متوقع في الانتقال`;
}

/**
 * Returns a workflow chain (path to final approval)
 */
export function getWorkflowChain(currentStatus: ClaimStatus): ClaimStatus[] {
  const chain: ClaimStatus[] = [
    'draft',
    'submitted',
    'under_supervisor_review',
    'under_auditor_review',
    'under_reviewer_check',
    'pending_director_approval',
    'approved',
  ];

  const currentIndex = chain.indexOf(currentStatus);
  return currentIndex >= 0 ? chain.slice(currentIndex) : chain;
}

/**
 * Calculates progress percentage through workflow
 */
export function calculateWorkflowProgress(currentStatus: ClaimStatus): number {
  const stageOrder: Record<ClaimStatus, number> = {
    draft: 0,
    submitted: 14,
    under_supervisor_review: 28,
    returned_by_supervisor: 28,
    under_auditor_review: 42,
    returned_by_auditor: 42,
    under_reviewer_check: 70,
    pending_director_approval: 85,
    approved: 100,
    rejected: 100,
    cancelled: 100,
  };
  return stageOrder[currentStatus] || 0;
}

/**
 * Returns a color code for workflow status visualization
 */
export function getStatusColor(status: ClaimStatus): string {
  const colorMap: Record<ClaimStatus, string> = {
    draft: '#9CA3AF',
    submitted: '#F59E0B',
    under_supervisor_review: '#06B6D4',
    returned_by_supervisor: '#F97316',
    under_auditor_review: '#8B5CF6',
    returned_by_auditor: '#F97316',
    under_reviewer_check: '#EC4899',
    pending_director_approval: '#FFD700',
    approved: '#87BA26',
    rejected: '#EF4444',
    cancelled: '#9CA3AF',
  };
  return colorMap[status];
}

/**
 * Type-safe action executor (use in backend/API)
 */
export async function executeTransition(
  claimId: string,
  action: string,
  actorId: string,
  currentStatus: ClaimStatus,
  userRole: UserRole,
  note?: string,
): Promise<TransitionResult> {
  // Validate transition
  const validation = validateTransition(currentStatus, action, userRole, note);
  if (!validation.valid) {
    return {
      success: false,
      message: validation.error || 'فشل التحقق من الانتقال',
      error: validation.error,
    };
  }

  // Get next status
  const nextStatus = getNextStatus(currentStatus, action);
  if (!nextStatus) {
    return {
      success: false,
      message: 'فشل تحديد الحالة التالية',
      error: 'next_status_not_found',
    };
  }

  // In real implementation, this would call Supabase API
  // to persist the transition and create audit log
  return {
    success: true,
    message: `تم ${action === 'approve' ? 'الموافقة' : action === 'reject' ? 'الرفض' : action === 'return' ? 'الإرجاع' : 'التحديث'} بنجاح`,
    newStatus: nextStatus,
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  Sprint B: Contract-Role-Aware Helpers
//
//  These functions accept ContractRole instead of UserRole.
//  They map the contract-scoped role to the workflow's allowedRoles
//  to determine if the user can act.
//
//  Mapping: ContractRole → UserRole (for CLAIM_TRANSITIONS lookup)
//    contractor → contractor
//    supervisor → supervisor
//    auditor    → auditor
//    reviewer   → reviewer
//    viewer     → (no workflow actions allowed)
//
//  These are ADDITIVE — they don't replace the existing functions above.
//  Existing code continues to use canTransition(status, action, userRole).
//  New code (Sprint B API routes) uses canTransitionByContractRole().
// ═══════════════════════════════════════════════════════════════════════

/**
 * Maps ContractRole to the UserRole value used in CLAIM_TRANSITIONS.allowedRoles.
 * Returns null for viewer (no workflow actions).
 */
export function contractRoleToWorkflowRole(contractRole: ContractRole): UserRole | null {
  const map: Record<ContractRole, UserRole | null> = {
    contractor: 'contractor',
    supervisor: 'supervisor',
    auditor:    'auditor',
    reviewer:   'reviewer',
    final_approver: 'final_approver', // maps to final_approver workflow actions (now a first-class role)
    viewer:     null,
  };
  return map[contractRole] ?? null;
}

/**
 * Checks if a contract-scoped role can perform an action on a claim.
 *
 * - Maps ContractRole → UserRole for lookup in CLAIM_TRANSITIONS
 * - Returns false for viewer role (no workflow actions)
 * - Director is handled separately (global role, not contract-scoped)
 */
export function canTransitionByContractRole(
  currentStatus: ClaimStatus,
  action: string,
  contractRole: ContractRole,
): boolean {
  const workflowRole = contractRoleToWorkflowRole(contractRole);
  if (!workflowRole) return false; // viewer cannot act

  return canTransition(currentStatus, action, workflowRole);
}

/**
 * Gets available actions for a contract-scoped role.
 */
export function getAvailableActionsByContractRole(
  currentStatus: ClaimStatus,
  contractRole: ContractRole,
): WorkflowTransition[] {
  const workflowRole = contractRoleToWorkflowRole(contractRole);
  if (!workflowRole) return []; // viewer gets no actions

  return getAvailableActions(currentStatus, workflowRole);
}

/**
 * Validates a transition using contract-scoped role.
 */
export function validateTransitionByContractRole(
  currentStatus: ClaimStatus,
  action: string,
  contractRole: ContractRole,
  note?: string | null,
  isApproved?: boolean,
  requiresAttachments?: boolean,
): { valid: boolean; error?: string } {
  const workflowRole = contractRoleToWorkflowRole(contractRole);
  if (!workflowRole) {
    return {
      valid: false,
      error: `الدور "${contractRole}" لا يملك صلاحيات تنفيذ إجراءات سير العمل`,
    };
  }

  return validateTransition(currentStatus, action, workflowRole, note, isApproved, requiresAttachments);
}
