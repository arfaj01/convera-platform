/**
 * CONVERA Claims Service
 * Complete Supabase service for claims CRUD + workflow transitions
 * Enforces all governance rules and validation
 */

import { createBrowserSupabase, getAuthHeaders } from '@/lib/supabase';
import type {
  Claim,
  ClaimBOQItem,
  ClaimStaffItem,
  ClaimStatus,
  ClaimView,
  ClaimWorkflow,
  Document,
} from '@/lib/types';
import { friendlyError } from '@/lib/errors';

// ─── Timeout helper ───────────────────────────────────────────────
function withTimeout<T>(thenable: PromiseLike<T>, ms: number): Promise<T> {
  return Promise.race([
    Promise.resolve(thenable),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT')), ms)
    ),
  ]);
}

// ─── Type Definitions ────────────────────────────────────────────

export interface GetClaimFilters {
  contractId?: string;
  status?: ClaimStatus | ClaimStatus[];
  submittedBy?: string;
  approvedBy?: string;
  limit?: number;
  offset?: number;
}

export interface CreateClaimInput {
  contractId: string;
  claimNo: number;
  periodFrom: string | null;
  periodTo: string | null;
  referenceNo: string | null;
  boqAmount: number;
  staffAmount: number;
  retentionAmount: number;
  vatAmount: number;
  claimType: 'boq_only' | 'staff_only' | 'mixed' | 'supervision';
  submittedBy: string | null;
  boqRows: Record<string, unknown>[];
  staffRows: Record<string, unknown>[];
  status?: 'draft' | 'submitted';
}

export interface UpdateClaimInput {
  periodFrom?: string | null;
  periodTo?: string | null;
  referenceNo?: string | null;
  boqAmount?: number;
  staffAmount?: number;
  retentionAmount?: number;
  vatAmount?: number;
  invoiceDate?: string | null;
}

export interface WorkflowActionInput {
  claimId: string;
  action: string; // 'approve', 'return', 'reject', 'assign_supervisor', 'submit'
  returnReason?: string; // Required for 'return' action
  rejectionReason?: string; // Required for 'reject' action
  actorId: string; // User performing the action
  notes?: string;
}

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  success: boolean;
}

// ─── Generic API Response Helper ──────────────────────────────────

function createResponse<T>(
  data: T | undefined,
  error?: string,
): ApiResponse<T> {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: data as any,
    error,
    success: !error,
  };
}

/** Create an error response with the correct generic type */
function createErrorResponse<T>(error: string): ApiResponse<T> {
  return { data: undefined as unknown as T, error, success: false };
}

// ─── Claims CRUD Operations ──────────────────────────────────────

/**
 * Fetch a single claim by ID with full details
 */
export async function getClaim(claimId: string): Promise<ApiResponse<Claim & { contract: any }>> {
  try {
    const supabase = createBrowserSupabase();
    const query = supabase
      .from('claims')
      .select(
        `
        *,
        contracts(
          id, contract_no, title_ar, title, party_name_ar, party_name,
          retention_pct, base_value, boq_progress_model, director_id
        )
      `,
      )
      .eq('id', claimId)
      .single();

    const { data, error } = await withTimeout(
      query as unknown as Promise<{ data: Claim & { contract: any } | null; error: unknown }>,
      8000
    );

    if (error) throw error;
    return createResponse(data ?? undefined);
  } catch (error) {
    return createErrorResponse(friendlyError(error));
  }
}

/**
 * Fetch claims list with optional filtering
 */
