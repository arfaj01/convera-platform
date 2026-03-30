/**
 * POST /api/claims/submit
 * Atomic claim submission endpoint (v2 — production hardened)
 *
 * Validates (API-level, before DB call):
 *   1. User is authenticated and is the claim's contractor
 *   2. Invoice document exists and is attached
 *   3. Technical report document exists and is attached
 *   4. No period overlap with existing approved claims
 *   5. Active supervisor exists on the contract
 *
 * Then calls submit_claim_atomic() — a single PostgreSQL transaction:
 *   draft → under_supervisor_review (atomic, no intermediate "submitted" visible)
 *   + TWO workflow audit entries (draft→submitted, submitted→under_supervisor_review)
 *   + audit_logs entry
 *
 * v2 CHANGES:
 *   - DB function uses RAISE EXCEPTION (not JSON error returns)
 *   - API uses try/catch on RPC call to map exceptions → HTTP codes
 *   - No recovery logic in submit path (draft only; stuck claims use recovery script)
 *   - Idempotency preserved: ALREADY_ROUTED returns success JSONB (not exception)
 */

import { createServerSupabaseFromRequest, createAdminSupabase } from '@/lib/supabase-server';
import { NextRequest, NextResponse } from 'next/server';
import type { Claim, ClaimStatus, UserRole, ContractRole } from '@/lib/types';
import { assertContractScope, ScopeError } from '@/lib/contract-scope';
import { resolveContractRole } from '@/lib/contract-permissions';
import {
  resolveNotificationEvent,
  getNotificationsForClaimEvent,
  getTargetRolesForStatus,
  type RecipientContext,
  type NotificationClaimContext,
} from '@/lib/notification-engine';

interface SubmitClaimRequest {
  claimId: string;
}

interface SubmitClaimResponse {
  data?: {
    claim: Claim;
    workflowEntry: Record<string, unknown>;
  };
  error?: string;
  error_code?: string;
}

// ─── Error Helper ────────────────────────────────────────────────

function errorResponse(
  message: string,
  status: number = 400,
  errorCode?: string,
): NextResponse<SubmitClaimResponse> {
  return NextResponse.json({ error: message, error_code: errorCode }, { status });
}

function successResponse(data: SubmitClaimResponse['data']): NextResponse<SubmitClaimResponse> {
  return NextResponse.json({ data }, { status: 200 });
}

// ─── RPC Exception → HTTP Status Mapping ─────────────────────────
// submit_claim_atomic() now uses RAISE EXCEPTION with error codes.
// Supabase RPC surfaces these as { error: { message: 'CLAIM_NOT_FOUND', ... } }

function mapRpcExceptionToResponse(errorMessage: string): NextResponse<SubmitClaimResponse> {
  // Extract error code from the exception message
  // Format from RAISE EXCEPTION: "CLAIM_NOT_FOUND" or "INVALID_STATUS: draft"
  const msg = errorMessage || '';

  if (msg.includes('CLAIM_NOT_FOUND')) {
    return errorResponse('لم يتم العثور على المطالبة', 404, 'CLAIM_NOT_FOUND');
  }
  if (msg.includes('INVALID_STATUS')) {
    return errorResponse('يمكن تقديم المطالبة فقط من حالة المسودة', 409, 'INVALID_STATUS');
  }
  if (msg.includes('NO_ACTIVE_SUPERVISOR')) {
    return errorResponse(
      'لا يمكن تقديم المطالبة: لم يتم تعيين جهة إشراف نشطة على هذا العقد',
      422,
      'NO_ACTIVE_SUPERVISOR',
    );
  }
  if (msg.includes('CLAIM_IMMUTABLE')) {
    return errorResponse('لا يمكن تعديل مطالبة في حالة نهائية', 409, 'CLAIM_IMMUTABLE');
  }
  if (msg.includes('CLAIM_TRANSITION_DENIED')) {
    return errorResponse('هذا الانتقال غير مسموح به', 403, 'TRANSITION_DENIED');
  }

  // Unknown DB error — log full message, return generic to client
  console.error('[claims/submit] Unhandled DB exception:', msg);
  return errorResponse('خطأ في تنفيذ عملية التقديم', 500, 'INTERNAL_ERROR');
}

