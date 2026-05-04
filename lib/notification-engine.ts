/**
 * CONVERA — Action-Driven Notification Engine (محرك الإشعارات المبني على الإجراءات)
 *
 * CRITICAL RULE: Every notification MUST be validated against getAvailableActionsForClaim().
 * If the recipient has NO executable actions → NO notification is sent.
 *
 * This ensures zero "phantom notifications" — notifications that tell a user to act
 * when they cannot actually perform any action.
 *
 * Architecture:
 *   - Built on top of action-engine.ts (consumes getAvailableActionsForClaim)
 *   - Trigger events map to workflow transitions
 *   - Each event determines recipients + validates actions before sending
 *   - Returns structured NotificationPayload objects for API routes to persist
 *
 * Does NOT:
 *   - Persist notifications directly (returns payloads for caller to insert)
 *   - Send emails directly (returns email data for caller to dispatch)
 *   - Modify RLS, auth, or workflow states
 */

import {
  getAvailableActionsForClaim,
  buildActionContext,
  hasExecutableAction,
  getPrimaryAction,
  type ActionContext,
  type ClaimAction,
} from './action-engine';
import { getExpectedActorRole, getStageLabel } from './workflow-engine';
import type { ClaimStatus, UserRole, ContractRole } from './types';

// ─── Event Types ────────────────────────────────────────────────

export type NotificationEvent =
  | 'claim.submitted'
  | 'claim.resubmitted'
  | 'supervisor.approved'
  | 'auditor.approved'              // legacy pre-Migration-046 path
  | 'reviewer.approved'             // legacy pre-Migration-046 path
  // Phase 2.6 — new gating stages, per upgrade plan §3a forward path.
  | 'technical.approved'
  | 'quality.approved'
  | 'pm.approved'
  | 'director.approved'
  | 'claim.returned'
  | 'claim.rejected'
  | 'sla.warning'
  | 'sla.overdue';

export type NotificationChannel = 'in_app' | 'email' | 'both';

// ─── Notification Payload ───────────────────────────────────────

export interface NotificationPayload {
  /** Recipient user ID */
  userId: string;
  /** Notification type for DB storage */
  type: string;
  /** Arabic title */
  title_ar: string;
  /** Arabic body message */
  body_ar: string;
  /** Entity type for linking */
  entityType: 'claim' | 'change_order' | 'contract';
  /** Entity ID */
  entityId: string;
  /** Contract ID (for routing context) */
  contractId: string;
  /** Primary action the user should take */
  actionType: string | null;
  /** Action label in Arabic (for email CTA button) */
  actionLabel_ar: string | null;
  /** Channel: in-app, email, or both */
  channel: NotificationChannel;
  /** Additional metadata */
  metadata: Record<string, unknown>;
}

// ─── Claim Context (minimal data needed to resolve notifications) ──

export interface NotificationClaimContext {
  id: string;
  claim_no: number | string;
  contract_id: string;
  contract_no?: string;
  contract_title_ar?: string;
  status: ClaimStatus;
  submitted_by: string | null;
  return_reason?: string | null;
  last_transition_at?: string | null;
}

// ─── Recipient with role context ─────────────────────────────────

export interface RecipientContext {
  userId: string;
  globalRole: UserRole;
  contractRole: ContractRole | null;
  isGlobalRole: boolean;
}

// ─── Event Trigger Context ──────────────────────────────────────

export interface EventContext {
  /** The event that occurred */
  event: NotificationEvent;
  /** Claim data */
  claim: NotificationClaimContext;
  /** Who triggered the event (actor) */
  actorId: string;
  /** Actor's display name */
  actorName: string;
  /** Previous status (before transition) */
  fromStatus?: ClaimStatus;
  /** New status (after transition) */
  toStatus: ClaimStatus;
  /** Potential recipients with their roles */
  recipients: RecipientContext[];
  /** Document state for action-engine validation */
  documents: { type: string }[];
  /** SLA context (for SLA events) */
  slaDaysElapsed?: number;
  slaBreached?: boolean;
}

// ─── Phase 2.6 — Return-target Arabic label ──────────────────────

