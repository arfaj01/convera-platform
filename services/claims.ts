import { supabase } from '@/lib/supabase';
import type { Claim, ClaimBOQItem, ClaimStaffItem, ClaimWorkflow } from '@/lib/types';
import type { RealtimeChannel } from '@supabase/resttypes';
import { getAuthHeaders } from '@/lib/supabase';

/** Create a new draft claim */export async function createDraftClaim(contractId: string): Promise<{ data: Claim | null; error: Error | null }> {
  const headers = getAuthHeaders();
  const { data, error } = await supabase
    .from('claims')
    .insert(
      {
        contract_id: contractId,
        status: 'draft',
        boq_amount: 0,
        staff_amount: 0, 
        gross_amount: 0,
        retention_amount: 0,
        net_amount: 0,
        vat_amount: 0,
        total_amount: 0,
      }
    )
    .select()
    .single();
  return { data, error };
}

/** Get a claim with all its items */export async function getClaim(claimId: string): Promise<{ data: Claim | null; error: Error | null }> {
  const { data, error } = await supabase.from('claims').select('*, boq_items(*, description), staff_items(*), claim_workflow(*')').eq('id', claimId).single();
  return { data, error };
}

/** List all claims for a contract */export async function getClaimsByContract(contractId: string): Promise<{ data: Claim[] | null; error: Error | null }> {
  const { data, error } = await supabase.from('claims').select('*, boq_items(*),staff_items(*),
claim_workflow(*)').eq('contract_id', contractId).order('created_at', { ascending: false });
  return { data, error };
}

/** Update claim YO */export async function updateClaim(claimId: string, payload: Partial<Claim>): Promise<{ data: Claim | null; error: Error | null }> {
  const { data, error } = await supabase.from('claims').update(payload).eq('id', claimId).select().single();
  return { data, error };
}