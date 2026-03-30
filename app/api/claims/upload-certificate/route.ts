/**
 * POST /api/claims/upload-certificate
 *
 * Supervisor-only endpoint: uploads a completion certificate for a claim
 * that is currently under_supervisor_review.
 *
 * Validates:
 *  1. User is authenticated
 *  2. Claim exists and is under_supervisor_review
 *  3. User has supervisor role on the claim's contract (contract-scoped or legacy)
 *  4. File is a valid PDF
 *
 * Then:
 *  1. Uploads file to Supabase Storage
 *  2. Creates document record with type = 'completion_certificate'
 *  3. Sets claims.has_completion_certificate = true
 *  4. Creates audit trail entry in claim_workflow
 *
 * SECURITY: All writes use adminClient (service role) to bypass RLS.
 */

import { createServerSupabaseFromRequest, createAdminSupabase } from '@/lib/supabase-server';
import { resolveContractRole } from '@/lib/contract-permissions';
import { NextRequest, NextResponse } from 'next/server';
import type { UserRole } from '@/lib/types';

interface UploadCertificateResponse {
  data?: {
    documentId: string;
    claimId: string;
    storagePath: string;
  };
  error?: string;
}

function errorResponse(message: string, status: number = 400): NextResponse<UploadCertificateResponse> {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest): Promise<NextResponse<UploadCertificateResponse>> {
  try {
    const supabase = await createServerSupabaseFromRequest(request);

    // ── 1. Authenticate ──
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return errorResponse('يجب تسجيل الدخول أولاً', 401);
    }

    // ── 2. Parse form data ──
    const formData = await request.formData();
    const claimId = formData.get('claimId') as string;
    const file = formData.get('file') as File | null;

    if (!claimId) {
      return errorResponse('معاملة مطلوبة: claimId', 400);
    }
    if (!file) {
      return errorResponse('يجب إرفاق ملف شهادة الإنجاز', 400);
    }

    // Validate file type (PDF only)
    if (file.type !== 'application/pdf') {
      return errorResponse('يجب أن يكون الملف بصيغة PDF فقط', 400);
    }

    // Validate file size (max 100MB)
    const MAX_SIZE = 100 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      return errorResponse('حجم الملف يتجاوز الحد المسموح (100 ميجابايت)', 400);
    }

    // ── 3. Fetch claim ──
    const adminClient = createAdminSupabase();
    const { data: claim, error: claimErr } = await adminClient
      .from('claims')
      .select('id, status, contract_id, claim_no, has_completion_certificate')
      .eq('id', claimId)
      .single();

    if (claimErr || !claim) {
      return errorResponse('لم يتم العثور على المطالبة', 404);
    }

    if (claim.status !== 'under_supervisor_review') {
      return errorResponse(
        'لا يمكن رفع شهادة الإنجاز إلا عندما تكون المطالبة قيد مراجعة جهة الإشراف',
        400,
      );
    }

    // ── 4. Verify supervisor role ──
    const { data: profile } = await adminClient
      .from('profiles')
      .select('id, role')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile) {
      return errorResponse('لم يتم العثور على ملف المستخدم', 404);
    }

    const userRole = profile.role as UserRole;

    // Resolve contract-scoped role (dual-read: user_contract_roles → legacy fallback)
    const { role: contractRole } = await resolveContractRole(
      adminClient, user.id, claim.contract_id, userRole,
    );

    // Must be supervisor (contract-scoped) or consultant/supervisor (legacy)
    const isSupervisor =
      contractRole === 'supervisor' ||
      userRole === 'consultant' ||
      userRole === 'supervisor';

    if (!isSupervisor) {
      return errorResponse('فقط جهة الإشراف يمكنها رفع شهادة الإنجاز', 403);
    }

    console.log(
      `[upload-certificate] user=${user.id} claim=${claimId} ` +
      `contract=${claim.contract_id} contractRole=${contractRole}`,
    );

    // ── 5. Upload file to Supabase Storage ──
    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9._\u0600-\u06FF-]/g, '_');
    const storagePath = `claims/${claimId}/certificates/${timestamp}_${safeName}`;

    const fileBuffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadErr } = await adminClient.storage
      .from('documents')
      .upload(storagePath, fileBuffer, {
        contentType: 'application/pdf',
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadErr) {
      console.error('[upload-certificate] Storage upload error:', uploadErr);
      return errorResponse('فشل في رفع الملف إلى التخزين', 500);
    }

    // ── 6. Create document record ──
    const { data: doc, error: docErr } = await adminClient
      .from('documents')
      .insert({
        name: file.name,
        original_name: file.name,
        file_path: storagePath,
        file_size: file.size,
        mime_type: 'application/pdf',
        type: 'completion_certificate',
        claim_id: claimId,
        uploaded_by: user.id,
      })
      .select('id')
      .single();

    if (docErr) {
      console.error('[upload-certificate] Document insert error:', docErr);
      return errorResponse('فشل في إنشاء سجل المستند', 500);
    }

    // ── 7. Update claim flag ──
    const { error: flagErr } = await adminClient
      .from('claims')
      .update({
        has_completion_certificate: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', claimId);

    if (flagErr) {
      console.error('[upload-certificate] Flag update error:', flagErr);
      // Non-fatal — document is already uploaded
    }

    // ── 8. Audit trail entry ──
    const { error: wfErr } = await adminClient
      .from('claim_workflow')
      .insert({
        claim_id: claimId,
        action: 'upload_certificate',
        from_status: claim.status,
        to_status: claim.status, // No status change
        actor_id: user.id,
        notes: `رفع شهادة الإنجاز — ${file.name}`,
      });

    if (wfErr) {
      console.warn('[upload-certificate] Workflow audit error:', wfErr.message);
    }

    // ── 9. Audit log ──
    // NOTE: audit_logs uses entity_type/entity_id/old_values/new_values/metadata columns
    //       and action is audit_action enum (not free text)
    await adminClient
      .from('audit_logs')
      .insert({
        entity_type: 'claim',
        entity_id: claimId,
        action: 'upload',
        actor_id: user.id,
        actor_role: userRole,
        old_values: { has_completion_certificate: claim.has_completion_certificate },
        new_values: { has_completion_certificate: true, document_id: doc.id },
        metadata: {
          source: 'upload-certificate',
          file_name: file.name,
          file_size: file.size,
          storage_path: storagePath,
        },
        ip_address: request.headers.get('x-forwarded-for') || '0.0.0.0',
      });

    console.log(`[upload-certificate] SUCCESS: claim=${claimId} doc=${doc.id}`);

    return NextResponse.json({
      data: {
        documentId: doc.id,
        claimId,
        storagePath,
      },
    }, { status: 200 });
  } catch (error) {
    console.error('[upload-certificate] Unexpected error:', error);
    const message = error instanceof Error ? error.message : 'حدث خطأ في الخادم';
    return errorResponse(message, 500);
  }
}
