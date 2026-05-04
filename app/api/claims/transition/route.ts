/**
 * POST /api/claims/transition
 * Workflow transition endpoint with full governance enforcement
 *
 * Validates:
 * 1. User has permission for this action (role-based, from JWT session — NOT request body)
 * 2. Transition is valid from current status
 * 3. Mandatory return reason is provided when needed
 * 4. Claim is not already approved/rejected (immutable)
 * 5. No claim exceeds contract value + 10%
 *
 * SECURITY: actorId is ALWAYS derived from the authenticated JWT session (user.id).
 * Any actorId supplied in the request body is validated to match user.id and then
 * discarded in favour of the session value. This prevents role impersonation attacks
 * where an attacker passes another user's UUID to claim their role.
 *
 * Then executes transition, updates audit trail, sends notifications
 */

import { createServerSupabaseFromRequest, createAdminSupabase } from '@/lib/supabase-server';
import { assertContractScope, isGlobalRole, ScopeError } from '@/lib/contract-scope';
import { resolveContractRole } from '@/lib/contract-permissions';
import { NextRequest, NextResponse } from 'next/server';
import type { ClaimStatus, ContractRole, UserRole, WorkflowRole } from '@/lib/types';
import {
  CLAIM_TRANSITIONS,
  canTransitionByContractRole,
  contractRoleToWorkflowRole,
  getReturnTargets,
} from '@/lib/workflow-engine';
import {
  resolveNotificationEvent,
  getNotificationsForClaimEvent,
  getTargetRolesForStatus,
  type RecipientContext,
  type NotificationClaimContext,
} from '@/lib/notification-engine';

interface TransitionRequest {
  claimId: string;
  action: string;
  returnReason?: string;
  rejectionReason?: string;
  /**
   * actorId is OPTIONAL in the request body.
   * If supplied it MUST match the authenticated user.id — any mismatch returns 403.
   * The server always uses user.id (from the verified JWT) as the effective actor.
   */
  actorId?: string;
  notes?: string;
  /**
   * Phase 2.6 — flexible-return target.
   *
   * For action='return' the client MAY send a picked target stage.
   * The server validates this picked value against the allow-list
   * produced by getReturnTargets(currentStatus, workflowRole). Any
   * to_status outside that allow-list is rejected with HTTP 422.
   *
   * If omitted on a return action, the server defaults to the
   * contractor-bound target (allowedTargets[0]) — preserving legacy
   * single-target behaviour for clients that pre-date the picker UI.
   *
   * For non-return actions this field is IGNORED — the destination
   * always comes from the matched TransitionDef.toStatus.
   */
  to_status?: ClaimStatus;
}

interface TransitionResponse {
  data?: {
    claim: Record<string, unknown>;
    workflow: Record<string, unknown>;
    notifications?: unknown[];
  };
  error?: string;
}

function errorResponse(message: string, status: number = 400): NextResponse<TransitionResponse> {
  return NextResponse.json({ error: message }, { status });
}

function successResponse(data: TransitionResponse['data']): NextResponse<TransitionResponse> {
  return NextResponse.json({ data }, { status: 200 });
}

// ─── Helper Functions ────────────────────────────────────────────

/**
 * Validate transition is allowed for current status.
 *
 * Phase 2.6: parameter widened to WorkflowRole so quality / project_manager
 * dispatch correctly. UserRole values still pass (UserRole ⊂ WorkflowRole).
 */
function isTransitionAllowed(
  currentStatus: ClaimStatus,
  action: string,
  userRole: WorkflowRole,
): { allowed: boolean; toStatus?: ClaimStatus; error?: string } {
  const transitions = CLAIM_TRANSITIONS[currentStatus];

  if (!transitions) {
    return { allowed: false, error: `لا توجد إجراءات متاحة للحالة: ${currentStatus}` };
  }

  const transition = transitions.find((t) => t.action === action);

  if (!transition) {
    return { allowed: false, error: `الإجراء "${action}" غير متاح لهذه الحالة` };
  }

  if (!transition.allowedRoles.includes(userRole)) {
    return {
      allowed: false,
      error: `ليس لديك صلاحية لتنفيذ هذا الإجراء. الأدوار المسموحة: ${transition.allowedRoles.join(', ')}`,
    };
  }

  return { allowed: true, toStatus: transition.toStatus };
}

