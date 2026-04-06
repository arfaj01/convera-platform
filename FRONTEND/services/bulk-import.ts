/**
 * CONVERA Bulk Import Service
 * Handles Excel-based bulk import for contracts, BOQ, staff, and historical claims
 * Migration 040: is_imported + is_historical flags
 */

import { createBrowserSupabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/errors';

interface ApiResponse<T> {
  data?: T;
  error?: string;
  success: boolean;
}

function createErrorResponse<T>(error: string): ApiResponse<T> {
  return { data: undefined as unknown as T, error, success: false };
}

// ─── Import Types ───────────────────────────────────────────────

export interface ImportContractRow {
  contract_no: string;
  title: string;
  title_ar?: string;
  type: string;
  party_name: string;
  party_name_ar?: string;
  party_tax_no?: string;
  base_value: number;
  retention_pct: number;
  boq_progress_model: string;
  start_date: string;
  end_date: string;
  duration_months: number;
  region?: string;
}

export interface ImportBOQRow {
  contract_no: string; // Linked by contract_no
  item_no: number;
  description: string;
  description_ar?: string;
  unit: string;
  unit_price: number;
  contractual_qty: number;
  progress_model?: string;
}

export interface ImportStaffRow {
  contract_no: string; // Linked by contract_no
  item_no: number;
  position: string;
  position_ar?: string;
  monthly_rate: number;
  contract_months: number;
}

export interface ImportClaimRow {
  contract_no: string;
  claim_no: number;
  period_from: string;
  period_to: string;
  boq_amount: number;
  staff_amount: number;
  retention_amount: number;
  vat_amount: number;
  status: string; // 'approved' or 'closed'
}

export interface ImportClaimBOQRow {
  contract_no: string;
  claim_no: number;
  item_no: number;
  prev_progress: number;
  curr_progress: number;
  period_amount: number;
  performance_pct: number;
}

export interface ImportResult {
  contracts: { imported: number; errors: string[] };
  boqTemplates: { imported: number; errors: string[] };
  staffTemplates: { imported: number; errors: string[] };
  claims: { imported: number; errors: string[] };
  claimBOQItems: { imported: number; errors: string[] };
}

// ─── Bulk Import Functions ──────────────────────────────────────

/**
 * Import contracts from parsed Excel data
 */
export async function importContracts(
  rows: ImportContractRow[],
  importedBy: string,
): Promise<ApiResponse<{ imported: number; errors: string[] }>> {
  try {
    const supabase = createBrowserSupabase();
    const errors: string[] = [];
    let imported = 0;

    for (const row of rows) {
      try {
        const { error } = await supabase.from('contracts').insert({
          contract_no: row.contract_no,
          title: row.title,
          title_ar: row.title_ar || row.title,
          type: row.type || 'consultancy',
          status: 'active',
          party_name: row.party_name,
          party_name_ar: row.party_name_ar || row.party_name,
          party_tax_no: row.party_tax_no || null,
          base_value: row.base_value,
          retention_pct: row.retention_pct || 10,
          boq_progress_model: row.boq_progress_model || 'count',
          start_date: row.start_date,
          end_date: row.end_date,
          duration_months: row.duration_months || 12,
          region: row.region || null,
          is_imported: true,
        });

        if (error) {
          errors.push(`عقد ${row.contract_no}: ${error.message}`);
        } else {
          imported++;
        }
      } catch (e: any) {
        errors.push(`عقد ${row.contract_no}: ${e.message}`);
      }
    }

    return { data: { imported, errors }, success: true };
  } catch (error) {
    return createErrorResponse(friendlyError(error));
  }
}

/**
 * Import BOQ templates from parsed Excel data
 */
export async function importBOQTemplates(
  rows: ImportBOQRow[],
): Promise<ApiResponse<{ imported: number; errors: string[] }>> {
  try {
    const supabase = createBrowserSupabase();
    const errors: string[] = [];
    let imported = 0;

    // Group by contract_no to resolve contract_id
    const byContract = new Map<string, ImportBOQRow[]>();
    for (const row of rows) {
      const existing = byContract.get(row.contract_no) || [];
      existing.push(row);
      byContract.set(row.contract_no, existing);
    }

    for (const [contractNo, items] of byContract) {
      // Resolve contract_id
      const { data: contract } = await supabase
        .from('contracts')
        .select('id')
        .eq('contract_no', contractNo)
        .maybeSingle();

      if (!contract) {
        errors.push(`قالب BOQ: العقد ${contractNo} غير موجود`);
        continue;
      }

      for (const item of items) {
        try {
          const { error } = await supabase.from('contract_boq_templates').insert({
            contract_id: contract.id,
            item_no: item.item_no,
            description: item.description,
            description_ar: item.description_ar || item.description,
            unit: item.unit,
            unit_price: item.unit_price,
            contractual_qty: item.contractual_qty,
            progress_model: item.progress_model || null,
            sort_order: item.item_no,
          });

          if (error) {
            errors.push(`BOQ ${contractNo}/${item.item_no}: ${error.message}`);
          } else {
            imported++;
          }
        } catch (e: any) {
          errors.push(`BOQ ${contractNo}/${item.item_no}: ${e.message}`);
        }
      }
    }

    return { data: { imported, errors }, success: true };
  } catch (error) {
    return createErrorResponse(friendlyError(error));
  }
}

/**
 * Import staff templates from parsed Excel data
 */
export async function importStaffTemplates(
  rows: ImportStaffRow[],
): Promise<ApiResponse<{ imported: number; errors: string[] }>> {
  try {
    const supabase = createBrowserSupabase();
    const errors: string[] = [];
    let imported = 0;

    const byContract = new Map<string, ImportStaffRow[]>();
    for (const row of rows) {
      const existing = byContract.get(row.contract_no) || [];
      existing.push(row);
      byContract.set(row.contract_no, existing);
    }

    for (const [contractNo, items] of byContract) {
      const { data: contract } = await supabase
        .from('contracts')
        .select('id')
        .eq('contract_no', contractNo)
        .maybeSingle();

      if (!contract) {
        errors.push(`قالب الكادر: العقد ${contractNo} غير موجود`);
        continue;
      }

      for (const item of items) {
        try {
          const { error } = await supabase.from('contract_staff_templates').insert({
            contract_id: contract.id,
            item_no: item.item_no,
            position: item.position,
            position_ar: item.position_ar || item.position,
            monthly_rate: item.monthly_rate,
            contract_months: item.contract_months,
            sort_order: item.item_no,
          });

          if (error) {
            errors.push(`كادر ${contractNo}/${item.item_no}: ${error.message}`);
          } else {
            imported++;
          }
        } catch (e: any) {
          errors.push(`كادر ${contractNo}/${item.item_no}: ${e.message}`);
        }
      }
    }

    return { data: { imported, errors }, success: true };
  } catch (error) {
    return createErrorResponse(friendlyError(error));
  }
}

/**
 * Import historical claims from parsed Excel data
 */
export async function importHistoricalClaims(
  claimRows: ImportClaimRow[],
  boqRows: ImportClaimBOQRow[],
  importedBy: string,
): Promise<ApiResponse<{ claims: number; boqItems: number; errors: string[] }>> {
  try {
    const supabase = createBrowserSupabase();
    const errors: string[] = [];
    let claimsImported = 0;
    let boqItemsImported = 0;

    for (const row of claimRows) {
      try {
        // Resolve contract_id
        const { data: contract } = await supabase
          .from('contracts')
          .select('id, retention_pct')
          .eq('contract_no', row.contract_no)
          .maybeSingle();

        if (!contract) {
          errors.push(`مطالبة ${row.contract_no}/${row.claim_no}: العقد غير موجود`);
          continue;
        }

        // Insert claim as historical + imported
        const { data: claim, error: claimErr } = await supabase
          .from('claims')
          .insert({
            claim_no: row.claim_no,
            contract_id: contract.id,
            status: row.status || 'approved',
            period_from: row.period_from,
            period_to: row.period_to,
            invoice_date: row.period_to,
            boq_amount: row.boq_amount,
            staff_amount: row.staff_amount || 0,
            retention_amount: row.retention_amount,
            vat_amount: row.vat_amount,
            claim_type: 'boq_only',
            is_imported: true,
            is_historical: true,
            created_by: importedBy,
            submitted_by: importedBy,
            submitted_at: new Date().toISOString(),
            approved_by: importedBy,
            approved_at: new Date().toISOString(),
          })
          .select('id')
          .single();

        if (claimErr) {
          errors.push(`مطالبة ${row.contract_no}/${row.claim_no}: ${claimErr.message}`);
          continue;
        }

        claimsImported++;

        // Insert BOQ items for this claim
        const claimBOQs = boqRows.filter(
          b => b.contract_no === row.contract_no && b.claim_no === row.claim_no,
        );

        for (const boq of claimBOQs) {
          try {
            // Resolve template item for unit_price and description
            const { data: template } = await supabase
              .from('contract_boq_templates')
              .select('description, description_ar, unit, unit_price, contractual_qty')
              .eq('contract_id', contract.id)
              .eq('item_no', boq.item_no)
              .maybeSingle();

            const { error: boqErr } = await supabase
              .from('claim_boq_items')
              .insert({
                claim_id: claim.id,
                item_no: boq.item_no,
                description: template?.description || `بند ${boq.item_no}`,
                description_ar: template?.description_ar || null,
                unit: template?.unit || 'وحدة',
                unit_price: template?.unit_price || 0,
                contractual_qty: template?.contractual_qty || 0,
                prev_progress: boq.prev_progress || 0,
                curr_progress: boq.curr_progress || 0,
                period_amount: boq.period_amount || 0,
                performance_pct: boq.performance_pct || 100,
                after_perf: boq.period_amount || 0,
                cumulative: (boq.prev_progress || 0) + (boq.curr_progress || 0),
              });

            if (boqErr) {
              errors.push(`BOQ ${row.contract_no}/${row.claim_no}/${boq.item_no}: ${boqErr.message}`);
            } else {
              boqItemsImported++;
            }
          } catch (e: any) {
            errors.push(`BOQ ${row.contract_no}/${row.claim_no}/${boq.item_no}: ${e.message}`);
          }
        }
      } catch (e: any) {
        errors.push(`مطالبة ${row.contract_no}/${row.claim_no}: ${e.message}`);
      }
    }

    return {
      data: { claims: claimsImported, boqItems: boqItemsImported, errors },
      success: true,
    };
  } catch (error) {
    return createErrorResponse(friendlyError(error));
  }
}
