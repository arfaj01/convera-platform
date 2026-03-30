/**
 * GET /api/documents/[id]/download
 *
 * Production-hardened secure document download endpoint.
 *
 * Authorization flow:
 *   1. Authenticate user via Bearer token (JWT)
 *   2. Load document record + associated claim from DB
 *   3. Resolve user's contract role (dual-read: new table → legacy fallback)
 *   4. Enforce access via DocumentAccessService:
 *      - User MUST have a role on the document's contract (cross-contract blocked)
 *      - Contractors cannot access completion_certificate before director approval
 *      - Unauthorized → 403 with structured error code
 *   5. Generate short-lived signed URL via admin client (120s expiry)
 *   6. Return signed URL as JSON
 *
 * SECURITY:
 *   - Admin client used ONLY for signed URL generation (bypasses storage RLS)
 *   - Authorization enforced at application level BEFORE signed URL generation
 *   - No storage.list() calls (expensive, unnecessary)
 *   - Short-lived URLs (120s) to minimize exposure window
 */

import { createServerSupabaseFromRequest, createAdminSupabase } from '@/lib/supabase-server';
import { resolveContractRole } from '@/lib/contract-permissions';
import {
  canUserAccessDocument,
  getSignedDownloadUrl,
  logDownloadAttempt,
  type DocumentRecord,
  type ClaimContext,
  type DownloadAuditEntry,
} from '@/lib/document-access';
import { NextRequest, NextResponse } from 'next/server';
import type { UserRole } from '@/lib/types';

// ─── Response Types ──────────────────────────────────────────────────

interface DownloadResponse {
  url?: string;
  error?: string;
  code?: string;
}

function jsonError(message: string, status: number, code: string): NextResponse<DownloadResponse> {
  return NextResponse.json({ error: message, code }, { status });
}

// ─── Route Handler ───────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<DownloadResponse>> {
  const { id: documentId } = await params;

  // Partial audit entry — filled in as we go
  const audit: Partial<DownloadAuditEntry> = {
    action: 'document_download_attempt',
    documentId,
    result: 'error', // default until proven otherwise
  };

  try {
    // ── 1. Authenticate ──────────────────────────────────────────────
    const supabase = await createServerSupabaseFromRequest(request);
    const { data: { user }, error: authErr } = await supabase.auth.getUser();

    if (authErr || !user) {
      audit.result = 'denied';
      audit.reason = 'Authentication failed';
      logDownloadAttempt(audit as DownloadAuditEntry);
      return jsonError('يجب تسجيل الدخول أولاً', 401, 'AUTH_REQUIRED');
    }

    audit.userId = user.id;
    const adminClient = createAdminSupabase();

    // ── 2. Load user profile ─────────────────────────────────────────
    const { data: profile, error: profileErr } = await adminClient
      .from('profiles')
      .select('id, role, email')
      .eq('id', user.id)
      .maybeSingle();

    if (profileErr || !profile) {
      audit.result = 'denied';
      audit.reason = 'Profile not found';
      logDownloadAttempt(audit as DownloadAuditEntry);
      return jsonError('لم يتم العثور على ملف المستخدم', 404, 'PROFILE_NOT_FOUND');
    }

    const userRole = profile.role as UserRole;
    audit.userRole = userRole;

    // ── 3. Load document record ──────────────────────────────────────
    const { data: doc, error: docErr } = await adminClient
      .from('documents')
      .select('id, name, original_name, file_path, file_size, mime_type, type, claim_id, contract_id, uploaded_by')
      .eq('id', documentId)
      .maybeSingle();

    if (docErr || !doc) {
      audit.result = 'not_found';
      audit.reason = 'Document record not found';
      logDownloadAttempt(audit as DownloadAuditEntry);
      return jsonError('لم يتم العثور على المستند', 404, 'DOCUMENT_NOT_FOUND');
    }

    const docRecord = doc as DocumentRecord;
    audit.documentType = docRecord.type;
    audit.claimId = docRecord.claim_id;
    audit.filePath = docRecord.file_path;

    // ── 4. Resolve claim context ─────────────────────────────────────
    let claim: ClaimContext | null = null;
    let contractId: string | null = docRecord.contract_id;

    if (docRecord.claim_id) {
      const { data: claimData, error: claimErr } = await adminClient
        .from('claims')
        .select('id, contract_id, status, submitted_by')
        .eq('id', docRecord.claim_id)
        .maybeSingle();

      if (claimErr || !claimData) {
        audit.result = 'not_found';
        audit.reason = 'Associated claim not found';
        logDownloadAttempt(audit as DownloadAuditEntry);
        return jsonError('لم يتم العثور على المطالبة المرتبطة', 404, 'CLAIM_NOT_FOUND');
      }

      claim = claimData as ClaimContext;
      contractId = claim.contract_id;
    }

    if (!contractId) {
      audit.result = 'error';
      audit.reason = 'No contract context';
      logDownloadAttempt(audit as DownloadAuditEntry);
      return jsonError('لا يمكن تحديد العقد المرتبط بالمستند', 400, 'NO_CONTRACT_CONTEXT');
    }

    audit.contractId = contractId;

    // ── 5. Resolve contract role ─────────────────────────────────────
    const { role: contractRole, source: roleSource } = await resolveContractRole(
      adminClient, user.id, contractId, userRole,
    );

    audit.contractRole = contractRole;
    audit.roleSource = roleSource;

    // ── 6. Enforce access via DocumentAccessService ──────────────────
    const decision = canUserAccessDocument(docRecord, claim, contractRole, roleSource);

    if (!decision.allowed) {
      audit.result = 'denied';
      audit.reason = decision.reason;
      logDownloadAttempt(audit as DownloadAuditEntry);
      return jsonError(
        decision.code === 'CERTIFICATE_NOT_YET_AVAILABLE'
          ? 'لا يمكن تحميل شهادة الإنجاز إلا بعد اعتماد المطالبة من المدير'
          : 'ليس لديك صلاحية للوصول إلى هذا المستند',
        403,
        decision.code,
      );
    }

    // ── 7. Generate signed URL (short-lived, 120s) ───────────────────
    const signedResult = await getSignedDownloadUrl(adminClient, docRecord.file_path);

    if (!signedResult.ok || !signedResult.url) {
      audit.result = 'not_found';
      audit.reason = `Signed URL failed: ${signedResult.error}`;
      logDownloadAttempt(audit as DownloadAuditEntry);

      // If createSignedUrl fails → file is missing or path is wrong
      return jsonError(
        'الملف غير موجود في التخزين — قد يكون قد حُذف أو لم يُرفع بشكل صحيح',
        404,
        'FILE_NOT_IN_STORAGE',
      );
    }

    // ── 8. Success ───────────────────────────────────────────────────
    audit.result = 'success';
    logDownloadAttempt(audit as DownloadAuditEntry);

    return NextResponse.json(
      { url: signedResult.url },
      {
        status: 200,
        headers: { 'Cache-Control': 'private, no-store, max-age=0' },
      },
    );

  } catch (error) {
    audit.result = 'error';
    audit.reason = error instanceof Error ? error.message : 'Unknown error';
    logDownloadAttempt(audit as DownloadAuditEntry);

    console.error('[doc-download] Unexpected error:', error);
    return jsonError('حدث خطأ في الخادم', 500, 'INTERNAL_ERROR');
  }
}