/**
 * Local quality / project_manager bridge.
 *
 * `lib/workflow-engine.ts::contractRoleToWorkflowRole` still returns
 * null for `quality` / `project_manager` (it predates Migration 045's
 * promotion of those values to gating roles, and a workflow-engine
 * edit is out of scope for Phase 2.6 commit #7). This local helper
 * recognises the two values and returns the matching WorkflowRole;
 * everything else falls through to the workflow-engine's resolver.
 *
 * Architectural note: `lib/action-engine.ts` already has the correct
 * map (Phase 2.6 commit #5), but its resolver is module-private. We
 * intentionally don't import it from action-engine — that file is
 * locked for this commit, and a single 2-line bridge here costs less
 * than restructuring the export surface.
 */
function resolveActorWorkflowRole(
  contractRole: ContractRole | null,
): WorkflowRole | null {
  if (contractRole === 'quality') return 'quality';
  if (contractRole === 'project_manager') return 'project_manager';
  if (!contractRole) return null;
  return contractRoleToWorkflowRole(contractRole);
}

/**
 * Check if claim exceeds contract limit
 */
async function checkContractLimit(
  supabase: any,
  claimId: string,
): Promise<{ withinLimit: boolean; reason?: string }> {
  // Fetch claim and contract
  const { data: claim } = await supabase
    .from('claims')
    .select('id, contract_id, total_amount, status')
    .eq('id', claimId)
    .single();

  const { data: contract } = await supabase
    .from('contracts')
    .select('base_value')
    .eq('id', claim.contract_id)
    .single();

  if (!claim || !contract) {
    return { withinLimit: false, reason: 'فشل في جلب بيانات العقد' };
  }

  // Calculate total approved claims (excluding current)
  const { data: approvedClaims } = await supabase
    .from('claims')
    .select('total_amount')
    .eq('contract_id', claim.contract_id)
    .in('status', ['approved', 'closed'])
    .neq('id', claimId);

  const totalApproved = (approvedClaims || []).reduce(
    (sum: number, c: any) => sum + (parseFloat(c.total_amount) || 0),
    0,
  );

  const maxAllowed = contract.base_value * 1.1; // 10% tolerance
  const wouldExceed = totalApproved + (parseFloat(claim.total_amount) || 0) > maxAllowed;

  if (wouldExceed) {
    return {
      withinLimit: false,
      reason: `المطالبة ستتجاوز حد العقد المسموح به (١٠%). المسموح: ر.س ${maxAllowed.toLocaleString('ar-SA')}، الإجمالي المعتمد: ر.س ${(totalApproved + parseFloat(claim.total_amount)).toLocaleString('ar-SA')}`,
    };
  }

  return { withinLimit: true };
}

/**
 * Determine recipients for workflow notifications based on new status.
 * Uses contract-scoped roles (user_contract_roles) for routing.
 */
