import { createBrowserSupabase, getAuthHeaders } from '@/lib/supabase';
import type { ClaimWorkflow, ClaimStatus, UserRole } from '@/lib/types';

// ─── Timeout helper ───────────────────────────────────────────────
function withTimeout<T>(thenable: PromiseLike<T>, ms: number): Promise<T> {
  return Promise.race([
    Promise.resolve(thenable),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT')), ms)
    ),
  ]);
}

export async function fetchClaimWorkflow(claimId: string): Promise<ClaimWorkflow[]> {
  const supabase = createBrowserSupabase();
  const query = supabase
    .from('claim_workflow')
    .select(`
      *,
      profiles:actor_id(full_name_ar, full_name)
    `)
    .eq('claim_id', claimId)
    .order('created_at', { ascending: true });

  const { data, error } = await withTimeout(
    query as unknown as Promise<{ data: ClaimWorkflow[] | null; error: unknown }>,
    8000
  );

  if (error) throw error;
  return data || [];
}

// ─── 5-Stage Workflow Transition Map ────────────────────────────
// Contractor → Supervisor → Auditor → Reviewer → Director
// NOTE: This map is READ-ONLY reference for UI rendering.
// ALL writes go through API routes (/api/claims/submit or /api/claims/transition).

interface Transition {
  action: string;
  toStatus: ClaimStatus;
  label: string;
  variant: 'teal' | 'red' | 'orange';
}

export function getAvailableActions(
  status: ClaimStatus,
  role: UserRole
): Transition[] {
  const map: Partial<Record<UserRole, Partial<Record<ClaimStatus, Transition[]>>>> = {
    // Stage 1: Contractor submits draft / resubmits after return
    contractor: {
      draft: [
        { action: 'submit', toStatus: 'under_supervisor_review', label: 'تقديم المستخلص', variant: 'teal' },
      ],
      returned_by_supervisor: [
        { action: 'resubmit', toStatus: 'under_supervisor_review', label: 'إعادة التقديم', variant: 'teal' },
      ],
      returned_by_auditor: [
        { action: 'resubmit', toStatus: 'under_supervisor_review', label: 'إعادة التقديم', variant: 'teal' },
      ],
    },

    // Stage 2: Supervisor (جهة الإشراف) reviews
    supervisor: {
      under_supervisor_review: [
        { action: 'approve', toStatus: 'under_auditor_review', label: 'موافقة وإحالة للتدقيق', variant: 'teal' },
        { action: 'return', toStatus: 'returned_by_supervisor', label: 'إرجاع للمقاول', variant: 'orange' },
      ],
    },

    // Stage 3: Auditor (مدقق) reviews
    auditor: {
      under_auditor_review: [
        { action: 'approve', toStatus: 'under_reviewer_check', label: 'موافقة وإحالة للمراجع', variant: 'teal' },
        { action: 'return', toStatus: 'returned_by_auditor', label: 'إرجاع للمقاول', variant: 'orange' },
      ],
    },

    // Stage 4: Reviewer (مراجع) checks اعتماد alignment
    reviewer: {
      under_reviewer_check: [
        { action: 'approve', toStatus: 'pending_director_approval', label: 'موافقة ورفع للمدير', variant: 'teal' },
        { action: 'return', toStatus: 'returned_by_auditor', label: 'إرجاع للتدقيق', variant: 'orange' },
      ],
    },

    // Stage 5: Director final decision
    director: {
      pending_director_approval: [
        { action: 'approve', toStatus: 'approved', label: 'اعتماد نهائي', variant: 'teal' },
        { action: 'return', toStatus: 'under_auditor_review', label: 'إرجاع للمدقق', variant: 'orange' },
        { action: 'reject', toStatus: 'rejected', label: 'رفض', variant: 'red' },
      ],
    },
  };

  return map[role]?.[status] || [];
}

/**
 * performClaimAction — Routes ALL workflow actions through hardened API endpoints.
 *
 * CRITICAL: This function previously wrote directly to the claims table from the browser,
 * bypassing all backend validation, audit logging, and atomic guarantees. That legacy path
 * was the root cause of claims getting stuck in status='submitted' with submitted_at=NULL.
 *
 * Now delegates to:
 *   - /api/claims/submit    (for action='submit' from draft)
 *   - /api/claims/transition (for all other workflow actions)
 *
 * Both API routes enforce full governance: role validation, document checks, audit trail,
 * and atomic state transitions. No direct DB writes from the browser.
 */
export async function performClaimAction(
  claimId: string,
  action: string,
  actorId: string,
  currentStatus: ClaimStatus,
  newStatus: ClaimStatus,
  notes?: string
) {
  const headers = await getAuthHeaders();

  // ── Submit action: route through atomic submit endpoint ──
  if (action === 'submit' && currentStatus === 'draft') {
    console.log({ action: 'SUBMIT_VIA_API_ROUTE', claimId, actorId, path: '/api/claims/submit' });

    const response = await fetch('/api/claims/submit', {
      method: 'POST',
      headers,
      body: JSON.stringify({ claimId }),
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || 'فشل في تقديم المطالبة');
    }

    return result.data?.claim?.status || 'under_supervisor_review';
  }

  // ── All other actions: route through transition endpoint ──
  console.log({
    action: 'TRANSITION_VIA_API_ROUTE',
    claimId,
    workflowAction: action,
    actorId,
    path: '/api/claims/transition',
  });

  const body: Record<string, unknown> = {
    claimId,
    action,
    actorId,
    notes: notes || undefined,
  };

  // Map notes to the correct field based on action type
  if (action === 'return' || action.includes('return')) {
    body.returnReason = notes || '';
  }
  if (action === 'reject') {
    body.rejectionReason = notes || 'مرفوض';
  }

  const response = await fetch('/api/claims/transition', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || 'فشل في تنفيذ الإجراء');
  }

  return result.data?.claim?.status || newStatus;
}

// ─── Schema-safe status exclusion list ──────────────────────────
// Uses neq() on terminal/inactive statuses (valid in BOTH old & new DB
// schemas) rather than in() on active statuses (new names may not exist
// in the DB enum until migration 009 is applied).
const TERMINAL_STATUSES = ['draft', 'approved', 'rejected', 'closed', 'cancelled'] as const;

export async function fetchPendingClaims() {
  const supabase = createBrowserSupabase();

  let query = supabase
    .from('claims')
    .select(`
      id, claim_no, contract_id, status, submitted_at,
      boq_amount, staff_amount, gross_amount, total_amount,
      contracts(contract_no, title_ar, title, party_name_ar)
    `);

  // Exclude terminal statuses — all valid in both old (4-stage) and new (5-stage) schemas
  for (const s of TERMINAL_STATUSES) {
    query = query.neq('status', s);
  }

  const finalQuery = query.order('submitted_at');

  const { data, error } = await withTimeout(
    finalQuery as unknown as Promise<{ data: unknown[] | null; error: unknown }>,
    8000
  );

  if (error) throw error;
  return data || [];
}