/**
 * Short Arabic label for the destination of a flexible-return.
 *
 * Used by the `claim.returned` body template to render
 * "تم إرجاع المطالبة #X من <source> إلى <target>".
 *
 * The mapping covers:
 *   • All `returned_by_*` sinks (return-to-contractor) → "المقاول"
 *   • All `under_*_review` destinations (return-to-earlier-stage)
 *     → the human stage name
 *
 * Falls back to `getStageLabel(toStatus)` for any unknown status —
 * the workflow-engine map already contains every valid value.
 */
function getReturnTargetLabelAr(toStatus: ClaimStatus): string {
  const labels: Partial<Record<ClaimStatus, string>> = {
    // Return-to-contractor sinks
    returned_by_supervisor:       'المقاول',
    returned_by_auditor:          'المقاول',
    returned_by_technical:        'المقاول',
    returned_by_quality:          'المقاول',
    returned_by_project_manager:  'المقاول',
    returned_by_final_approver:   'المقاول',
    // Return-to-earlier-review-stage destinations
    under_supervisor_review:      'المكتب الهندسي',
    under_auditor_review:         'المدقق',
    under_reviewer_check:         'المراجع',
    under_technical_review:       'الوحدة الفنية بالوزارة',
    under_quality_review:         'وحدة الجودة بالوزارة',
    under_project_manager_review: 'مدير المشروع',
  };
  return labels[toStatus] ?? getStageLabel(toStatus);
}

// ─── Arabic Message Templates ────────────────────────────────────