export async function getClaimsList(filters?: GetClaimFilters): Promise<ApiResponse<ClaimView[]>> {
  try {
    const supabase = createBrowserSupabase();
    let query = supabase
      .from('claims')
      .select(
        `
        id, claim_no, contract_id, reference_no, status,
        period_from, period_to, invoice_date,
        boq_amount, staff_amount, gross_amount,
        retention_amount, net_amount, vat_amount, total_amount,
        submitted_at, created_at, approved_at,
        contracts(contract_no)
      `,
      )
      .order('claim_no', { ascending: false });

    // Apply filters
    if (filters?.contractId) {
      query = query.eq('contract_id', filters.contractId);
    }

    if (filters?.status) {
      const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
      query = query.in('status', statuses);
    }

    if (filters?.submittedBy) {
      query = query.eq('submitted_by', filters.submittedBy);
    }

    if (filters?.approvedBy) {
      query = query.eq('approved_by', filters.approvedBy);
    }

    // Apply pagination
    if (filters?.limit) {
      query = query.limit(filters.limit);
    }
    if (filters?.offset) {
      query = query.range(filters.offset, (filters.offset + (filters.limit || 10)) - 1);
    }

    const { data, error } = await query;

    if (error) throw error;

    const claims: ClaimView[] = (data || []).map((c): ClaimView => ({
      no: c.claim_no,
      id: c.id,
      contractId: c.contract_id,
      contractNo: (c.contracts as any)?.contract_no || '',
      ref: c.reference_no || `DRAFT-${c.claim_no}`,
      date: c.submitted_at ? c.submitted_at.split('T')[0] : c.created_at?.split('T')[0] || '',
      from: c.period_from || '',
      to: c.period_to || '',
      total: parseFloat(String(c.total_amount)) || 0,
      gross: parseFloat(String(c.gross_amount)) || 0,
      retention: parseFloat(String(c.retention_amount)) || 0,
      vat: parseFloat(String(c.vat_amount)) || 0,
      boq: parseFloat(String(c.boq_amount)) || 0,
      staff: parseFloat(String(c.staff_amount)) || 0,
      status: c.status || 'draft',
    }));

    return createResponse(claims);
  } catch (error) {
    return createErrorResponse(friendlyError(error));
  }
}

/**
 * Create a claim in draft status
 * (Submit flow is handled separately via submitClaim)
 */
export async function createClaim(input: CreateClaimInput): Promise<ApiResponse<Claim>> {
  try {
    const supabase = createBrowserSupabase();

    // Step 1: Insert claim as draft
    const { data: claim, error: claimErr } = await supabase
      .from('claims')
      .insert({
        claim_no: input.claimNo,
        contract_id: input.contractId,
        status: 'draft',
        period_from: input.periodFrom,
        period_to: input.periodTo,
        invoice_date: input.periodTo,
        reference_no: input.referenceNo,
        boq_amount: input.boqAmount,
        staff_amount: input.staffAmount,
        retention_amount: input.retentionAmount,
        vat_amount: input.vatAmount,
        claim_type: input.claimType,
        submitted_by: input.submittedBy,
        submitted_at: null,
        created_by: input.submittedBy,
      })
      .select()
      .single();

    if (claimErr) throw claimErr;

    // Step 2: Insert BOQ items
    if (input.boqRows.length > 0) {
      const { error: boqErr } = await supabase
        .from('claim_boq_items')
        .insert(input.boqRows.map((r) => ({ ...r, claim_id: claim.id })));
      if (boqErr) console.warn('BOQ items insert warning:', boqErr.message);
    }

    // Step 3: Insert staff items
    if (input.staffRows.length > 0) {
      const { error: staffErr } = await supabase
        .from('claim_staff_items')
        .insert(input.staffRows.map((r) => ({ ...r, claim_id: claim.id })));
      if (staffErr) console.warn('Staff items insert warning:', staffErr.message);
    }

    return createResponse(claim);
  } catch (error) {
    return createErrorResponse(friendlyError(error));
  }
}

/**
 * Update claim details (only allowed in draft status)
 */
