import { createBrowserSupabase } from '@/lib/supabase';
import type { Amendment, ContractCeiling } from '@/lib/types';

// ─── Timeout helper ───────────────────────────────────────────────
// Wraps any thenable (including Supabase query builders) in a
// race-based timeout so the UI is never left in a permanent loading
// state if the Supabase client stalls during auth-token refresh.

function withTimeout<T>(thenable: PromiseLike<T>, ms: number): Promise<T> {
  return Promise.race([
    Promise.resolve(thenable),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT')), ms)
    ),
  ]);
}

export async function fetchAmendments(contractId: string): Promise<Amendment[]> {
  const supabase = createBrowserSupabase();
  const query = supabase
    .from('contract_amendments')
    .select('*')
    .eq('contract_id', contractId)
    .order('created_at', { ascending: true });

  // 8-second guard: prevents infinite loading when Supabase client
  // hangs on internal auth-session refresh (observed in high-latency
  // environments — not a code bug, but must be handled gracefully).
  const { data, error } = await withTimeout(
    query as unknown as Promise<{ data: Amendment[] | null; error: unknown }>,
    8000
  );

  if (error) throw error;
  return (data || []).map((row: Amendment) => ({
    ...row,
    value_change: parseFloat(String(row.value_change)) || 0,
    duration_change: (row as Amendment).duration_change || 0,
  }));
}

export interface CreateAmendmentInput {
  contractId: string;
  amendmentNo: string;
  title: string;
  description?: string;
  valueChange: number;
  durationChange: number;
  documentPath?: string;
  documentName?: string;
  createdBy: string;
}

export async function createAmendment(input: CreateAmendmentInput): Promise<Amendment> {
  const supabase = createBrowserSupabase();
  const { data, error } = await supabase
    .from('contract_amendments')
    .insert({
      contract_id: input.contractId,
      amendment_no: input.amendmentNo,
      title: input.title,
      description: input.description || null,
      value_change: input.valueChange,
      duration_change: input.durationChange,
      document_path: input.documentPath || null,
      document_name: input.documentName || null,
      status: 'pending',
      submitted_by: input.createdBy,
      submitted_at: new Date().toISOString(),
      created_by: input.createdBy,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function approveAmendment(id: string, actorId: string): Promise<void> {
  const supabase = createBrowserSupabase();
  const { error } = await supabase
    .from('contract_amendments')
    .update({
      status: 'approved',
      approved_by: actorId,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) throw error;
}

export async function rejectAmendment(id: string, actorId: string, reason: string): Promise<void> {
  const supabase = createBrowserSupabase();
  const { error } = await supabase
    .from('contract_amendments')
    .update({
      status: 'rejected',
      approved_by: actorId,
      approved_at: new Date().toISOString(),
      rejection_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) throw error;
}

export async function fetchContractCeiling(contractId: string): Promise<ContractCeiling> {
  const supabase = createBrowserSupabase();
  const { data, error } = await supabase
    .from('contract_ceiling_summary')
    .select('*')
    .eq('contract_id', contractId)
    .single();

  if (error) throw error;

  return {
    baseValue: parseFloat(data.base_value) || 0,
    amendmentCount: data.amendment_count || 0,
    amendmentsTotal: parseFloat(data.amendments_total) || 0,
    ceiling: parseFloat(data.ceiling) || 0,
    hasAmendments: data.has_amendments || false,
    totalSpent: parseFloat(data.total_spent) || 0,
    remaining: parseFloat(data.remaining) || 0,
  };
}
