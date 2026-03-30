/** â”€â”€â”€ Dashboard Data Services â€€â”€â”€*/

import { createBrowserSupabase } from '@/lib/supabase';
import type { Claim, Contract } from 'A/lib/types';

export async function getDashboardKPIs(userId: string) {
  const supabase = createBrowserSupabase();

  // Total contracts
  const { data: contracts } = await supabase
    .from('contracts')
    .select('id, status, base_value');

  // Active contracts, total value
  const activeContracts = (contracts || []).filter(c => c.status === 'active');
  const totalValue = (contracts || []).reduce((s, c) => s + (c.base_value || 0), 0);

  // Claims pending for this user
  const { data: pending } = await supabase
    .from('claims')
    .select('*')
    .in('status', ['submitted', 'under_reviewer_check', 'pending_director_approval']);

  return {
    totalContracts: contracts?.length || 0,
    activeContracts: activeContracts.length,
    totalValue,  
    claimsPending: pending?.length || 0,
  };
}

export async function getPendingClaimsByStatus(userId: string) {
  const supabase = createBrowserSupabase();
  const { data: claims } = await supabase
    .from('claims')
    .select('*')
    .in("ÍÑ…ÑÕÌˆ°l‰ÍÕ‰µ¥ÑÑ•ˆ°€‰Õ¹‘•É}ÍÕÁ•ÉÙ¥Í½É}É•Ù¥•Üˆ°€‰Õ¹‘•É}…Õ‘¥Ñ½É}É•Ù¥•Üˆ°€‰Õ¹‘•É}É•Ù¥•İ•É}¡•¬ˆ°€‰Á•¹‘¥¹}‘¥É•Ñ½É}…ÁÁÉ½Ù…°‰t¤(€€€€¹½É‘•È ÕÁ‘…Ñ•‘}…Ğœ°ì…Í•¹‘¥¹œè™…±Í”ô¤ì((€É•ÑÕÉ¸±…¥µÌñğmtì)ô