// ─── Main Handler ────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse<SubmitClaimResponse>> {
  try {
    // ══════════════════════════════════════════════════════════════
    // PHASE 1: Authentication & Authorization
    // ══════════════════════════════════════════════════════════════

    const supabase = await createServerSupabaseFromRequest(request);
    const { data: { user }, error: authErr } = await supabase.auth.getUser();

    if (authErr || !user) {
      return errorResponse('يجب تسجيل الدخول أولاً', 401, 'UNAUTHENTICATED');
    }

    const body: SubmitClaimRequest = await request.json();
    const { claimId } = body;

    if (!claimId) {
      return errorResponse('رقم المطالبة مطلوب', 400, 'MISSING_CLAIM_ID');
    }

    // Fetch claim (need contract_id for role check)
    const { data: claim, error: claimErr } = await supabase
      .from('claims')
      .select('id, status, contract_id, claim_no, period_from, period_to')
      .eq('id', claimId)
      .single();

    if (claimErr || !claim) {
      return errorResponse('لم يتم العثور على المطالبة', 404, 'CLAIM_NOT_FOUND');
    }

    // Early status check — only draft claims can be submitted
    // (The DB function enforces this too, but we fail fast here)
    if (claim.status !== 'draft') {
      return errorResponse('يمكن تقديم المطالبة فقط من حالة المسودة', 409, 'INVALID_STATUS');
    }

    const adminClient = createAdminSupabase();

    // Verify user is a contractor on this contract (dual-read)
    const { data: userProfile } = await adminClient
      .from('profiles')
      .select('id, role')
      .eq('id', user.id)
      .maybeSingle();

    if (!userProfile) {
      return errorResponse('لم يتم العثور على ملف المستخدم', 404, 'USER_NOT_FOUND');
    }

    const { role: contractRole, source: roleSource } = await resolveContractRole(
      adminClient, user.id, claim.contract_id, userProfile.role,
    );

    console.debug(
      `[claims/submit] user=${user.id} contract=${claim.contract_id} ` +
      `contractRole=${contractRole} source=${roleSource}`,
    );

    // Only contractors can submit claims
    if (contractRole !== 'contractor' && roleSource !== 'global_role') {
      return errorResponse('فقط المقاولون يمكنهم تقديم المطالبات', 403, 'FORBIDDEN');
    }

    // Contract scope enforcement (belt-and-suspenders)
    try {
      await assertContractScope(adminClient, user.id, userProfile.role, claim.contract_id);
    } catch (e) {
      if (e instanceof ScopeError) return errorResponse(e.payload.error, 403, 'SCOPE_DENIED');
      throw e;
    }

    // ══════════════════════════════════════════════════════════════
    // PHASE 2: Pre-submission Validation (Rule G1)
    // ══════════════════════════════════════════════════════════════

    const { count: invoiceCount, error: invoiceErr } = await supabase
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('claim_id', claimId)
      .eq('type', 'invoice');

    if (invoiceErr) {
      console.error('Invoice check error:', invoiceErr);
      return errorResponse('خطأ في التحقق من المستندات', 500, 'INTERNAL_ERROR');
    }

    const { count: reportCount, error: reportErr } = await supabase
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('claim_id', claimId)
      .eq('type', 'report');

    if (reportErr) {
      console.error('Report check error:', reportErr);
      return errorResponse('خطأ في التحقق من المستندات', 500, 'INTERNAL_ERROR');
    }

    if (!invoiceCount || invoiceCount === 0) {
      return errorResponse('يجب إرفاق الفاتورة قبل تقديم المطالبة', 400, 'MISSING_INVOICE');
    }

    if (!reportCount || reportCount === 0) {
      return errorResponse('يجب إرفاق التقرير الفني قبل تقديم المطالبة', 400, 'MISSING_REPORT');
    }

    // Verify active supervisor exists
    const { data: supervisors, error: supervisorErr } = await adminClient
      .from('user_contract_roles')
      .select('user_id')
      .eq('contract_id', claim.contract_id)
      .eq('contract_role', 'supervisor')
      .eq('is_active', true);

    if (supervisorErr) {
      console.error('Supervisor check error:', supervisorErr);
      return errorResponse('خطأ في التحقق من تعيينات جهة الإشراف', 500, 'INTERNAL_ERROR');
    }

    if (!supervisors || supervisors.length === 0) {
      return errorResponse(
        'لا يمكن تقديم المطالبة: لم يتم تعيين جهة إشراف نشطة على هذا العقد. يرجى التواصل مع مدير الإدارة لتعيين جهة الإشراف أولاً.',
        422,
        'NO_ACTIVE_SUPERVISOR',
      );
    }

    // Validate no period overlap with approved claims
    if (claim.period_from && claim.period_to) {
      const { data: overlappingClaims, error: overlapErr } = await supabase
        .from('claims')
        .select('id, status, period_from, period_to')
        .eq('contract_id', claim.contract_id)
        .neq('id', claimId)
        .in('status', ['approved'])
        .lte('period_from', claim.period_to)
        .gte('period_to', claim.period_from);

      if (overlapErr) {
        console.error('Overlap check error:', overlapErr);
      }

      if (overlappingClaims && overlappingClaims.length > 0) {
        return errorResponse(
          'المطالبة تتداخل مع فترة مطالبة معتمدة سابقة. يرجى تعديل فترة المطالبة',
          400,
          'PERIOD_OVERLAP',
        );
      }
    }

    // ── PHASE 2b: BOQ Progress Ceiling Validation ──────────────────
    // Rule 2: BOQ progress cannot exceed contractual quantity
    // Also validates percentage model: curr_progress must be 0–100

    const { data: boqItems, error: boqItemsErr } = await adminClient
      .from('claim_boq_items')
      .select('id, template_item_id, curr_progress, contractual_qty, unit_price')
      .eq('claim_id', claimId);

    if (!boqItemsErr && boqItems && boqItems.length > 0) {
      // Fetch contract progress model
      const { data: contract } = await adminClient
        .from('contracts')
        .select('boq_progress_model')
        .eq('id', claim.contract_id)
        .single();

      const progressModel = contract?.boq_progress_model || 'count';

      // Check percentage model: curr_progress must be 0–100
      if (progressModel === 'percentage') {
        for (const item of boqItems) {
          if (item.curr_progress < 0 || item.curr_progress > 100) {
            return errorResponse(
              `نسبة الإنجاز لبند رقم ${item.id} يجب أن تكون بين 0 و 100% (القيمة الحالية: ${item.curr_progress}%)`,
              400,
              'BOQ_PROGRESS_EXCEEDS_LIMIT',
            );
          }
        }
      }

      // Check count model: cumulative must not exceed contractual_qty
      if (progressModel === 'count') {
        const { checkBoqProgressCeiling } = await import('@/lib/financial-guard');
        const guardResult = await checkBoqProgressCeiling(
          adminClient,
          claim.contract_id,
          claimId,
          boqItems.map(item => ({
            template_item_id: item.template_item_id,
            curr_progress: item.curr_progress,
            contractual_qty: item.contractual_qty,
            progress_model: progressModel,
          })),
        );

        if (!guardResult.ok) {
          return errorResponse(
            guardResult.error || 'الكميات التراكمية تتجاوز الكميات التعاقدية',
            400,
            'BOQ_PROGRESS_EXCEEDS_LIMIT',
          );
        }
      }
    }

    // ══════════════════════════════════════════════════════════════
    // PHASE 3: Atomic Submission (single DB transaction)
    //
    // submit_claim_atomic() uses RAISE EXCEPTION for all errors.
    // On failure: Supabase RPC returns { data: null, error: {...} }
    // On success: Returns JSONB with success=true
    // Idempotency: Returns JSONB with message=ALREADY_ROUTED (not exception)
    // ══════════════════════════════════════════════════════════════

    console.log(`[claims/submit] Calling submit_claim_atomic(${claimId}, ${user.id})`);

    const { data: rpcResult, error: rpcErr } = await adminClient.rpc('submit_claim_atomic', {
      p_claim_id: claimId,
      p_actor_id: user.id,
      p_notes: `تقديم المطالبة رقم ${claim.claim_no} — تم التحقق من الوثائق المطلوبة`,
    });

    // ── Handle RPC exception (RAISE EXCEPTION from DB function) ──
    if (rpcErr) {
      console.error('[claims/submit] RPC exception:', rpcErr.message);
      return mapRpcExceptionToResponse(rpcErr.message);
    }

    // ── Parse successful result ──
    const result = typeof rpcResult === 'string' ? JSON.parse(rpcResult) : rpcResult;

    const isIdempotent = result?.message === 'ALREADY_ROUTED';
    console.log(
      `[claims/submit] ATOMIC SUCCESS: claim=${claimId} → ${result?.status}` +
      (isIdempotent ? ' (idempotent — was already routed)' : ''),
    );

    // ══════════════════════════════════════════════════════════════
    // PHASE 4: Post-submission (notifications — non-critical)
    // ══════════════════════════════════════════════════════════════

    if (!isIdempotent) {
      try {
        const notificationEvent = resolveNotificationEvent(
          'submit',
          'draft' as ClaimStatus,
          'under_supervisor_review' as ClaimStatus,
        );

        if (notificationEvent) {
          const targets = getTargetRolesForStatus('under_supervisor_review' as ClaimStatus);
          const supervisorIds = supervisors.map((s: { user_id: string }) => s.user_id);
          const recipientIds = [...supervisorIds];

          if (targets.notifySubmitter && user.id && !recipientIds.includes(user.id)) {
            recipientIds.push(user.id);
          }

          if (targets.globalRoles.length > 0) {
            const { data: globalUsers } = await adminClient
              .from('profiles')
              .select('id')
              .in('role', targets.globalRoles);
            for (const gu of globalUsers ?? []) {
              if (!recipientIds.includes(gu.id)) recipientIds.push(gu.id);
            }
          }

          if (recipientIds.length > 0) {
            const { data: recipientProfiles } = await adminClient
              .from('profiles')
              .select('id, role')
              .in('id', recipientIds);

            const { data: actorProfile } = await adminClient
              .from('profiles')
              .select('full_name_ar, full_name')
              .eq('id', user.id)
              .maybeSingle();
            const actorName = actorProfile?.full_name_ar || actorProfile?.full_name || 'مستخدم';

            const { data: claimDocs } = await adminClient
              .from('documents')
              .select('type')
              .eq('claim_id', claimId);

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

            const recipientContexts: RecipientContext[] = (recipientProfiles ?? []).map(p => ({
              userId: p.id,
              globalRole: p.role as UserRole,
              contractRole: (rolesByUser.get(p.id) as ContractRole) || null,
              isGlobalRole: p.role === 'director',
            }));

            const { data: ct } = await adminClient
              .from('contracts')
              .select('contract_no, title_ar')
              .eq('id', claim.contract_id)
              .maybeSingle();

            const claimCtx: NotificationClaimContext = {
              id: claimId,
              claim_no: claim.claim_no,
              contract_id: claim.contract_id,
              contract_no: ct?.contract_no,
              contract_title_ar: ct?.title_ar,
              status: 'under_supervisor_review' as ClaimStatus,
              submitted_by: user.id,
            };

            const notificationPayloads = getNotificationsForClaimEvent({
              event: notificationEvent,
              claim: claimCtx,
              actorId: user.id,
              actorName,
              fromStatus: 'draft' as ClaimStatus,
              toStatus: 'under_supervisor_review' as ClaimStatus,
              recipients: recipientContexts,
              documents: (claimDocs ?? []).map(d => ({ type: d.type || 'other' })),
            });

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

            console.log(
              `Claim ${claimId} submitted → auto-routed to supervisor review. ` +
              `Sent ${notificationPayloads.length} action-validated notifications ` +
              `(${supervisorIds.length} supervisors on contract)`,
            );
          }
        }
      } catch (notifError) {
        // Notifications are non-critical — claim is already submitted
        console.warn('[claims/submit] Notification error (non-critical):', notifError);
      }
    }

    // ══════════════════════════════════════════════════════════════
    // PHASE 5: Return success
    // ══════════════════════════════════════════════════════════════

    const { data: updatedClaim } = await supabase
      .from('claims')
      .select('*')
      .eq('id', claimId)
      .single();

    return successResponse({
      claim: updatedClaim,
      workflowEntry: {},
    });
  } catch (error) {
    console.error('[API] Claims submit error:', error);
    const message = error instanceof Error ? error.message : 'حدث خطأ في الخادم';
    return errorResponse(message, 500, 'INTERNAL_ERROR');
  }
}
