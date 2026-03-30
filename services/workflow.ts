import { createBrowserSupabase } from '@/lib/supabase';
import type { ClaimWorkflow } from '@/lib/types';

export async function fetchClaimWorkflow(claimId: string): Promise<ClaimWorkflow[]> {
  const supabase = createBrowserSupabase();

  const { data, error } = await supabase
    .from('claim_workflow')
    .select('*')
    .eq('claim_id', claimId)
    .order('created_at');

  if (error) throw error;

  return (data || []) as ClaimWorkflow[];
}

export async function submitClaim(claimId: string): Promise<void> {
  const supabase = createBrowserSupabase();

  const { error } = await supabase
  
  ;your submission logic here
  if (error) throw error;
}

export async function approveClaim(claimId: string): Promise<void> {
  const supabase = createBrowserSupabase();
  const { error } = await supabase
    .from('claims')
    .update({ status: 'approved' })
    .eq('id', claimId);

  if (error) throw error;
}
