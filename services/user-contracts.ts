/**
 * CONVERA — User-Contract Associations Service
 * "العقود المرتبطة"
 *
 * Manages the many-to-many relationship between users (profiles) and contracts.
 * Requires migration 010_user_contracts.sql to be applied first.
 *
 * Access rules:
 *  - director:           sees all contracts, manages all links
 *  - auditor/reviewer:   sees all links (read)
 *  - contractor/supervisor: sees only their own links
 */

import { createBrowserSupabase } from '@/lib/supabase';

// ── Types ──────────────────────────────────────────────────────────

export interface UserContractLink {
  id:          string;
  user_id:     string;
  contract_id: string;
  created_at:  string;
}

// ── Fetch ──────────────────────────────────────────────────────────

/**
 * Get contract IDs linked to a specific user.
 * Used to pre-populate the contract selector in UserFormModal.
 */
export async function getUserLinkedContractIds(userId: string): Promise<string[]> {
  const supabase = createBrowserSupabase();
  const { data, error } = await supabase
    .from('user_contracts')
    .select('contract_id')
    .eq('user_id', userId);

  if (error) {
    // If table doesn't exist yet (migration not applied), return empty gracefully
    if (error.message.includes('does not exist') || error.code === '42P01') {
      console.warn('[user-contracts] Table not found — run migration 010_user_contracts.sql');
      return [];
    }
    throw error;
  }

  return (data || []).map(r => r.contract_id);
}

/**
 * Replace all linked contracts for a user.
 * Deletes existing links then inserts new ones atomically.
 * Only director can call this.
 */
export async function setUserLinkedContracts(
  userId: string,
  contractIds: string[]
): Promise<void> {
  const supabase = createBrowserSupabase();

  // Delete existing links
  const { error: deleteErr } = await supabase
    .from('user_contracts')
    .delete()
    .eq('user_id', userId);

  if (deleteErr) {
    if (deleteErr.message.includes('does not exist') || deleteErr.code === '42P01') {
      console.warn('[user-contracts] Table not found — run migration 010_user_contracts.sql');
      return;
    }
    throw deleteErr;
  }

  if (contractIds.length === 0) return;

  // Insert new links
  const { error: insertErr } = await supabase
    .from('user_contracts')
    .insert(
      contractIds.map(contract_id => ({ user_id: userId, contract_id }))
    );

  if (insertErr) throw insertErr;
}

/**
 * Fetch contracts visible to the currently authenticated user.
 * Directors see all contracts; others see only their linked contracts.
 * Falls back to full contract list if user_contracts table is missing.
 */
export async function getVisibleContractIds(): Promise<string[] | null> {
  const supabase = createBrowserSupabase();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  // Director sees all contracts
  if (!profile || profile.role === 'director') return null;

  // Others: return their linked contract IDs
  return getUserLinkedContractIds(user.id);
}
