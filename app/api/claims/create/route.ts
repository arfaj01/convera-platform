/**
 * POST /api/claims/create
 *
 * Phase 2.6 / Commit 3 — server-issued claim_number + open-claim
 * guard + server-truth previous quantities.
 *
 * Replaces the previous browser-side direct INSERT into `claims`. The
 * route:
 *   1. Authenticates the caller via JWT (Authorization header or cookie).
 *   2. Verifies the caller is the contractor on this contract (or a
 *      global director acting on someone's behalf).
 *   3. Resolves contracts.contract_no → ProjectCode via the explicit
 *      mapping in `lib/claim-number.ts`. Fails 422 with no fallback.
 *   4. Strips any `prev_progress` / `previous_quantity` the client
 *      tried to send — the RPC computes prev_progress from approved
 *      claims as the only source of truth.
 *   5. Calls `create_claim_with_items_atomic` (Migration 048) which
 *      enforces the open-claim guard, validates current_quantity
 *      against the remaining contractual quantity, allocates the
 *      per-contract claim_sequence under pg_advisory_xact_lock,
 *      formats `claim_number`, and inserts the claim + items in a
 *      single transaction.
 *   6. Returns the created claim's identity (id, claim_number,
 *      claim_sequence, claim_kind, status='draft').
 *
 * NOTE: This route only creates the draft. Submission to
 * `under_supervisor_review` continues to flow through the existing
 * /api/claims/submit endpoint — Phase 2.6 workflow is untouched.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseFromRequest, createAdminSupabase } from '@/lib/supabase-server';
import type { ClaimKind, ClaimType, ContractRole } from '@/lib/types';
import { resolveProjectCode } from '@/lib/claim-number';

// ─── Types ────────────────────────────────────────────────────────

/** Shape of one BOQ row coming from the client. The route ignores
 *  any prev_progress field and rebuilds it server-side. */
interface IncomingBoqItem {
  item_no:           string;
  description?:      string | null;
  description_ar?:   string | null;
  unit?:             string | null;
  unit_price?:       number | null;
  contractual_qty?:  number | null;
  curr_progress?:    number | null;
  performance_pct?:  number | null;
  requires_variation?: boolean | null;
  // intentionally NOT typed — we strip these:
  // prev_progress, previous_quantity, cumulative, period_amount, after_perf
}

interface IncomingStaffItem {
  item_no:           string;
  position?:         string | null;
  position_ar?:      string | null;
  monthly_rate?:     number | null;
  contract_months?:  number | null;
  working_days?:     number | null;
  overtime_hours?:   number | null;
  basic_amount?:     number | null;
  extra_amount?:     number | null;
  total_amount?:     number | null;
  performance_pct?:  number | null;
  after_perf?:       number | null;
}

interface CreateClaimRequest {
  contract_id:        string;
  claim_kind:         ClaimKind;
  claim_type:         ClaimType;
  work_period_from:   string;   // YYYY-MM-DD
  work_period_to:     string;   // YYYY-MM-DD
  external_reference?: string | null;
  boq_amount?:        number;
  staff_amount?:      number;
  retention_amount?:  number;
  vat_amount?:        number;
  boq_items?:         IncomingBoqItem[];
  staff_items?:       IncomingStaffItem[];
}

interface CreateClaimResponse {
  data?: {
    id:             string;
    claim_no:       number;
    claim_number:   string;
    claim_sequence: number;
    claim_kind:     ClaimKind;
    status:         'draft';
  };
  error?:      string;
  error_code?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────

function errorResponse(
  message: string,
  status:  number,
  errorCode?: string,
): NextResponse<CreateClaimResponse> {
  return NextResponse.json({ error: message, error_code: errorCode }, { status });
}

function successResponse(data: CreateClaimResponse['data']): NextResponse<CreateClaimResponse> {
  return NextResponse.json({ data }, { status: 200 });
}

/**
 * Sanitise BOQ rows: drop any client-supplied prev_progress /
 * previous_quantity / cumulative — those are server-truth only.
 */
function sanitiseBoqItems(rows: IncomingBoqItem[] | undefined): IncomingBoqItem[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({
    item_no:            String(r.item_no ?? '').trim(),
    description:        r.description ?? null,
    description_ar:     r.description_ar ?? null,
    unit:               r.unit ?? null,
    unit_price:         Number(r.unit_price ?? 0),
    contractual_qty:    Number(r.contractual_qty ?? 0),
    curr_progress:      Number(r.curr_progress ?? 0),
    performance_pct:    Number(r.performance_pct ?? 100),
    requires_variation: Boolean(r.requires_variation ?? false),
  })).filter((r) => r.item_no.length > 0);
}

