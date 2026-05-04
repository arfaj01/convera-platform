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

import type {
  ClaimStatus,
  ContractRole,
  UserRole,
  WorkflowRole,
  WorkflowTransition,
  WorkflowState,
} from './types';

// Re-export WorkflowRole for callers that already import it from
// './workflow-engine' to keep the public surface stable.
export type { WorkflowRole };

// ─── Type Definitions ────────────────────────────────────────────

/**
 * Represents a valid state transition with constraints.
 *
 * Phase 2.6 (commit #4) additions:
 *   • `allowedRoles` is now `WorkflowRole[]` (was `UserRole[]`) — the
 *     two new gating stages (Quality Unit, Project Manager) reference
 *     ContractRole identifiers that don't exist in the UserRole enum.
 *     Callers that pass a `UserRole` value still work because
 *     `UserRole ⊂ WorkflowRole`.
 *   • `returnTargets` — when set, the transition is a flexible-return
 *     action: the reviewer may pick any of the listed target stages at
 *     runtime. The default `toStatus` is the contractor-bound
 *     `returned_by_*` value, so legacy callers that don't know about
 *     flexible returns continue to send the claim back to the
 *     contractor exactly as before. The picked target MUST be in the
 *     `returnTargets` list — the API route enforces this allow-list
 *     (Phase 2.6 commit #7).
 */