async function getNotificationRecipients(
  adminClient: any,
  claimId: string,
  toStatus: ClaimStatus,
  fromStatus: ClaimStatus,
): Promise<string[]> {
  const { data: claim } = await adminClient
    .from('claims')
    .select('contract_id, submitted_by')
    .eq('id', claimId)
    .single();

  if (!claim) return [];

  const recipients: string[] = [];

  // Contract-role-driven notification routing
  if (toStatus === 'under_supervisor_review') {
    // Notify all active supervisors on this contract
    const { data: supervisors } = await adminClient
      .from('user_contract_roles')
      .select('user_id')
      .eq('contract_id', claim.contract_id)
      .eq('contract_role', 'supervisor')
      .eq('is_active', true);
    if (supervisors) recipients.push(...supervisors.map((s: { user_id: string }) => s.user_id));
  }

  if (toStatus === 'under_auditor_review') {
    // Notify all active auditors on this contract
    const { data: auditors } = await adminClient
      .from('user_contract_roles')
      .select('user_id')
      .eq('contract_id', claim.contract_id)
      .eq('contract_role', 'auditor')
      .eq('is_active', true);
    if (auditors) recipients.push(...auditors.map((a: { user_id: string }) => a.user_id));
  }

  if (toStatus === 'under_reviewer_check') {
    // Notify all active reviewers on this contract
    const { data: reviewers } = await adminClient
      .from('user_contract_roles')
      .select('user_id')
      .eq('contract_id', claim.contract_id)
      .eq('contract_role', 'reviewer')
      .eq('is_active', true);
    if (reviewers) recipients.push(...reviewers.map((r: { user_id: string }) => r.user_id));
  }

  // ── Phase 2.6 — recipients for the 3 new gating stages ─────────────
  if (toStatus === 'under_technical_review') {
    // Technical Unit = ContractRole 'reviewer' on the new pipeline.
    const { data: technical } = await adminClient
      .from('user_contract_roles')
      .select('user_id')
      .eq('contract_id', claim.contract_id)
      .eq('contract_role', 'reviewer')
      .eq('is_active', true);
    if (technical) recipients.push(...technical.map((r: { user_id: string }) => r.user_id));
  }

  if (toStatus === 'under_quality_review') {
    // Quality Unit = ContractRole 'quality' (Migration 045 + commit #5).
    const { data: quality } = await adminClient
      .from('user_contract_roles')
      .select('user_id')
      .eq('contract_id', claim.contract_id)
      .eq('contract_role', 'quality')
      .eq('is_active', true);
    if (quality) recipients.push(...quality.map((r: { user_id: string }) => r.user_id));
  }

  if (toStatus === 'under_project_manager_review') {
    // Project Manager = ContractRole 'project_manager'.
    const { data: pms } = await adminClient
      .from('user_contract_roles')
      .select('user_id')
      .eq('contract_id', claim.contract_id)
      .eq('contract_role', 'project_manager')
      .eq('is_active', true);
    if (pms) recipients.push(...pms.map((r: { user_id: string }) => r.user_id));
  }

  if (toStatus === 'pending_director_approval') {
    // Notify director (global role — query profiles directly)
    const { data: directors } = await adminClient
      .from('profiles')
      .select('id')
      .eq('role', 'director');
    if (directors) recipients.push(...directors.map((d: { id: string }) => d.id));

    // Also notify designated final approvers on this contract (Migration 040)
    const { data: finalApprovers } = await adminClient
      .from('contract_approvers')
      .select('user_id')
      .eq('contract_id', claim.contract_id)
      .eq('approval_scope', 'final_approver')
      .eq('is_active', true);
    if (finalApprovers) recipients.push(...finalApprovers.map((a: { user_id: string }) => a.user_id));
  }

  if (toStatus.startsWith('returned') && claim?.submitted_by) {
    recipients.push(claim.submitted_by);
  }

  if ((toStatus === 'approved' || toStatus === 'rejected' || toStatus === 'cancelled') && claim?.submitted_by) {
    recipients.push(claim.submitted_by);
  }

  return Array.from(new Set(recipients)); // Remove duplicates
}