function sanitiseStaffItems(rows: IncomingStaffItem[] | undefined): IncomingStaffItem[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({
    item_no:          String(r.item_no ?? '').trim(),
    position:         r.position ?? null,
    position_ar:      r.position_ar ?? null,
    monthly_rate:     Number(r.monthly_rate ?? 0),
    contract_months:  Number(r.contract_months ?? 0),
    working_days:     Number(r.working_days ?? 0),
    overtime_hours:   Number(r.overtime_hours ?? 0),
    basic_amount:     Number(r.basic_amount ?? 0),
    extra_amount:     Number(r.extra_amount ?? 0),
    total_amount:     Number(r.total_amount ?? 0),
    performance_pct:  Number(r.performance_pct ?? 100),
    after_perf:       Number(r.after_perf ?? 0),
  })).filter((r) => r.item_no.length > 0);
}

/**
 * Map RPC RAISE EXCEPTION messages to HTTP responses with Arabic copy.
 * Mirrors the pattern used by /api/claims/submit.
 */
function mapRpcExceptionToResponse(rawMessage: string): NextResponse<CreateClaimResponse> {
  const msg = rawMessage || '';

  if (msg.includes('OPEN_CLAIM_EXISTS')) {
    return errorResponse(
      'لا يمكن إنشاء مطالبة جديدة لوجود مطالبة مفتوحة على نفس العقد. يرجى إغلاق المطالبة السابقة (اعتماد أو رفض أو إلغاء) قبل المتابعة.',
      422, 'OPEN_CLAIM_EXISTS',
    );
  }
  if (msg.includes('CONTRACT_NOT_FOUND')) {
    return errorResponse('لم يتم العثور على العقد المحدد.', 404, 'CONTRACT_NOT_FOUND');
  }
  if (msg.includes('CURR_PROGRESS_NEGATIVE')) {
    return errorResponse('الكمية الحالية لا يمكن أن تكون سالبة.', 422, 'CURR_PROGRESS_NEGATIVE');
  }
  if (msg.includes('CURR_PROGRESS_EXCEEDS_REMAINING')) {
    return errorResponse(
      'الكمية الحالية تتجاوز الكمية المتبقية من الكمية التعاقدية. ' +
      'تحقق من القيم وحاول مجدداً.',
      422, 'CURR_PROGRESS_EXCEEDS_REMAINING',
    );
  }
  if (msg.includes('WORK_PERIOD_ORDER')) {
    return errorResponse('تاريخ نهاية فترة التنفيذ يجب أن يكون بعد أو يساوي تاريخ البداية.', 400, 'WORK_PERIOD_ORDER');
  }
  if (msg.includes('WORK_PERIOD_REQUIRED')) {
    return errorResponse('فترة تنفيذ الأعمال (من / إلى) إلزامية.', 400, 'WORK_PERIOD_REQUIRED');
  }
  if (msg.includes('CLAIM_KIND_REQUIRED')) {
    return errorResponse('نوع المطالبة إلزامي.', 400, 'CLAIM_KIND_REQUIRED');
  }
  if (msg.includes('PROJECT_CODE_REQUIRED')) {
    return errorResponse(
      'تعذّر تحديد كود المشروع لهذا العقد — تواصل مع مدير الإدارة قبل المتابعة.',
      422, 'PROJECT_CODE_REQUIRED',
    );
  }
  if (msg.includes('ACTOR_REQUIRED')) {
    return errorResponse('تعذّر تحديد المستخدم.', 401, 'ACTOR_REQUIRED');
  }
  if (msg.includes('CONTRACT_REQUIRED')) {
    return errorResponse('معرّف العقد إلزامي.', 400, 'CONTRACT_REQUIRED');
  }
  // Fallback — surface the raw message with a generic Arabic prefix.
  return errorResponse(`فشل إنشاء المطالبة: ${msg}`, 500, 'UNKNOWN');
}