export interface TransitionDef {
  action: string;
  toStatus: ClaimStatus;
  allowedRoles: WorkflowRole[];
  requiresNote: boolean;
  minNoteLength?: number;
  description: string;
  returnTargets?: Array<{ toStatus: ClaimStatus; labelAr: string }>;
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
 * Complete state transition matrix.
 *
 * Phase 2.6 pipeline (commit #4 — populated 2026-04-29):
 *
 *   Forward path:
 *     draft → under_supervisor_review (Engineering Consultant)
 *           → under_technical_review (Technical Unit بالوزارة)
 *           → under_quality_review (Quality Unit بالوزارة, 1-day SLA)
 *           → under_project_manager_review (Project Manager)
 *           → pending_director_approval (Final Approval)
 *           → approved | rejected
 *
 *   Side transitions (consultant stage only): contractor can withdraw
 *   (→ draft) or cancel (→ cancelled).
 *
 *   Resubmit: every returned_by_* status routes back to
 *   under_supervisor_review when the contractor re-submits, so
 *   downstream review is re-performed on every revision.
 *
 *   Flexible return (§3d): every gating stage exposes a single `return`
 *   action whose `returnTargets` lists the stages the reviewer may pick
 *   from. The default `toStatus` is the contractor-bound returned_by_*
 *   value; the reviewer may instead route the claim back to any
 *   *earlier* gating stage via its under_*_review status. Server-side
 *   allow-list validation lives in /api/claims/transition (Phase 2.6
 *   commit #7).
 *
 *   Legacy paths: under_auditor_review and under_reviewer_check remain
 *   in CLAIM_TRANSITIONS so claims that entered the pipeline before
 *   Migration 046 can still be acted on. New claims do not enter these
 *   statuses (the supervisor's `approve` action now routes to
 *   under_technical_review instead of under_auditor_review).
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

  // ── Stage 1: Engineering Consultant (المكتب الهندسي) ──────────────
  under_supervisor_review: [
    {
      action: 'approve',
      // Phase 2.6: routes to the Technical Unit gate (NEW pipeline)
      // instead of the legacy under_auditor_review.
      toStatus: 'under_technical_review',
      allowedRoles: ['supervisor'],
      requiresNote: false,
      description: 'المكتب الهندسي يوافق ويحيل للوحدة الفنية بالوزارة',
    },
    {
      action: 'return',
      toStatus: 'returned_by_supervisor',
      allowedRoles: ['supervisor'],
      requiresNote: true,
      minNoteLength: 20,
      description: 'المكتب الهندسي يرجع المطالبة للمقاول',
      returnTargets: [
        { toStatus: 'returned_by_supervisor', labelAr: 'المقاول' },
      ],
    },
    {
      action: 'withdraw',
      toStatus: 'draft',
      allowedRoles: ['contractor'],
      requiresNote: false,
      description: 'المقاول يسحب المطالبة قبل اتخاذ إجراء من المكتب الهندسي',
    },
    {
      action: 'cancel',
      toStatus: 'cancelled',
      allowedRoles: ['contractor'],
      requiresNote: false,
      description: 'المقاول يلغي المطالبة نهائياً قبل اتخاذ إجراء من المكتب الهندسي',
    },
  ],

  returned_by_supervisor: [
    {
      action: 'resubmit',
      toStatus: 'under_supervisor_review',
      allowedRoles: ['contractor'],
      requiresNote: false,
      description: 'مقاول يعيد تقديم المطالبة — توجيه مباشر للمكتب الهندسي',
    },
  ],

  // ── Stage 2: Technical Unit (الوحدة الفنية بالوزارة) ──────────────
  under_technical_review: [
    {
      action: 'approve',
      toStatus: 'under_quality_review',
      allowedRoles: ['reviewer'],
      requiresNote: false,
      description: 'الوحدة الفنية بالوزارة توافق وتحيل لوحدة الجودة',
    },
    {
      action: 'return',
      toStatus: 'returned_by_technical',
      allowedRoles: ['reviewer'],
      requiresNote: true,
      minNoteLength: 20,
      description: 'الوحدة الفنية بالوزارة ترجع المطالبة',
      returnTargets: [
        { toStatus: 'returned_by_technical',     labelAr: 'المقاول' },
        { toStatus: 'under_supervisor_review',   labelAr: 'المكتب الهندسي' },
      ],
    },
  ],

  returned_by_technical: [
    {
      action: 'resubmit',
      toStatus: 'under_supervisor_review',
      allowedRoles: ['contractor'],
      requiresNote: false,
      description: 'مقاول يعيد تقديم المطالبة — توجيه مباشر للمكتب الهندسي',
    },
  ],

  // ── Stage 3: Quality Unit (وحدة الجودة بالوزارة, 1-day SLA) ───────
  under_quality_review: [
    {
      action: 'approve',
      toStatus: 'under_project_manager_review',
      allowedRoles: ['quality'],
      requiresNote: false,
      description: 'وحدة الجودة بالوزارة توافق وتحيل لمدير المشروع',
    },
    {
      action: 'return',
      toStatus: 'returned_by_quality',
      allowedRoles: ['quality'],
      requiresNote: true,
      minNoteLength: 20,
      description: 'وحدة الجودة بالوزارة ترجع المطالبة',
      returnTargets: [
        { toStatus: 'returned_by_quality',       labelAr: 'المقاول' },
        { toStatus: 'under_supervisor_review',   labelAr: 'المكتب الهندسي' },
        { toStatus: 'under_technical_review',    labelAr: 'الوحدة الفنية بالوزارة' },
      ],
    },
  ],

  returned_by_quality: [
    {
      action: 'resubmit',
      toStatus: 'under_supervisor_review',
      allowedRoles: ['contractor'],
      requiresNote: false,
      description: 'مقاول يعيد تقديم المطالبة — توجيه مباشر للمكتب الهندسي',
    },
  ],

  // ── Stage 4: Project Manager (مدير المشروع, monitoring) ───────────
  under_project_manager_review: [
    {
      action: 'approve',
      toStatus: 'pending_director_approval',
      allowedRoles: ['project_manager'],
      requiresNote: false,
      description: 'مدير المشروع يوافق ويحيل للاعتماد النهائي',
    },
    {
      action: 'return',
      toStatus: 'returned_by_project_manager',
      allowedRoles: ['project_manager'],
      requiresNote: true,
      minNoteLength: 20,
      description: 'مدير المشروع يرجع المطالبة',
      returnTargets: [
        { toStatus: 'returned_by_project_manager', labelAr: 'المقاول' },
        { toStatus: 'under_supervisor_review',     labelAr: 'المكتب الهندسي' },
        { toStatus: 'under_technical_review',      labelAr: 'الوحدة الفنية بالوزارة' },
        { toStatus: 'under_quality_review',        labelAr: 'وحدة الجودة بالوزارة' },
      ],
    },
  ],

  returned_by_project_manager: [
    {
      action: 'resubmit',
      toStatus: 'under_supervisor_review',
      allowedRoles: ['contractor'],
      requiresNote: false,
      description: 'مقاول يعيد تقديم المطالبة — توجيه مباشر للمكتب الهندسي',
    },
  ],

  // ── LEGACY paths (claims that entered before Migration 046) ───────
  // New claims do NOT enter these statuses; the supervisor's `approve`
  // action now routes to under_technical_review instead. These rows
  // exist so existing claim records can still be processed forward.
  under_auditor_review: [
    {
      action: 'approve',
      toStatus: 'under_reviewer_check',
      allowedRoles: ['auditor'],
      requiresNote: false,
      description: 'مدقق يوافق على الجوانب التقنية (مسار قديم — قبل المرحلة 2.6)',
    },
    {
      action: 'return',
      toStatus: 'returned_by_auditor',
      allowedRoles: ['auditor'],
      requiresNote: true,
      minNoteLength: 20,
      description: 'مدقق يرجع المطالبة للمقاول (مسار قديم)',
      returnTargets: [
        { toStatus: 'returned_by_auditor', labelAr: 'المقاول' },
      ],
    },
  ],

  returned_by_auditor: [
    {
      action: 'resubmit',
      toStatus: 'under_supervisor_review',
      allowedRoles: ['contractor'],
      requiresNote: false,
      description: 'مقاول يعيد تقديم المطالبة — توجيه مباشر للمكتب الهندسي',
    },
  ],

  under_reviewer_check: [
    {
      action: 'approve',
      toStatus: 'pending_director_approval',
      allowedRoles: ['reviewer'],
      requiresNote: false,
      description: 'مراجع يؤكد توافق منصة الاعتماد (مسار قديم)',
    },
    {
      action: 'return',
      toStatus: 'returned_by_auditor',
      allowedRoles: ['reviewer'],
      requiresNote: true,
      minNoteLength: 20,
      description: 'مراجع يرجع للمدقق للتصحيح (مسار قديم)',
      returnTargets: [
        { toStatus: 'returned_by_auditor', labelAr: 'المدقق' },
      ],
    },
  ],

  // ── Stage 5: Final Approval (الاعتماد النهائي) ───────────────────
  // 'director' retains full access. Additional final approvers are checked
  // dynamically at the API level via the contract_approvers table (migration 040).
  // The allowedRoles here serve as static client-side hints — the real check
  // for non-director final approvers is in /api/claims/transition.
  pending_director_approval: [
    {
      action: 'approve',
      toStatus: 'approved',
      allowedRoles: ['director', 'final_approver'],
      requiresNote: false,
      description: 'الاعتماد النهائي يعتمد المطالبة نهائياً',
    },
    {
      action: 'reject',
      toStatus: 'rejected',
      allowedRoles: ['director', 'final_approver'],
      requiresNote: true,
      minNoteLength: 20,
      description: 'الاعتماد النهائي يرفض المطالبة',
    },
    {
      action: 'return',
      // Phase 2.6: default target is the dedicated returned_by_final_approver
      // sink (NEW), not the legacy under_auditor_review fallback.
      toStatus: 'returned_by_final_approver',
      allowedRoles: ['director', 'final_approver'],
      requiresNote: true,
      minNoteLength: 20,
      description: 'الاعتماد النهائي يرجع المطالبة',
      returnTargets: [
        { toStatus: 'returned_by_final_approver',      labelAr: 'المقاول' },
        { toStatus: 'under_supervisor_review',         labelAr: 'المكتب الهندسي' },
        { toStatus: 'under_technical_review',          labelAr: 'الوحدة الفنية بالوزارة' },
        { toStatus: 'under_quality_review',            labelAr: 'وحدة الجودة بالوزارة' },
        { toStatus: 'under_project_manager_review',    labelAr: 'مدير المشروع' },
      ],
    },
  ],

  returned_by_final_approver: [
    {
      action: 'resubmit',
      toStatus: 'under_supervisor_review',
      allowedRoles: ['contractor'],
      requiresNote: false,
      description: 'مقاول يعيد تقديم المطالبة — توجيه مباشر للمكتب الهندسي',
    },
  ],

  // ── Terminal states ──────────────────────────────────────────────
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

// ─── Phase 2.6 — Flexible-return target resolution ────────────────

/**
 * Resolves the list of allowed `to_status` targets for a flexible-return
 * action. Used by:
 *   • the API route (Phase 2.6 commit #7) to validate a picked target
 *     against an explicit allow-list before persisting the transition;
 *   • the UI (Phase 2.6 commit #8) to render the target-stage radio
 *     group in the return modal.
 *
 * Behaviour:
 *   • If the (currentStatus, role) combination has a matching `return`
 *     transition with explicit `returnTargets`, those are returned
 *     verbatim (preserving the planner's order — index 0 is always the
 *     contractor-bound default).
 *   • If the matching transition has no `returnTargets` (single-target
 *     legacy return), a synthetic single-element list is returned with
 *     the legacy `toStatus` and the label "المقاول" — so consumers can
 *     treat every return uniformly.
 *   • If no `return` transition exists for the role at this status,
 *     returns an empty array. The caller must NOT permit a return in
 *     that case.
 *
 * The returned array is a fresh copy — callers may mutate it freely.
 */
export function getReturnTargets(
  currentStatus: ClaimStatus,
  role: WorkflowRole,
): Array<{ toStatus: ClaimStatus; labelAr: string }> {
  const transitions = CLAIM_TRANSITIONS[currentStatus];
  if (!transitions || transitions.length === 0) return [];

  const ret = transitions.find(
    (t) => t.action === 'return' && t.allowedRoles.includes(role),
  );
  if (!ret) return [];

  if (ret.returnTargets && ret.returnTargets.length > 0) {
    // Defensive copy so callers can't mutate the source-of-truth list.
    return ret.returnTargets.map((rt) => ({ ...rt }));
  }

  // Legacy single-target return — synthesize a contractor-bound entry
  // using the transition's default toStatus. Keeps the API uniform.
  return [{ toStatus: ret.toStatus, labelAr: 'المقاول' }];
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
    under_supervisor_review: 'مراجعة المكتب الهندسي',
    returned_by_supervisor: 'مُرجَّعة من المكتب الهندسي',
    under_auditor_review: 'مراجعة المدقق',                         // legacy
    returned_by_auditor: 'مُرجَّعة من المدقق',                      // legacy
    under_reviewer_check: 'فحص المراجع',                            // legacy
    // Phase 2.6 additions — labels match constants.CLAIM_STATUS_LABELS.
    under_technical_review: 'مراجعة الوحدة الفنية بالوزارة',
    returned_by_technical: 'مُرجَّعة من الوحدة الفنية بالوزارة',
    under_quality_review: 'مراجعة وحدة الجودة بالوزارة',
    returned_by_quality: 'مُرجَّعة من وحدة الجودة بالوزارة',
    under_project_manager_review: 'مراجعة مدير المشروع',
    returned_by_project_manager: 'مُرجَّعة من مدير المشروع',
    returned_by_final_approver: 'مُرجَّعة من الاعتماد النهائي',
    pending_director_approval: 'بانتظار الاعتماد النهائي',
    approved: 'معتمدة',
    rejected: 'مرفوضة',
    cancelled: 'ملغاة',
  };
  return labels[status];
}

/**
 * Gets actor role name for current status (who should act next).
 *
 * Phase 2.6: return type widened to `WorkflowRole | null` so the new
 * gating roles `quality` and `project_manager` (which are NOT in
 * UserRole) can be returned. UserRole consumers continue to work via
 * the structural-subtype rule (UserRole ⊂ WorkflowRole).
 */
export function getExpectedActorRole(status: ClaimStatus): WorkflowRole | null {
  const actorMap: Record<ClaimStatus, WorkflowRole | null> = {
    draft: 'contractor',
    submitted: 'supervisor',
    under_supervisor_review: 'supervisor',
    returned_by_supervisor: 'contractor',
    under_auditor_review: 'auditor',                  // legacy
    returned_by_auditor: 'contractor',                // legacy
    under_reviewer_check: 'reviewer',                 // legacy
    // Phase 2.6 additions. The new gating roles `quality` and
    // `project_manager` are ContractRole values, not UserRole values, so
    // they cannot be returned from this helper without widening UserRole.
    // Until the role-model unification (planned for Phase 2.6 commit #4
    // / #5), the new under_*_review statuses fall through to null and the
    // returned_by_* statuses correctly route to 'contractor'.
    under_technical_review: 'reviewer',
    returned_by_technical: 'contractor',
    // Phase 2.6 commit #4 — UserRole now includes 'quality' and
    // 'project_manager' (Migration 045 ContractRole identifiers
    // promoted to gating workflow roles), so these statuses can map
    // directly to their owning role identifier.
    under_quality_review: 'quality',
    returned_by_quality: 'contractor',
    under_project_manager_review: 'project_manager',
    returned_by_project_manager: 'contractor',
    returned_by_final_approver: 'contractor',
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
 * Returns a workflow chain (path to final approval).
 *
 * Phase 2.6: replaces the legacy auditor/reviewer chain with the new
 * pipeline. Claims that are still in the legacy `under_auditor_review`
 * or `under_reviewer_check` status fall back to the chain head — the
 * helper is a visualisation hint only, so this is acceptable.
 */
export function getWorkflowChain(currentStatus: ClaimStatus): ClaimStatus[] {
  const chain: ClaimStatus[] = [
    'draft',
    'submitted',
    'under_supervisor_review',
    'under_technical_review',
    'under_quality_review',
    'under_project_manager_review',
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
    under_auditor_review: 42,                  // legacy
    returned_by_auditor: 42,                    // legacy
    under_reviewer_check: 70,                   // legacy
    // Phase 2.6 additions — interleaved into the existing 0-100 scale so
    // claims in the new pipeline display a sensible progress bar.
    under_technical_review: 50,
    returned_by_technical: 50,
    under_quality_review: 70,
    returned_by_quality: 70,
    under_project_manager_review: 80,
    returned_by_project_manager: 80,
    returned_by_final_approver: 85,
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
    under_auditor_review: '#8B5CF6',                  // legacy
    returned_by_auditor: '#F97316',                    // legacy
    under_reviewer_check: '#EC4899',                   // legacy
    // Phase 2.6 additions — palette mirrors sibling stages.
    under_technical_review: '#8B5CF6',                 // purple, like legacy auditor
    returned_by_technical: '#F97316',
    under_quality_review: '#FFC845',                   // gold — pending review
    returned_by_quality: '#F97316',
    under_project_manager_review: '#06B6D4',           // teal, like consultant
    returned_by_project_manager: '#F97316',
    returned_by_final_approver: '#F97316',
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
    // Migration 045 additions — advisory only, no workflow mapping yet.
    // Returning null means contractRoleToWorkflowRole(role) → null,
    // which falls back to the existing "no workflow actions" behaviour.
    project_manager: null,
    quality:         null,
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
