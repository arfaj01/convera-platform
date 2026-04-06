/**
 * CONVERA Permission Requests Service
 * ADMIN submits requests, Director approves/rejects (Migration 040)
 */

import { createBrowserSupabase } from '@/lib/supabase';
import type { PermissionRequest, PermissionRequestStatus, ApprovalScope } from '@/lib/types';
import { friendlyError } from '@/lib/errors';

interface ApiResponse<T> {
  data?: T;
  error?: string;
  success: boolean;
}

function createErrorResponse<T>(error: string): ApiResponse<T> {
  return { data: undefined as unknown as T, error, success: false };
}

// ─── Fetch Requests ─────────────────────────────────────────────

/**
 * Fetch all permission requests (optionally filtered by status)
 */
export async function getPermissionRequests(
  status?: PermissionRequestStatus,
): Promise<ApiResponse<PermissionRequest[]>> {
  try {
    const supabase = createBrowserSupabase();
    let query = supabase
      .from('permission_requests')
      .select(`
        *,
        requester:requested_by(full_name_ar, full_name),
        target_user:target_user_id(full_name_ar, full_name, email),
        contract:contract_id(contract_no, title_ar)
      `)
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) throw error;
    return { data: data || [], success: true };
  } catch (error) {
    return createErrorResponse(friendlyError(error));
  }
}

/**
 * Fetch pending permission requests (for Director dashboard)
 */
export async function getPendingPermissionRequests(): Promise<ApiResponse<PermissionRequest[]>> {
  return getPermissionRequests('pending');
}

// ─── Create Request (ADMIN) ─────────────────────────────────────

/**
 * Submit a permission request (ADMIN creates, Director approves)
 */
export async function createPermissionRequest(input: {
  requestedBy: string;
  targetUserId: string;
  contractId: string;
  requestedScope: ApprovalScope;
  notes?: string;
}): Promise<ApiResponse<PermissionRequest>> {
  try {
    const supabase = createBrowserSupabase();
    const { data, error } = await supabase
      .from('permission_requests')
      .insert({
        requested_by: input.requestedBy,
        target_user_id: input.targetUserId,
        contract_id: input.contractId,
        requested_scope: input.requestedScope,
        notes: input.notes || null,
      })
      .select(`
        *,
        requester:requested_by(full_name_ar, full_name),
        target_user:target_user_id(full_name_ar, full_name, email),
        contract:contract_id(contract_no, title_ar)
      `)
      .single();

    if (error) throw error;
    return { data, success: true };
  } catch (error) {
    return createErrorResponse(friendlyError(error));
  }
}

// ─── Approve/Reject (Director) ──────────────────────────────────

/**
 * Approve a permission request (Director only)
 * Auto-creates a contract_approvers entry
 */
export async function approvePermissionRequest(
  requestId: string,
  approvedBy: string,
): Promise<ApiResponse<PermissionRequest>> {
  try {
    const supabase = createBrowserSupabase();

    // Fetch the request details first
    const { data: req, error: fetchErr } = await supabase
      .from('permission_requests')
      .select('*')
      .eq('id', requestId)
      .single();

    if (fetchErr || !req) throw fetchErr || new Error('طلب غير موجود');

    if (req.status !== 'pending') {
      return createErrorResponse('هذا الطلب تمت معالجته مسبقاً');
    }

    // Update request status
    const now = new Date().toISOString();
    const { data: updated, error: updateErr } = await supabase
      .from('permission_requests')
      .update({
        status: 'approved',
        approved_by: approvedBy,
        approved_at: now,
        updated_at: now,
      })
      .eq('id', requestId)
      .select(`
        *,
        requester:requested_by(full_name_ar, full_name),
        target_user:target_user_id(full_name_ar, full_name, email),
        contract:contract_id(contract_no, title_ar)
      `)
      .single();

    if (updateErr) throw updateErr;

    // Auto-create contract_approvers entry
    const { error: approverErr } = await supabase
      .from('contract_approvers')
      .upsert({
        contract_id: req.contract_id,
        user_id: req.target_user_id,
        approval_scope: req.requested_scope,
        granted_by: approvedBy,
        is_active: true,
        notes: `تم الاعتماد بناء على طلب الصلاحية رقم ${requestId}`,
      }, {
        onConflict: 'contract_id,user_id,approval_scope',
      });

    if (approverErr) {
      console.warn('Auto-create approver error:', approverErr.message);
    }

    return { data: updated, success: true };
  } catch (error) {
    return createErrorResponse(friendlyError(error));
  }
}

/**
 * Reject a permission request (Director only)
 */
export async function rejectPermissionRequest(
  requestId: string,
  approvedBy: string,
  rejectionReason: string,
): Promise<ApiResponse<PermissionRequest>> {
  try {
    const supabase = createBrowserSupabase();
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from('permission_requests')
      .update({
        status: 'rejected',
        approved_by: approvedBy,
        approved_at: now,
        rejection_reason: rejectionReason,
        updated_at: now,
      })
      .eq('id', requestId)
      .eq('status', 'pending')
      .select(`
        *,
        requester:requested_by(full_name_ar, full_name),
        target_user:target_user_id(full_name_ar, full_name, email),
        contract:contract_id(contract_no, title_ar)
      `)
      .single();

    if (error) throw error;
    return { data, success: true };
  } catch (error) {
    return createErrorResponse(friendlyError(error));
  }
}