// ─── Handler ─────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse<CreateClaimResponse>> {
  try {
    // ── 1. Authenticate ──────────────────────────────────────────
    const supabase = await createServerSupabaseFromRequest(request);
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return errorResponse('يجب تسجيل الدخول أولاً.', 401, 'UNAUTHENTICATED');
    }

    // ── 2. Parse + minimal shape validation ──────────────────────
    let body: CreateClaimRequest;
    try {
      body = await request.json();
    } catch {
      return errorResponse('جسم الطلب غير صالح.', 400, 'BAD_JSON');
    }

    const {
      contract_id, claim_kind, claim_type,
      work_period_from, work_period_to, external_reference,
      boq_amount, staff_amount, retention_amount, vat_amount,
    } = body;

    if (!contract_id) {
      return errorResponse('معرّف العقد إلزامي.', 400, 'CONTRACT_REQUIRED');
    }
    if (!claim_kind || !['running_payment','final_payment','advance_payment'].includes(claim_kind)) {
      return errorResponse('نوع المطالبة إلزامي ويجب أن يكون أحد القيم المعتمدة.', 400, 'CLAIM_KIND_REQUIRED');
    }
    if (!claim_type || !['boq_only','staff_only','mixed','supervision'].includes(claim_type)) {
      return errorResponse('تصنيف المطالبة (BOQ / Staff / Mixed) غير صالح.', 400, 'CLAIM_TYPE_INVALID');
    }
    if (!work_period_from || !work_period_to) {
      return errorResponse('فترة تنفيذ الأعمال (من / إلى) إلزامية.', 400, 'WORK_PERIOD_REQUIRED');
    }
    if (work_period_to < work_period_from) {
      return errorResponse('تاريخ نهاية فترة التنفيذ يجب أن يكون بعد أو يساوي تاريخ البداية.', 400, 'WORK_PERIOD_ORDER');
    }

    // ── 3. Verify contract exists + resolve project_code ─────────
    const adminClient = createAdminSupabase();
    const { data: contract, error: contractErr } = await adminClient
      .from('contracts')
      .select('id, contract_no')
      .eq('id', contract_id)
      .maybeSingle();
    if (contractErr || !contract) {
      return errorResponse('لم يتم العثور على العقد المحدد.', 404, 'CONTRACT_NOT_FOUND');
    }

    const projectCode = resolveProjectCode(contract.contract_no);
    if (!projectCode) {
      return errorResponse(
        'تعذّر تحديد كود المشروع لهذا العقد — تواصل مع مدير الإدارة قبل المتابعة.',
        422, 'PROJECT_CODE_REQUIRED',
      );
    }

    // ── 4. Authorise: contractor on this contract OR director ────
    const { data: profile } = await adminClient
      .from('profiles')
      .select('id, role')
      .eq('id', user.id)
      .maybeSingle();
    if (!profile) {
      return errorResponse('لم يتم العثور على ملف المستخدم.', 401, 'NO_PROFILE');
    }

    const isGlobalDirector = profile.role === 'director';

    if (!isGlobalDirector) {
      const { count: contractorCount, error: roleErr } = await adminClient
        .from('user_contract_roles')
        .select('id', { count: 'exact', head: true })
        .eq('contract_id', contract_id)
        .eq('user_id', user.id)
        .eq('contract_role', 'contractor' as ContractRole)
        .eq('is_active', true);
      if (roleErr) {
        console.error('[claims/create] role check error:', roleErr);
        return errorResponse('فشل التحقق من صلاحيات المستخدم.', 500, 'ROLE_CHECK_FAILED');
      }
      if ((contractorCount ?? 0) === 0) {
        return errorResponse(
          'ليس لديك صلاحية إنشاء مطالبة على هذا العقد. الصلاحية مخصصة للمقاول المعيّن على العقد فقط.',
          403, 'NOT_CONTRACTOR',
        );
      }
    }

    // ── 5. Sanitise items: strip any prev_progress sent from client
    const boqItems   = sanitiseBoqItems(body.boq_items);
    const staffItems = sanitiseStaffItems(body.staff_items);

    // ── 6. RPC call (atomic create + items + sequence + number) ──
    const { data: rpcData, error: rpcErr } = await adminClient.rpc(
      'create_claim_with_items_atomic',
      {
        p_contract_id:        contract_id,
        p_claim_kind:         claim_kind,
        p_claim_type:         claim_type,
        p_work_period_from:   work_period_from,
        p_work_period_to:     work_period_to,
        p_external_reference: external_reference ?? null,
        p_actor_id:           user.id,
        p_project_code:       projectCode,
        p_boq_amount:         Number(boq_amount      ?? 0),
        p_staff_amount:       Number(staff_amount    ?? 0),
        p_retention_amount:   Number(retention_amount ?? 0),
        p_vat_amount:         Number(vat_amount      ?? 0),
        p_boq_items:          boqItems,
        p_staff_items:        staffItems,
      },
    );

    if (rpcErr) {
      console.warn('[claims/create] RPC error:', rpcErr.message);
      return mapRpcExceptionToResponse(rpcErr.message);
    }

    if (!rpcData || typeof rpcData !== 'object') {
      return errorResponse('فشل إنشاء المطالبة — لم يُرجِع الخادم بيانات.', 500, 'RPC_NO_DATA');
    }

    return successResponse(rpcData as CreateClaimResponse['data']);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'حدث خطأ غير متوقع';
    console.error('[claims/create] unexpected error:', e);
    return errorResponse(`حدث خطأ غير متوقع: ${message}`, 500, 'UNEXPECTED');
  }
}