// ─── Main Handler ────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse<TransitionResponse>> {
  try {
    // createServerSupabaseFromRequest() checks Authorization: Bearer header first,
    // then falls back to cookies — fixes the re-login bug for browser fetch() callers.
    const supabase = await createServerSupabaseFromRequest(request);

    // Step 1: Authenticate user
    const { data: { user }, error: authErr } = await supabase.auth.getUser();

    if (authErr || !user) {
      return errorResponse('يجب تسجيل الدخول أولاً', 401);
    }

    // Step 2: Parse request
    const body: TransitionRequest = await request.json();
    const { claimId, action, returnReason, rejectionReason, notes } = body;
    const bodyActorId = body.actorId; // may be undefined — validated below

    if (!claimId || !action) {
      return errorResponse('معاملات مطلوبة: claimId, action', 400);
    }

    // SECURITY: If caller supplied an actorId, it MUST match the session user.
    // This closes the impersonation vector where an attacker passes another user's
    // UUID to claim their role.
    if (bodyActorId && bodyActorId !== user.id) {
      return errorResponse(
        'actorId لا يتطابق مع المستخدم المصادَق عليه — يُمنع انتحال الهوية',
        403,
      );
    }

    // The effective actor is always the verified session user — never the request body value.
    const actorId = user.id;

    // Step 2b: Fetch claim first (need contract_id for scoped checks)
    const { data: claim, error: claimErr } = await supabase
      .from('claims')
      .select('id, status, claim_no, contract_id, total_amount')
      .eq('id', claimId)
      .single();

    if (claimErr || !claim) {
      return errorResponse('لم يتم العثور على المطالبة', 404);
    }

    // Validate claim is not already finalized
    if (claim.status === 'approved' || claim.status === 'rejected' || claim.status === 'cancelled') {
      return errorResponse('لا يمكن تعديل مطالبة معتمدة أو مرفوضة أو ملغاة', 400);
    }

    // Step 3: Get user profile
    const adminClient = createAdminSupabase();
    const { data: profile } = await adminClient
      .from('profiles')
      .select('id, role')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile) {
      return errorResponse('لم يتم العثور على ملف المستخدم', 404);
    }

    const userRole = profile.role as UserRole;

    // Step 4: Contract-scoped role resolution (Sprint B: dual-read)
    const { role: contractRole, source: roleSource } = await resolveContractRole(
      adminClient, actorId, claim.contract_id, userRole,
    );

    console.debug(
      `[claims/transition] user=${actorId} contract=${claim.contract_id} ` +
      `action=${action} status=${claim.status} ` +
      `contractRole=${contractRole} source=${roleSource}`,
    );

    // Step 4b: Contract scope enforcement (dual-read)
    // Even global roles go through assertContractScope for audit trail consistency.
    if (!isGlobalRole(userRole)) {
      try {
        await assertContractScope(adminClient, actorId, userRole, claim.contract_id);
      } catch (e) {
        if (e instanceof ScopeError) return errorResponse(e.payload.error, 403);
        throw e;
      }
    }

    // Step 5: Validate transition
    // Sprint B: Use contract-scoped role when available, fall back to global role
    // Migration 040: Check contract_approvers for final approval stage
    let allowed: boolean;
    let toStatus: ClaimStatus | undefined;
    let transitionErr: string | undefined;

    // Special handling for pending_director_approval stage — check contract_approvers
    if (claim.status === 'pending_director_approval' && ['approve', 'reject', 'return'].includes(action)) {
      // Director always has access (platform owner)
      if (userRole === 'director') {
        const result = isTransitionAllowed(claim.status, action, 'director');
        allowed = result.allowed;
        toStatus = result.toStatus;
        transitionErr = result.error;
      } else if (userRole === 'final_approver') {
        // Profile-level final_approver — still must be designated on this contract
        const { count: approverCount } = await adminClient
          .from('contract_approvers')
          .select('id', { count: 'exact', head: true })
          .eq('contract_id', claim.contract_id)
          .eq('user_id', actorId)
          .eq('approval_scope', 'final_approver')
          .eq('is_active', true);

        if ((approverCount ?? 0) > 0) {
          // User is a designated final approver — allow final approval actions
          const result = isTransitionAllowed(claim.status, action, 'final_approver');
          allowed = result.allowed;
          toStatus = result.toStatus;
          transitionErr = result.error;
        } else {
          allowed = false;
          transitionErr = 'أنت معتمد نهائي لكن غير معيّن على هذا العقد — تواصل مع مدير الإدارة';
        }
      } else {
        // Other roles: check if they have contract_approvers entry (legacy support)
        const { count: approverCount } = await adminClient
          .from('contract_approvers')
          .select('id', { count: 'exact', head: true })
          .eq('contract_id', claim.contract_id)
          .eq('user_id', actorId)
          .eq('approval_scope', 'final_approver')
          .eq('is_active', true);

        if ((approverCount ?? 0) > 0) {
          const result = isTransitionAllowed(claim.status, action, 'director');
          allowed = result.allowed;
          toStatus = result.toStatus;
          transitionErr = result.error;
        } else {
          allowed = false;
          transitionErr = 'ليس لديك صلاحية الاعتماد النهائي على هذا العقد — تواصل مع مدير الإدارة';
        }
      }
    } else if (contractRole && roleSource !== 'global_role') {
      // Use contract-scoped role for transition check.
      // Phase 2.6 (commit #7): quality / project_manager are routed
      // via the local bridge — workflow-engine's resolver still
      // returns null for them (untouched in this commit).
      const workflowRole = resolveActorWorkflowRole(contractRole);
      if (!workflowRole) {
        return errorResponse(`الدور "${contractRole}" لا يملك صلاحيات تنفيذ إجراءات سير العمل`, 403);
      }
      const result = isTransitionAllowed(claim.status, action, workflowRole);
      allowed = result.allowed;
      toStatus = result.toStatus;
      transitionErr = result.error;
    } else {
      // Global role or no contract role — use legacy global role check
      // Apply legacy mapping: consultant → supervisor, admin → auditor
      const LEGACY_MAP: Partial<Record<UserRole, UserRole>> = {
        consultant: 'supervisor',
        admin: 'auditor',
      };
      const effectiveRole = LEGACY_MAP[userRole] || userRole;
      const result = isTransitionAllowed(claim.status, action, effectiveRole);
      allowed = result.allowed;
      toStatus = result.toStatus;
      transitionErr = result.error;
    }

    if (!allowed || !toStatus) {
      return errorResponse(transitionErr || 'انتقال غير صالح', 403);
    }

    // ════════════════════════════════════════════════════════════════
    // Step 5c — Phase 2.6: flexible-return server-side validation
    // ════════════════════════════════════════════════════════════════
    //
    // For action='return', the server enforces TWO rules independently
    // of any frontend validation:
    //
    //   1. The return reason MUST be ≥ 20 trimmed characters
    //      (matches TransitionDef.minNoteLength=20 in CLAIM_TRANSITIONS).
    //
    //   2. If the client supplies `to_status` in the body, that value
    //      MUST appear in the allow-list returned by
    //      getReturnTargets(currentStatus, workflowRole). The allow-list
    //      is the authoritative source of which earlier stages a
    //      reviewer may pick (see lib/workflow-engine.ts §3d table).
    //
    // Threat model: an attacker controlling the client could otherwise
    // submit `to_status: 'approved'` or jump the claim to an arbitrary
    // earlier stage. Both rules MUST be enforced server-side, never
    // delegated to the UI.
    //
    // Failure responses use HTTP 422 (Unprocessable Entity) so callers
    // can distinguish business-rule violations from auth (401/403),
    // missing claim (404), or generic bad input (400).
    if (action === 'return') {
      // 5c-i: enforce note minimum (server-side, not UI-only)
      const noteText = (returnReason ?? notes ?? '').trim();
      if (noteText.length < 20) {
        return errorResponse(
          'سبب الإرجاع إلزامي ولا يقل عن ٢٠ حرفًا',
          422,
        );
      }

      // 5c-ii: resolve the actor's WorkflowRole for the allow-list query.
      // Falls back to the legacy alias (consultant→supervisor, admin→auditor)
      // when no contract role is held — mirrors the dispatch logic above.
      let actorWorkflowRole: WorkflowRole | null = null;
      if (contractRole && roleSource !== 'global_role') {
        actorWorkflowRole = resolveActorWorkflowRole(contractRole);
      } else {
        const LEGACY_MAP: Partial<Record<UserRole, UserRole>> = {
          consultant: 'supervisor',
          admin: 'auditor',
        };
        actorWorkflowRole = (LEGACY_MAP[userRole] || userRole) as WorkflowRole;
      }

      if (!actorWorkflowRole) {
        return errorResponse(
          'تعذّر تحديد دور المستخدم لإجراء الإرجاع',
          403,
        );
      }

      // 5c-iii: build allow-list of permitted return targets.
      const allowedTargets = getReturnTargets(claim.status, actorWorkflowRole);
      if (allowedTargets.length === 0) {
        return errorResponse(
          'لا توجد أهداف إرجاع متاحة لدورك في هذه المرحلة',
          422,
        );
      }

      // 5c-iv: validate / pick the destination.
      // body.to_status is ClaimStatus | undefined per the interface;
      // null isn't in the type but defend against malformed JSON.
      const requestedTarget: ClaimStatus | null | undefined = body.to_status;
      if (requestedTarget) {
        const isAllowed = allowedTargets.some((t) => t.toStatus === requestedTarget);
        if (!isAllowed) {
          console.warn(
            `[claims/transition] flexible-return REJECTED: actor=${actorId} ` +
            `from=${claim.status} role=${actorWorkflowRole} ` +
            `requested=${requestedTarget} allowed=[${allowedTargets.map((t) => t.toStatus).join(',')}]`,
          );
          return errorResponse(
            'لا يمكن الإرجاع إلى المرحلة المحددة',
            422,
          );
        }
        // Override the default toStatus (from TransitionDef) with the
        // validated picked target. Subsequent steps (UPDATE, audit log,
        // notifications) operate on this final value.
        toStatus = requestedTarget;
      } else {
        // No picked target → use the contractor-bound default
        // (allowedTargets[0] is the contractor target by convention in
        // workflow-engine's CLAIM_TRANSITIONS).
        toStatus = allowedTargets[0].toStatus;
      }
    }

    // Step 5b: For resubmit actions that route to supervisor, verify supervisor exists
    if (action === 'resubmit' && toStatus === 'under_supervisor_review') {
      const { data: supervisors, error: supErr } = await adminClient
        .from('user_contract_roles')
        .select('user_id')
        .eq('contract_id', claim.contract_id)
        .eq('contract_role', 'supervisor')
        .eq('is_active', true);

      if (supErr) {
        console.error('Supervisor check error on resubmit:', supErr);
        return errorResponse('خطأ في التحقق من تعيينات جهة الإشراف', 500);
      }

      if (!supervisors || supervisors.length === 0) {
        return errorResponse(
          'لا يمكن إعادة تقديم المطالبة: لم يتم تعيين جهة إشراف نشطة على هذا العقد. يرجى التواصل مع مدير الإدارة.',
          400,
        );
      }
    }

    // Step 6: Validate mandatory fields for specific actions
    if ((action === 'return' || action.includes('return')) && !returnReason) {
      return errorResponse('يجب تقديم سبب الإرجاع', 400);
    }

    if (action === 'reject' && !rejectionReason) {
      return errorResponse('يجب تقديم سبب الرفض', 400);
    }

    // Step 7: For approve action, check contract limit
    if (action === 'approve') {
      const { withinLimit, reason } = await checkContractLimit(supabase, claimId);
      if (!withinLimit) {
        return errorResponse(reason || 'المطالبة تتجاوز حدود العقد', 400);
      }
    }

    // Step 7b: Certificate gate — supervisor MUST upload completion certificate before approve
    if (action === 'approve' && claim.status === 'under_supervisor_review') {
      const { data: certCheck } = await adminClient
        .from('claims')
        .select('has_completion_certificate')
        .eq('id', claimId)
        .single();

      if (!certCheck?.has_completion_certificate) {
        return errorResponse(
          'يجب رفع شهادة الإنجاز قبل الموافقة على المطالبة — استخدم /api/claims/upload-certificate أولاً',
          400,
        );
      }
    }

    // Step 8: Execute transition
    const now = new Date().toISOString();
    const updateData: Record<string, unknown> = {
      status: toStatus,
      updated_at: now,
      last_transition_at: now,   // Sprint E.1.5: dedicated SLA timestamp
    };

    if (action === 'approve') {
      updateData.approved_by = actorId;
      updateData.approved_at = now;
    }

    if (action === 'withdraw') {
      // Contractor withdrawing claim back to draft — clear submission metadata
      updateData.submitted_by = null;
      updateData.submitted_at = null;
      updateData.return_reason = null;
    }

    if (action === 'cancel') {
      // Contractor cancelling claim permanently — clear submission metadata
      updateData.submitted_by = null;
      updateData.submitted_at = null;
      updateData.return_reason = null;
    }

    if (action === 'return' || action.includes('return')) {
      updateData.return_reason = returnReason;
      // When returned, go back to draft for contractor to resubmit
      // Actually, keep as returned_by_X status per requirements
    }

    if (action === 'reject') {
      updateData.rejection_reason = rejectionReason;
    }

    const { error: updateErr } = await supabase
      .from('claims')
      .update(updateData)
      .eq('id', claimId);

    if (updateErr) {
      console.error('Claim update error:', updateErr);
      return errorResponse('فشل في تحديث حالة المطالبة', 500);
    }

    // Step 9: Create workflow audit entry
    const { data: workflow, error: workflowErr } = await supabase
      .from('claim_workflow')
      .insert({
        claim_id: claimId,
        action,
        from_status: claim.status,
        to_status: toStatus,
        actor_id: actorId,
        notes: notes || returnReason || rejectionReason || null,
      })
      .select()
      .single();

    if (workflowErr) {
      console.warn('Workflow entry error:', workflowErr);
    }

    // Step 10: Create audit log
    const { error: auditErr } = await supabase
      .from('audit_logs')
      .insert({
        table_name: 'claims',
        record_id: claimId,
        action: 'update',
        actor_id: actorId,
        actor_role: userRole,
        from_status: claim.status,
        to_status: toStatus,
        old_data: { status: claim.status },
        new_data: { ...updateData },
        ip_address: request.headers.get('x-forwarded-for') || 'unknown',
      });

    if (auditErr) {
      console.warn('Audit log error:', auditErr);
    }

    // Step 10b: For resubmit → supervisor, add system routing audit entry
    // Uses 'forward' action (valid in claim_workflow_action_check constraint)
    if (action === 'resubmit' && toStatus === 'under_supervisor_review') {
      const { error: routeLogErr } = await adminClient
        .from('claim_workflow')
        .insert({
          claim_id: claimId,
          action: 'forward',
          from_status: toStatus, // Already at under_supervisor_review
          to_status: toStatus,
          actor_id: actorId,
          notes: 'إعادة توجيه تلقائي لجهة الإشراف بعد إعادة التقديم — بناءً على الدور المعيّن على العقد',
        });
      if (routeLogErr) console.warn('Resubmit route log error:', routeLogErr.message);
    }

    // Step 11: Notify relevant parties via notification-engine
    // First, resolve recipients from the new status
    const recipientIds = await getNotificationRecipients(
      adminClient,
      claimId,
      toStatus,
      claim.status,
    );

    // Then, use notification-engine to generate action-validated payloads
    const notificationEvent = resolveNotificationEvent(action, claim.status, toStatus);

    let notificationPayloads: { userId: string; type: string; title_ar: string; body_ar: string; entityId: string }[] = [];

    if (notificationEvent) {
      // Fetch recipient profiles for action-engine context
      const { data: recipientProfiles } = await adminClient
        .from('profiles')
        .select('id, role')
        .in('id', recipientIds);

      // Fetch actor name
      const { data: actorProfile } = await adminClient
        .from('profiles')
        .select('full_name_ar, full_name')
        .eq('id', actorId)
        .maybeSingle();
      const actorName = actorProfile?.full_name_ar || actorProfile?.full_name || 'مستخدم';

      // Fetch claim documents for action validation
      const { data: claimDocs } = await adminClient
        .from('documents')
        .select('type')
        .eq('claim_id', claimId);

      // Fetch contract-roles for each recipient
      const { data: recipientRoles } = await adminClient
        .from('user_contract_roles')
        .select('user_id, contract_role')
        .eq('contract_id', claim.contract_id)
        .eq('is_active', true)
        .in('user_id', recipientIds);

      const rolesByUser = new Map<string, string>();
      for (const r of recipientRoles ?? []) {
        rolesByUser.set(r.user_id, r.contract_role);
      }

      // Build recipient contexts
      const recipientContexts: RecipientContext[] = (recipientProfiles ?? []).map(p => ({
        userId: p.id,
        globalRole: p.role as UserRole,
        contractRole: (rolesByUser.get(p.id) as import('@/lib/types').ContractRole) || null,
        isGlobalRole: p.role === 'director',
      }));

      // Fetch claim details for context
      const { data: fullClaim } = await adminClient
        .from('claims')
        .select('id, claim_no, contract_id, status, submitted_by, return_reason')
        .eq('id', claimId)
        .single();

      const { data: ct } = await adminClient
        .from('contracts')
        .select('contract_no, title_ar')
        .eq('id', claim.contract_id)
        .maybeSingle();

      const claimCtx: NotificationClaimContext = {
        id: claimId,
        claim_no: fullClaim?.claim_no ?? '',
        contract_id: claim.contract_id,
        contract_no: ct?.contract_no,
        contract_title_ar: ct?.title_ar,
        status: toStatus,
        submitted_by: fullClaim?.submitted_by || null,
        return_reason: returnReason || rejectionReason || null,
      };

      notificationPayloads = getNotificationsForClaimEvent({
        event: notificationEvent,
        claim: claimCtx,
        actorId,
        actorName,
        fromStatus: claim.status,
        toStatus,
        recipients: recipientContexts,
        documents: (claimDocs ?? []).map(d => ({ type: d.type || 'other' })),
      });

      // Persist notifications in DB
      if (notificationPayloads.length > 0) {
        const rows = notificationPayloads.map(p => ({
          user_id: p.userId,
          type: p.type,
          title: p.title_ar,
          body: p.body_ar,
          entity_type: 'claim',
          entity_id: claimId,
          is_read: false,
        }));
        const { error: notifErr } = await adminClient.from('notifications').insert(rows);
        if (notifErr) console.warn('Notification insert error:', notifErr.message);
      }
    }

    console.log(`Claim ${claimId} transitioned to ${toStatus}, sent ${notificationPayloads.length} action-validated notifications`);

    // Step 12: If approved, generate certificates (future)
    // if (toStatus === 'approved') {
    //   await generateCompletionCertificate(claimId, actorId);
    //   await generateReviewForm(claimId, actorId);
    // }

    // Fetch updated claim
    const { data: updatedClaim } = await supabase
      .from('claims')
      .select('*')
      .eq('id', claimId)
      .single();

    return successResponse({
      claim: updatedClaim,
      workflow: workflow || {},
      notifications: recipientIds,
    });
  } catch (error) {
    console.error('[API] Claims transition error:', error);
    const message = error instanceof Error ? error.message : 'حدث خطأ في الخادم';
    return errorResponse(message, 500);
  }
}