const EVENT_MESSAGES: Record<NotificationEvent, {
  title: (ctx: EventContext) => string;
  body: (ctx: EventContext) => string;
  notificationType: string;
  channel: NotificationChannel;
}> = {
  'claim.submitted': {
    title: (ctx) => `مطالبة جديدة #${ctx.claim.claim_no} بانتظار مراجعتكم`,
    body: (ctx) =>
      `تم تقديم المطالبة رقم ${ctx.claim.claim_no} من قبل ${ctx.actorName}` +
      (ctx.claim.contract_no ? ` — العقد ${ctx.claim.contract_no}` : '') +
      `. يرجى مراجعتها واتخاذ الإجراء المناسب.`,
    notificationType: 'claim_submitted',
    channel: 'both',
  },
  'claim.resubmitted': {
    title: (ctx) => `إعادة تقديم المطالبة #${ctx.claim.claim_no}`,
    body: (ctx) =>
      `أعاد ${ctx.actorName} تقديم المطالبة رقم ${ctx.claim.claim_no} بعد التصحيح` +
      (ctx.claim.contract_no ? ` — العقد ${ctx.claim.contract_no}` : '') +
      `. يرجى مراجعتها.`,
    notificationType: 'claim_resubmitted',
    channel: 'both',
  },
  'supervisor.approved': {
    // Phase 2.6 — supervisor approve now routes to under_technical_review
    // (the Technical Unit), not the legacy auditor stage. Body updated
    // to match. Title also uses the canonical Phase 2.6 Arabic term
    // for the supervisor role ("المكتب الهندسي").
    title: (ctx) => `تمت إحالة المطالبة #${ctx.claim.claim_no} للوحدة الفنية بالوزارة`,
    body: (ctx) =>
      `وافق المكتب الهندسي (${ctx.actorName}) على المطالبة رقم ${ctx.claim.claim_no}` +
      (ctx.claim.contract_no ? ` — العقد ${ctx.claim.contract_no}` : '') +
      ` وتم إحالتها للوحدة الفنية بالوزارة.`,
    notificationType: 'claim_forwarded',
    channel: 'both',
  },
  'auditor.approved': {
    title: (ctx) => `تمت إحالة المطالبة #${ctx.claim.claim_no} للمراجعة`,
    body: (ctx) =>
      `أتمّ المدقق (${ctx.actorName}) تدقيق المطالبة رقم ${ctx.claim.claim_no}` +
      ` وتم إحالتها لكم للمراجعة.`,
    notificationType: 'claim_forwarded',
    channel: 'both',
  },
  'reviewer.approved': {
    title: (ctx) => `المطالبة #${ctx.claim.claim_no} بانتظار اعتمادكم`,
    body: (ctx) =>
      `أتمّ المراجع (${ctx.actorName}) فحص المطالبة رقم ${ctx.claim.claim_no}` +
      ` وتم رفعها لاعتمادكم النهائي.`,
    notificationType: 'claim_pending_approval',
    channel: 'both',
  },
  // ── Phase 2.6 — new gating-stage approve events ────────────────
  'technical.approved': {
    title: (ctx) => `تمت إحالة المطالبة #${ctx.claim.claim_no} لوحدة الجودة`,
    body: (ctx) =>
      `أتمّت الوحدة الفنية بالوزارة (${ctx.actorName}) فحص المطالبة رقم ${ctx.claim.claim_no}` +
      (ctx.claim.contract_no ? ` — العقد ${ctx.claim.contract_no}` : '') +
      ` وتم إحالتها لوحدة الجودة بالوزارة لاعتماد الجودة.`,
    notificationType: 'claim_forwarded',
    channel: 'both',
  },
  'quality.approved': {
    title: (ctx) => `تمت إحالة المطالبة #${ctx.claim.claim_no} لمدير المشروع`,
    body: (ctx) =>
      `وافقت وحدة الجودة بالوزارة (${ctx.actorName}) على المطالبة رقم ${ctx.claim.claim_no}` +
      (ctx.claim.contract_no ? ` — العقد ${ctx.claim.contract_no}` : '') +
      ` وتم إحالتها لمدير المشروع للمراجعة النهائية.`,
    notificationType: 'claim_forwarded',
    channel: 'both',
  },
  'pm.approved': {
    title: (ctx) => `المطالبة #${ctx.claim.claim_no} بانتظار الاعتماد النهائي`,
    body: (ctx) =>
      `أتمّ مدير المشروع (${ctx.actorName}) مراجعة المطالبة رقم ${ctx.claim.claim_no}` +
      (ctx.claim.contract_no ? ` — العقد ${ctx.claim.contract_no}` : '') +
      ` وتم رفعها للاعتماد النهائي.`,
    notificationType: 'claim_pending_approval',
    channel: 'both',
  },
  'director.approved': {
    title: (ctx) => `تم اعتماد المطالبة #${ctx.claim.claim_no} نهائياً`,
    body: (ctx) =>
      `اعتمد مدير الإدارة (${ctx.actorName}) المطالبة رقم ${ctx.claim.claim_no}` +
      (ctx.claim.contract_no ? ` — العقد ${ctx.claim.contract_no}` : '') +
      `.`,
    notificationType: 'claim_approved',
    channel: 'both',
  },
  'claim.returned': {
    // Phase 2.6 — title now names the destination so a glance at the
    // notification list reveals where the claim went.
    title: (ctx) => {
      const targetStage = getReturnTargetLabelAr(ctx.toStatus);
      return `تم إرجاع المطالبة #${ctx.claim.claim_no} إلى ${targetStage}`;
    },
    // Phase 2.6 — body follows the upgrade-plan canonical format:
    //   "تم إرجاع المطالبة رقم {claimNo} من {sourceStage} إلى {targetStage}.
    //    السبب: {reason}"
    body: (ctx) => {
      const sourceStage = getStageLabel(ctx.fromStatus ?? ctx.claim.status);
      const targetStage = getReturnTargetLabelAr(ctx.toStatus);
      let msg = `تم إرجاع المطالبة رقم ${ctx.claim.claim_no} من ${sourceStage} إلى ${targetStage} بواسطة ${ctx.actorName}.`;
      if (ctx.claim.return_reason) {
        msg += ` السبب: ${ctx.claim.return_reason}`;
      }
      return msg;
    },
    notificationType: 'claim_returned',
    channel: 'both',
  },
  'claim.rejected': {
    title: (ctx) => `تم رفض المطالبة #${ctx.claim.claim_no}`,
    body: (ctx) =>
      `رفض مدير الإدارة (${ctx.actorName}) المطالبة رقم ${ctx.claim.claim_no}` +
      (ctx.claim.contract_no ? ` — العقد ${ctx.claim.contract_no}` : '') +
      `.`,
    notificationType: 'claim_rejected',
    channel: 'both',
  },
  'sla.warning': {
    title: (ctx) => `تنبيه: المطالبة #${ctx.claim.claim_no} تقترب من نهاية المهلة`,
    body: (ctx) =>
      `المطالبة رقم ${ctx.claim.claim_no} في مرحلة "${getStageLabel(ctx.claim.status)}"` +
      ` منذ ${ctx.slaDaysElapsed ?? 0} يوم — المهلة المسموحة على وشك الانتهاء.` +
      ` يرجى اتخاذ الإجراء المناسب.`,
    notificationType: 'sla_warning',
    channel: 'both',
  },
  'sla.overdue': {
    title: (ctx) => `تنبيه عاجل: المطالبة #${ctx.claim.claim_no} تجاوزت المهلة النظامية`,
    body: (ctx) =>
      `المطالبة رقم ${ctx.claim.claim_no} تجاوزت المهلة المسموحة في مرحلة "${getStageLabel(ctx.claim.status)}"` +
      ` (${ctx.slaDaysElapsed ?? 0} يوم). يتطلب تدخلاً فورياً.`,
    notificationType: 'sla_escalation',
    channel: 'both',
  },
};