export async function updateClaim(
  claimId: string,
  input: UpdateClaimInput,
): Promise<ApiResponse<Claim>> {
  try {
    const supabase = createBrowserSupabase();

    // First fetch current status
    const { data: current, error: fetchErr } = await supabase
      .from('claims')
      .select('status')
      .eq('id', claimId)
      .single();

    if (fetchErr) throw fetchErr;

    // Only allow updates in draft status
    if (current.status !== 'draft') {
      return createErrorResponse('يمكن تعديل المطالبة فقط في حالة المسودة. استخدم إرجاع المطالبة لإجراء تعديلات.',
      );
    }

    const updateData: Record<string, unknown> = {};
    if (input.periodFrom !== undefined) updateData.period_from = input.periodFrom;
    if (input.periodTo !== undefined) updateData.period_to = input.periodTo;
    if (input.referenceNo !== undefined) updateData.reference_no = input.referenceNo;
    if (input.boqAmount !== undefined) updateData.boq_amount = input.boqAmount;
    if (input.staffAmount !== undefined) updateData.staff_amount = input.staffAmount;
    if (input.retentionAmount !== undefined) updateData.retention_amount = input.retentionAmount;
    if (input.vatAmount !== undefined) updateData.vat_amount = input.vatAmount;
    if (input.invoiceDate !== undefined) updateData.invoice_date = input.invoiceDate;

    const { data, error } = await supabase
      .from('claims')
      .update(updateData)
      .eq('id', claimId)
      .select()
      .single();

    if (error) throw error;
    return createResponse(data);
  } catch (error) {
    return createErrorResponse(friendlyError(error));
  }
}

// ─── Claim BOQ & Staff Items ────────────────────────────────────

/**
 * Fetch BOQ items for a claim
 */
export async function getClaimBOQItems(claimId: string): Promise<ApiResponse<ClaimBOQItem[]>> {
  try {
    const supabase = createBrowserSupabase();
    const query = supabase
      .from('claim_boq_items')
      .select('*')
      .eq('claim_id', claimId)
      .order('item_no', { ascending: true });

    const { data, error } = await withTimeout(
      query as unknown as Promise<{ data: ClaimBOQItem[] | null; error: unknown }>,
      8000
    );

    if (error) throw error;
    return createResponse(data || []);
  } catch (error) {
    return createErrorResponse(friendlyError(error));
  }
}

/**
 * Fetch staff items for a claim
 */
export async function getClaimStaffItems(claimId: string): Promise<ApiResponse<ClaimStaffItem[]>> {
  try {
    const supabase = createBrowserSupabase();
    const query = supabase
      .from('claim_staff_items')
      .select('*')
      .eq('claim_id', claimId)
      .order('item_no', { ascending: true });

    const { data, error } = await withTimeout(
      query as unknown as Promise<{ data: ClaimStaffItem[] | null; error: unknown }>,
      8000
    );

    if (error) throw error;
    return createResponse(data || []);
  } catch (error) {
    return createErrorResponse(friendlyError(error));
  }
}

// ─── Workflow & Governance ──────────────────────────────────────

/**
 * Submit claim (draft → submitted)
 * Backend validates mandatory documents: invoice + technical_report
 * This calls the API route /api/claims/submit for backend validation
 */
export async function submitClaim(claimId: string): Promise<ApiResponse<Claim>> {
  try {
    // Include Authorization: Bearer header — required because the browser client stores
    // the session in localStorage, not cookies. The API route reads the bearer token.
    const headers = await getAuthHeaders();
    const response = await fetch('/api/claims/submit', {
      method: 'POST',
      headers,
      body: JSON.stringify({ claimId }),
    });

    const result = await response.json();
    if (!response.ok) {
      return createErrorResponse(result.error || 'فشل في تقديم المطالبة');
    }

    return createResponse(result.data);
  } catch (error) {
    return createErrorResponse(friendlyError(error));
  }
}

/**
 * Execute workflow action (approve, return, reject, assign)
 * Enforces role-based permissions and updates audit trail
 */
