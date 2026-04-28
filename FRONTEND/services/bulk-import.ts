/**
 * CONVERA Bulk Import Service
 * v2 (P0.3) — chunked upsert (PATTERN D)
 *   - Eliminates N+1 INSERT loops (16-20x faster)
 *   - Idempotent via upsert with conflict resolution
 *   - Per-chunk progress callback
 *   - Structured error handling (partial-success preserved)
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

const CHUNK_SIZE = 50;

export type ImportProgressCallback = (info: {
  phase: string;
  chunkIndex: number;
  totalChunks: number;
  rowsProcessed: number;
  totalRows: number;
  successCount: number;
}) => void;

interface ImportMetrics {
  totalRows: number;
  totalChunks: number;
  successfulChunks: number;
  failedChunks: number;
  durationMs: number;
}

const EMPTY_METRICS: ImportMetrics = {
  totalRows: 0,
  totalChunks: 0,
  successfulChunks: 0,
  failedChunks: 0,
  durationMs: 0,
};

// ─── Import Types ──────────────────────────────────────────────

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
  contract_no: string;
  item_no: number;
  description: string;
  description_ar?: string;
  unit: string;
  unit_price: number;
  contractual_qty: number;
  progress_model?: string;
}

export interface ImportStaffRow {
  contract_no: string;
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
  status: string;
  reference_no?: string;
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
  contracts: { imported: number; errors: string[]; metrics?: ImportMetrics };
  boqTemplates: { imported: number; errors: string[]; metrics?: ImportMetrics };
  staffTemplates: { imported: number; errors: string[]; metrics?: ImportMetrics };
  claims: { imported: number; errors: string[]; metrics?: ImportMetrics };
  claimBOQItems: { imported: number; errors: string[]; metrics?: ImportMetrics };
}

// ─── Internal Helpers ───────────────────────────────────────────

type Row = Record<string, unknown>;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

async function chunkedUpsert(
  table: string,
  rows: Row[],
  onConflict: string,
  phase: string,
  onProgress?: ImportProgressCallback,
): Promise<{ imported: number; errors: string[]; metrics: ImportMetrics }> {
  const start = Date.now();
  const errors: string[] = [];
  let imported = 0;
  let successfulChunks = 0;
  let failedChunks = 0;

  if (rows.length === 0) {
    return { imported: 0, errors: [], metrics: { ...EMPTY_METRICS, durationMs: Date.now() - start } };
  }

  const supabase = createBrowserSupabase();
  const chunks = chunk(rows, CHUNK_SIZE);

  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    try {
      const { data, error } = await supabase
        .from(table)
        .upsert(c, { onConflict, ignoreDuplicates: false })
        .select('*');

      if (error) {
        failedChunks++;
        errors.push(
          '[' + phase + '] دفعة ' + (i + 1) + '/' + chunks.length +
          ' فشلت (' + c.length + ' صف): ' + error.message,
        );
      } else {
        successfulChunks++;
        imported += data?.length ?? c.length;
      }
    } catch (e: unknown) {
      failedChunks++;
      const msg = e instanceof Error ? e.message : String(e);
      errors.push('[' + phase + '] دفعة ' + (i + 1) + '/' + chunks.length + ' استثناء: ' + msg);
    }

    if (onProgress) {
      onProgress({
        phase,
        chunkIndex: i + 1,
        totalChunks: chunks.length,
        rowsProcessed: Math.min((i + 1) * CHUNK_SIZE, rows.length),
        totalRows: rows.length,
        successCount: imported,
      });
    }
  }

  return {
    imported,
    errors,
    metrics: {
      totalRows: rows.length,
      totalChunks: chunks.length,
      successfulChunks,
      failedChunks,
      durationMs: Date.now() - start,
    },
  };
}

async function resolveContractIds(contractNos: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (contractNos.length === 0) return map;
  const supabase = createBrowserSupabase();
  const unique = Array.from(new Set(contractNos));
  const { data } = await supabase
    .from('contracts')
    .select('id, contract_no')
    .in('contract_no', unique);
  for (const c of data ?? []) {
    map.set(c.contract_no as string, c.id as string);
  }
  return map;
}

interface BOQTemplateMeta {
  description?: string | null;
  description_ar?: string | null;
  unit?: string | null;
  unit_price?: number | null;
  contractual_qty?: number | null;
}

async function resolveBOQTemplates(contractIds: string[]): Promise<Map<string, BOQTemplateMeta>> {
  const map = new Map<string, BOQTemplateMeta>();
  if (contractIds.length === 0) return map;
  const supabase = createBrowserSupabase();
  const unique = Array.from(new Set(contractIds));
  const { data } = await supabase
    .from('contract_boq_templates')
    .select('contract_id, item_no, description, description_ar, unit, unit_price, contractual_qty')
    .in('contract_id', unique);
  for (const r of data ?? []) {
    map.set(r.contract_id + ':' + r.item_no, {
      description: r.description as string,
      description_ar: r.description_ar as string,
      unit: r.unit as string,
      unit_price: r.unit_price as number,
      contractual_qty: r.contractual_qty as number,
    });
  }
  return map;
}

// ─── Public Bulk Import Functions ─────────────────────────────

export async function importContracts(
  rows: ImportContractRow[],
  _importedBy: string,
  onProgress?: ImportProgressCallback,
): Promise<ApiResponse<{ imported: number; errors: string[]; metrics: ImportMetrics }>> {
  try {
    const payload: Row[] = rows.map(row => ({
      contract_no: row.contract_no,
      title: row.title,
      title_ar: row.title_ar || row.title,
      type: row.type || 'consultancy',
      status: 'active',
      party_name: row.party_name,
      party_name_ar: row.party_name_ar || row.party_name,
      party_tax_no: row.party_tax_no || null,
      base_value: row.base_value,
      retention_pct: row.retention_pct ?? 10,
      boq_progress_model: row.boq_progress_model || 'count',
      start_date: row.start_date,
      end_date: row.end_date,
      duration_months: row.duration_months || 12,
      region: row.region || null,
      is_imported: true,
    }));
    const result = await chunkedUpsert('contracts', payload, 'contract_no', 'contracts', onProgress);
    return { data: result, success: true };
  } catch (error) {
    return createErrorResponse(friendlyError(error));
  }
}

export async function importBOQTemplates(
  rows: ImportBOQRow[],
  onProgress?: ImportProgressCallback,
): Promise<ApiResponse<{ imported: number; errors: string[]; metrics: ImportMetrics }>> {
  try {
    if (rows.length === 0) {
      return { data: { imported: 0, errors: [], metrics: EMPTY_METRICS }, success: true };
    }
    const contractMap = await resolveContractIds(rows.map(r => r.contract_no));
    const errors: string[] = [];
    const valid: Row[] = [];
    for (const item of rows) {
      const contractId = contractMap.get(item.contract_no);
      if (!contractId) {
        errors.push('قالب BOQ: العقد ' + item.contract_no + ' غير موجود');
        continue;
      }
      valid.push({
        contract_id: contractId,
        item_no: item.item_no,
        description: item.description,
        description_ar: item.description_ar || item.description,
        unit: item.unit,
        unit_price: item.unit_price,
        contractual_qty: item.contractual_qty,
        progress_model: item.progress_model || null,
        sort_order: item.item_no,
      });
    }
    const result = await chunkedUpsert('contract_boq_templates', valid, 'contract_id,item_no', 'boq_templates', onProgress);
    return {
      data: { imported: result.imported, errors: errors.concat(result.errors), metrics: result.metrics },
      success: true,
    };
  } catch (error) {
    return createErrorResponse(friendlyError(error));
  }
}

export async function importStaffTemplates(
  rows: ImportStaffRow[],
  onProgress?: ImportProgressCallback,
): Promise<ApiResponse<{ imported: number; errors: string[]; metrics: ImportMetrics }>> {
  try {
    if (rows.length === 0) {
      return { data: { imported: 0, errors: [], metrics: EMPTY_METRICS }, success: true };
    }
    const contractMap = await resolveContractIds(rows.map(r => r.contract_no));
    const errors: string[] = [];
    const valid: Row[] = [];
    for (const item of rows) {
      const contractId = contractMap.get(item.contract_no);
      if (!contractId) {
        errors.push('قالب الكادر: العقد ' + item.contract_no + ' غير موجود');
        continue;
      }
      valid.push({
        contract_id: contractId,
        item_no: item.item_no,
        position: item.position,
        position_ar: item.position_ar || item.position,
        monthly_rate: item.monthly_rate,
        contract_months: item.contract_months,
        sort_order: item.item_no,
      });
    }
    const result = await chunkedUpsert('contract_staff_templates', valid, 'contract_id,item_no', 'staff_templates', onProgress);
    return {
      data: { imported: result.imported, errors: errors.concat(result.errors), metrics: result.metrics },
      success: true,
    };
  } catch (error) {
    return createErrorResponse(friendlyError(error));
  }
}

export async function importHistoricalClaims(
  claimRows: ImportClaimRow[],
  boqRows: ImportClaimBOQRow[],
  importedBy: string,
  onProgress?: ImportProgressCallback,
): Promise<ApiResponse<{
  claims: number;
  boqItems: number;
  errors: string[];
  metrics: { claims: ImportMetrics; boqItems: ImportMetrics };
}>> {
  try {
    if (claimRows.length === 0) {
      return {
        data: { claims: 0, boqItems: 0, errors: [], metrics: { claims: EMPTY_METRICS, boqItems: EMPTY_METRICS } },
        success: true,
      };
    }

    const contractMap = await resolveContractIds(claimRows.map(r => r.contract_no));
    const errors: string[] = [];
    const validClaims: Row[] = [];
    const skippedKeys = new Set<string>();
    const nowIso = new Date().toISOString();

    for (const row of claimRows) {
      const contractId = contractMap.get(row.contract_no);
      if (!contractId) {
        errors.push('مطالبة ' + row.contract_no + '/' + row.claim_no + ': العقد غير موجود');
        skippedKeys.add(row.contract_no + ':' + row.claim_no);
        continue;
      }
      validClaims.push({
        claim_no: row.claim_no,
        contract_id: contractId,
        reference_no: row.reference_no || null,
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
        updated_by: importedBy,
        submitted_by: importedBy,
        submitted_at: nowIso,
        reviewed_by: importedBy,
        reviewed_at: nowIso,
        approved_by: importedBy,
        approved_at: nowIso,
      });
    }

    const claimsResult = await chunkedUpsert('claims', validClaims, 'contract_id,claim_no', 'claims', onProgress);
    errors.push(...claimsResult.errors);

    const supabase = createBrowserSupabase();
    const distinctContractIds = Array.from(new Set(validClaims.map(c => c.contract_id as string)));
    const claimsForBOQ = new Map<string, string>();
    if (distinctContractIds.length > 0) {
      const { data: claimRecords } = await supabase
        .from('claims')
        .select('id, contract_id, claim_no')
        .in('contract_id', distinctContractIds);
      for (const c of claimRecords ?? []) {
        claimsForBOQ.set(c.contract_id + ':' + c.claim_no, c.id as string);
      }
    }

    const boqMeta = await resolveBOQTemplates(distinctContractIds);
    const validBOQ: Row[] = [];

    for (const boq of boqRows) {
      if (skippedKeys.has(boq.contract_no + ':' + boq.claim_no)) continue;
      const contractId = contractMap.get(boq.contract_no);
      if (!contractId) {
        errors.push('BOQ ' + boq.contract_no + '/' + boq.claim_no + '/' + boq.item_no + ': العقد غير موجود');
        continue;
      }
      const claimId = claimsForBOQ.get(contractId + ':' + boq.claim_no);
      if (!claimId) {
        errors.push('BOQ ' + boq.contract_no + '/' + boq.claim_no + '/' + boq.item_no + ': المطالبة غير موجودة');
        continue;
      }
      const tpl = boqMeta.get(contractId + ':' + boq.item_no);
      validBOQ.push({
        claim_id: claimId,
        item_no: boq.item_no,
        description: tpl?.description || ('بند ' + boq.item_no),
        description_ar: tpl?.description_ar || null,
        unit: tpl?.unit || 'وحدة',
        unit_price: tpl?.unit_price ?? 0,
        contractual_qty: tpl?.contractual_qty ?? 0,
        prev_progress: boq.prev_progress || 0,
        curr_progress: boq.curr_progress || 0,
        period_amount: boq.period_amount || 0,
        performance_pct: boq.performance_pct || 100,
        after_perf: boq.period_amount || 0,
        cumulative: (boq.prev_progress || 0) + (boq.curr_progress || 0),
      });
    }

    const boqResult = await chunkedUpsert('claim_boq_items', validBOQ, 'claim_id,item_no', 'claim_boq_items', onProgress);
    errors.push(...boqResult.errors);

    return {
      data: {
        claims: claimsResult.imported,
        boqItems: boqResult.imported,
        errors,
        metrics: { claims: claimsResult.metrics, boqItems: boqResult.metrics },
      },
      success: true,
    };
  } catch (error) {
    return createErrorResponse(friendlyError(error));
  }
}

export const __internals = { chunk, CHUNK_SIZE };