// ─── Core Engine ─────────────────────────────────────────────────

/**
 * THE unified notification resolver.
 *
 * For each potential recipient:
 *   1. Build ActionContext
 *   2. Call getAvailableActionsForClaim()
 *   3. If NO executable actions → skip (no phantom notification)
 *   4. If has actions → generate notification with primary action reference
 *
 * Returns: Array of NotificationPayload ready for DB insert + email dispatch
 */
export function getNotificationsForClaimEvent(
  eventCtx: EventContext,
): NotificationPayload[] {
  const payloads: NotificationPayload[] = [];
  const template = EVENT_MESSAGES[eventCtx.event];

  if (!template) {
    console.warn(`[notification-engine] Unknown event: ${eventCtx.event}`);
    return [];
  }

  for (const recipient of eventCtx.recipients) {
    // Skip: don't notify the actor themselves
    if (recipient.userId === eventCtx.actorId) continue;

    // CRITICAL: Build ActionContext for this recipient and validate
    const actionCtx = buildActionContext({
      userId: recipient.userId,
      globalRole: recipient.globalRole,
      contractRole: recipient.contractRole,
      isGlobalRole: recipient.isGlobalRole,
      claim: {
        status: eventCtx.toStatus,
        submitted_by: eventCtx.claim.submitted_by,
        return_reason: eventCtx.claim.return_reason,
      },
      documents: eventCtx.documents,
      slaDaysElapsed: eventCtx.slaDaysElapsed,
      slaBreached: eventCtx.slaBreached,
    });

    const actions = getAvailableActionsForClaim(actionCtx);

    // CRITICAL CHECK: If no executable actions → skip notification
    // Exception: terminal events (approved/rejected) always notify submitter
    const isTerminalEvent = eventCtx.event === 'director.approved' || eventCtx.event === 'claim.rejected';
    const isSubmitter = recipient.userId === eventCtx.claim.submitted_by;

    if (!hasExecutableAction(actions) && !(isTerminalEvent && isSubmitter)) {
      continue;
    }

    // Get primary action for CTA button
    const primaryAction = getPrimaryAction(actions);

    payloads.push({
      userId: recipient.userId,
      type: template.notificationType,
      title_ar: template.title(eventCtx),
      body_ar: template.body(eventCtx),
      entityType: 'claim',
      entityId: eventCtx.claim.id,
      contractId: eventCtx.claim.contract_id,
      actionType: primaryAction?.type ?? null,
      actionLabel_ar: primaryAction?.label_ar ?? null,
      channel: template.channel,
      metadata: {
        event: eventCtx.event,
        fromStatus: eventCtx.fromStatus,
        toStatus: eventCtx.toStatus,
        actorId: eventCtx.actorId,
        claimNo: eventCtx.claim.claim_no,
        contractNo: eventCtx.claim.contract_no,
        slaDaysElapsed: eventCtx.slaDaysElapsed,
        primaryActionType: primaryAction?.type,
      },
    });
  }

  return payloads;
}

// ─── Event Resolution Helper ─────────────────────────────────────