export async function executeWorkflowAction(
  input: WorkflowActionInput,
): Promise<ApiResponse<{ claim: Claim; workflow: ClaimWorkflow }>> {
  try {
    const headers = await getAuthHeaders();
    const response = await fetch('/api/claims/transition', {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
    });

    const result = await response.json();
    if (!response.ok) {
      return createErrorResponse(result.error || 'فشل في تنفيذ الإجراء');
    }

    return createResponse(result.data);
  } catch (error) {
    return createErrorResponse(friendlyError(error));
  }
}

/**
 * Fetch complete workflow history for a claim
 */
export async function getClaimWorkflowHistory(
  claimId: string,
): Promise<ApiResponse<ClaimWorkflow[]>> {
  try {
    const supabase = createBrowserSupabase();
    const { data, error } = await supabase
      .from('claim_workflow')
      .select(
        `
        *,
        profiles:actor_id(full_name_ar, full_name, role)
      `,
      )
      .eq('claim_id', claimId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return createResponse(data || []);
  } catch (error) {
    return createErrorResponse(friendlyError(error));
  }
}

// ─── Documents ──────────────────────────────────────────────────

/**
 * Fetch all documents for a claim
 */
export async function getClaimDocuments(claimId: string): Promise<ApiResponse<Document[]>> {
  try {
    const supabase = createBrowserSupabase();
    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .eq('entity_id', claimId)
      .eq('entity_type', 'claim')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return createResponse(data || []);
  } catch (error) {
    return createErrorResponse(friendlyError(error));
  }
}

/**
 * Check if claim has required documents for submission
 * Required: invoice + technical_report
 */
export async function hasRequiredDocuments(claimId: string): Promise<ApiResponse<{
  hasInvoice: boolean;
  hasTechnicalReport: boolean;
  isComplete: boolean;
}>> {
  try {
    const supabase = createBrowserSupabase();

    const { count: invoiceCount, error: invoiceErr } = await supabase
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('entity_id', claimId)
      .eq('entity_type', 'claim')
      .eq('document_type', 'invoice');

    const { count: reportCount, error: reportErr } = await supabase
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('entity_id', claimId)
      .eq('entity_type', 'claim')
      .eq('document_type', 'technical_report');

    if (invoiceErr || reportErr) throw invoiceErr || reportErr;

    const hasInvoice = (invoiceCount || 0) > 0;
    const hasTechnicalReport = (reportCount || 0) > 0;

    return createResponse({
      hasInvoice,
      hasTechnicalReport,
      isComplete: hasInvoice && hasTechnicalReport,
    });
  } catch (error) {
    return createErrorResponse(friendlyError(error),
    );
  }
}

// ─── Compatibility Aliases ────────────────────────────────────────
// These provide simpler function signatures for page components

/**
 * Simple wrapper around getClaimsList for use in page components.
 * Returns ClaimView[] directly (throws on error).
 */
export async function fetchClaims(contractId?: string): Promise<ClaimView[]> {
  const result = await getClaimsList(contractId ? { contractId } : undefined);
  if (result.error) throw new Error(result.error);
  return result.data || [];
}

/**
 * Fetch a single claim by ID (throws on error)
 */
export async function fetchClaimById(claimId: string) {
  const result = await getClaim(claimId);
  if (result.error) throw new Error(result.error);
  return result.data;
}

/**
 * Fetch BOQ items for a claim (throws on error)
 */
export async function fetchClaimBOQItems(claimId: string): Promise<ClaimBOQItem[]> {
  const result = await getClaimBOQItems(claimId);
  if (result.error) throw new Error(result.error);
  return result.data || [];
}

/**
 * Fetch Staff items for a claim (throws on error)
 */
export async function fetchClaimStaffItems(claimId: string): Promise<ClaimStaffItem[]> {
  const result = await getClaimStaffItems(claimId);
  if (result.error) throw new Error(result.error);
  return result.data || [];
}
