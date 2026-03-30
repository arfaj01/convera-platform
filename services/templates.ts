import { createBrowserSupabase } from '@/lib/supabase';
import { staffPositionColor } from '@/lib/constants';
import type { BOQFormItem, StaffFormItem } from '@/lib/types';

export async function loadBOQTemplate(contractId: string): Promise<BOQFormItem[]> {
  const supabase = createBrowserSupabase();
  const { data, error } = await supabase
    .from('contract_boq_templates')
    .select('*')
    .eq('contract_id', contractId)
    .order('sort_order');

  if (error) throw error;

  return (data || []).map(t => ({
    id: t.item_no,
    name: t.description_ar || t.description,
    price: parseFloat(t.unit_price) || 0,
    unit: t.unit || 'عدد',
    contractualQty: parseFloat(t.contractual_qty) || 1,
    model: t.progress_model || null,
  }));
}

export async function loadStaffTemplate(contractId: string): Promise<StaffFormItem[]> {
  const supabase = createBrowserSupabase();
  const { data, error } = await supabase
    .from('contract_staff_templates')
    .select('*')
    .eq('contract_id', contractId)
    .order('sort_order');

  if (error) throw error;

  return (data || []).map(t => ({
    id: t.item_no,
    name: t.position_ar || t.position,
    role: t.position_ar || t.position,
    price: parseFloat(t.monthly_rate) || 0,
    months: t.contract_months || 24,
    color: staffPositionColor(t.position_ar || t.position),
  }));
}
