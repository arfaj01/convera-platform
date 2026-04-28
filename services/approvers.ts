/**
 * CONVERA Contract Approvers Service
 * Manages dynamic final approver assignments per contract (Migration 040)
 */

import { createBrowserSupabase } from '@/lib/supabase';
import type { ContractApprover, ApprovalScope } from '@/lib/types';
import { friendlyError } from '@/lib/errors';

interface ApiResponse<T> {
  data?: T;
  error?: string;
  success: boolean;
}

function createErrorResponse<T>(error: string): ApiResponse<T> {
  return { data: undefined as unknown as T, error, success: false };
}

// ─── Get Approvers ──────────────────────────────────────────────

/**
 * Fetch all active approvers for a contract
 */
export async function getContractApprovers(
  contractId: string,
  scope?: ApprovalScope,
): Promise<ApiResponse<ContractApprover[]>> {
  try {
    const supabase = createBrowserSupabase();
    let query = supabase
      .from('contract_approvers')
      .select(`
        *,
        profiles:user_id(full_name_ar, full_name, email)
      `)
      .eq('contract_id', contractId)
      .eq('is_active', true)
      .order('granted_at', { ascending: false });

    if (scope) {
      query = query.eq('approval_scope', scope);
    }

    const { data, error } = await query;
    if (error) throw error;
    return { data: data || [], success: true };
  } catch (error) {
    return createErrorResponse(friendlyError(error));
  }
}

/**
 * Fetch final approvers for a specific contract
 */
export async function getContractFinalApprovers(
  contractId: string,
): Promise<ApiResponse<ContractApprover[]>> {
  return getContractApprovers(contractId, 'final_approver');
}

/**
 * Check if a user is a final approver for a contract
 */
export async function isUserFinalApprover(
  userId: string,
  contractId: string,
): Promise<boolean> {
  try {
    const supabase = createBrowserSupabase();

    // Director is always a final approver
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle();

    if (profile?.role === 'director') return true;

    // Check contract_approvers table
    const { count } = await supabase
      .from('contract_approvers')
      .select('id', { count: 'exact', head: true })
      .eq('contract_id', contractId)
      .eq('user_id', userId)
      .eq('approval_scope', 'final_approver')
      .eq('is_active', true);

    return (count ?? 0) > 0;
  } catch {
    return false;
  }
}

// ─── Manage Approvers ───────────────────────────────────────────

/**
 * Add a new approver to a contract (Director only)
 */
export async function addContractApprover(input: {
  contractId: string;
  userId: string;
  scope: ApprovalScope;
  grantedBy: string;
  notes?: string;
}): Promise<ApiResponse<ContractApprover>> {
  try {
    const supabase = createBrowserSupabase();
    const { data, error } = await supabase
      .from('contract_approvers')
      .insert({
        contract_id: input.contractId,
        user_id: input.userId,
        approval_scope: input.scope,
        granted_by: input.grantedBy,
        notes: input.notes || null,
      })
      .select(`
        *,
        profiles:user_id(full_name_ar, full_name, email)
      `)
      .single();

    if (error) throw error;
    return { data, success: true };
  } catch (error) {
    return createErrorResponse(friendlyError(error));
  }
}

/**
 * Revoke an approver from a contract (soft delete)
 */
export async function revokeContractApprover(
  approverId: string,
): Promise<ApiResponse<void>> {
  try {
    const supabase = createBrowserSupabase();
    const { error } = await supabase
      .from('contract_approvers')
      .update({
        is_active: false,
        revoked_at: new Date().toISOString(),
      })
      .eq('id', approverId);

    if (error) throw error;
    return { data: undefined, success: true };
  } catch (error) {
    return createErrorResponse(friendlyError(error));
  }
}

// ─── Previous Progress ──────────────────────────────────────────

/**
 * Get cumulative prev_progress for all BOQ items in a contract
 * from all approved/closed claims.
 * Returns a map of item_no → total_prev_progress
 */
export async function getPreviousProgress(
  contractId: string,
): Promise<ApiResponse<Record<number, number>>> {
  try {
    const supabase = createBrowserSupabase();

    // Get all BOQ items from approved/closed claims for this contract
    const { data, error } = await supabase
      .from('claim_boq_items')
      .select(`
        item_no,
        curr_progress,
        claims!inner(contract_id, status)
      `)
      .eq('claims.contract_id', contractId)
      .in('claims.status', ['approved', 'closed']);

    if (error) throw error;

    // Aggregate curr_progress by item_no
    const progressMap: Record<number, number> = {};
    for (const row of data || []) {
      const itemNo = row.item_no;
      const curr = parseFloat(String(row.curr_progress)) || 0;
      progressMap[itemNo] = (progressMap[itemNo] || 0) + curr;
    }

    return { data: progressMap, success: true };
  } catch (error) {
    return createErrorResponse(friendlyError(error));
  }
}