/**
 * Resolves the notification event from a workflow action + status transition.
 * Used by API routes to determine which event to fire.
 */
export function resolveNotificationEvent(
  action: string,
  fromStatus: ClaimStatus,
  toStatus: ClaimStatus,
): NotificationEvent | null {
  // Submit / Resubmit
  if (action === 'submit') return 'claim.submitted';
  if (action === 'resubmit') return 'claim.resubmitted';

  // Approvals — route by from-status to know which stage approved
  if (action === 'approve') {
    if (fromStatus === 'under_supervisor_review') return 'supervisor.approved';
    if (fromStatus === 'under_auditor_review') return 'auditor.approved';     // legacy
    if (fromStatus === 'under_reviewer_check') return 'reviewer.approved';    // legacy
    // Phase 2.6 — new pipeline stages
    if (fromStatus === 'under_technical_review') return 'technical.approved';
    if (fromStatus === 'under_quality_review') return 'quality.approved';
    if (fromStatus === 'under_project_manager_review') return 'pm.approved';
    if (fromStatus === 'pending_director_approval') return 'director.approved';
    // Submitted auto-route
    if (fromStatus === 'submitted') return 'claim.submitted';
  }

  // Return
  if (action === 'return') return 'claim.returned';

  // Reject
  if (action === 'reject') return 'claim.rejected';

  // SLA events (set externally, not from workflow actions)
  // These are handled via sla-escalation.ts

  return null;
}

// ─── Recipient Resolution Helper ─────────────────────────────────

/**
 * Maps a target status to the contract roles that should be notified.
 * Used by API routes to fetch the actual user IDs from user_contract_roles.
 */
export function getTargetRolesForStatus(toStatus: ClaimStatus): {
  contractRoles: ContractRole[];
  globalRoles: UserRole[];
  notifySubmitter: boolean;
} {
  switch (toStatus) {
    case 'under_supervisor_review':
      return { contractRoles: ['supervisor'], globalRoles: [], notifySubmitter: false };

    // Legacy paths (pre-Migration-046 in-flight claims)
    case 'under_auditor_review':
      return { contractRoles: ['auditor'], globalRoles: [], notifySubmitter: false };

    case 'under_reviewer_check':
      return { contractRoles: ['reviewer'], globalRoles: [], notifySubmitter: false };

    // Phase 2.6 — new gating stages.
    case 'under_technical_review':
      return { contractRoles: ['reviewer'], globalRoles: [], notifySubmitter: false };

    case 'under_quality_review':
      return { contractRoles: ['quality'], globalRoles: [], notifySubmitter: false };

    case 'under_project_manager_review':
      return { contractRoles: ['project_manager'], globalRoles: [], notifySubmitter: false };

    case 'pending_director_approval':
      // Final approvers (contract-scoped) + global director.
      return { contractRoles: ['final_approver'], globalRoles: ['director'], notifySubmitter: false };

    // Every returned_by_* sink notifies the submitter (the contractor).
    case 'returned_by_supervisor':
    case 'returned_by_auditor':
    // Phase 2.6 — new returned-to-contractor sinks.
    case 'returned_by_technical':
    case 'returned_by_quality':
    case 'returned_by_project_manager':
    case 'returned_by_final_approver':
      return { contractRoles: [], globalRoles: [], notifySubmitter: true };

    case 'approved':
    case 'rejected':
      return { contractRoles: [], globalRoles: [], notifySubmitter: true };

    default:
      return { contractRoles: [], globalRoles: [], notifySubmitter: false };
  }
}

// ─── SLA Notification Helper ─────────────────────────────────────

/**
 * Builds SLA notification event context.
 * Called by sla-escalation.ts when warning/overdue thresholds are reached.
 */
export function buildSLAEventContext(
  event: 'sla.warning' | 'sla.overdue',
  claim: NotificationClaimContext,
  recipients: RecipientContext[],
  documents: { type: string }[],
  slaDaysElapsed: number,
): EventContext {
  return {
    event,
    claim,
    actorId: 'system',
    actorName: 'النظام',
    toStatus: claim.status,
    recipients,
    documents,
    slaDaysElapsed,
    slaBreached: event === 'sla.overdue',
  };
}
