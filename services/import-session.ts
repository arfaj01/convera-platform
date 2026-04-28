/**
 * CONVERA Import Session (P1.1 Governance Layer)
 *
 * Wraps a bulk import inside an auditable "import session":
 *   1. Insert imports row (status='pending')
 *   2. Run validator → status='validating', persist any errors
 *   3. Run chunked upsert → status='running'
 *   4. Finalize → status='completed' | 'partial' | 'failed'
 *
 * The session row in the `imports` table is the durable audit
 * record of the import attempt. Row-level errors live in
 * `import_errors` and are linked back via import_id.
 *
 * IMPORTANT: This module does NOT replace the low-level functions
 * in bulk-import.ts (importContracts, importBOQTemplates, etc.).
 * It composes them. Call sites that don't want governance can keep
 * using bulk-import directly. Call sites that do want governance
 * should call the *WithSession variants here.
 */

import { createBrowserSupabase } from '@/lib/supabase';
import {
  importContracts,
  importBOQTemplates,
  importStaffTemplates,
  importHistoricalClaims,
  type ImportContractRow,
  type ImportBOQRow,
  type ImportStaffRow,
  type ImportClaimRow,
  type ImportClaimBOQRow,
  type ImportProgressCallback,
} from './bulk-import';
import {
  validateContracts,
  validateBOQTemplates,
  validateStaffTemplates,
  validateHistoricalClaims,
  type ValidationError,
} from './import-validator';

// ─── Types ──────────────────────────────────────────────────────

export type ImportSourcePhase =
  | 'contracts'
  | 'boq_templates'
  | 'staff_templates'
  | 'historical_claims';

export type ImportStatus =
  | 'pending'
  | 'validating'
  | 'running'
  | 'completed'
  | 'partial'
  | 'failed';

export interface ImportSessionContext {
  importId: string;
  userId: string;
  sourcePhase: ImportSourcePhase;
}

export interface SessionImportSummary {
  importId: string;
  status: ImportStatus;
  totalRows: number;
  successRows: number;
  failedRows: number;
  validationErrors: ValidationError[];
  runtimeErrors: string[];   // chunked upsert errors (DB level)
  durationMs: number;
}

// ─── Session lifecycle helpers ──────────────────────────────────

export async function startImportSession(opts: {
  fileName: string;
  fileSize?: number;
  totalRows: number;
  sourcePhase: ImportSourcePhase;
  userId: string;
  contractId?: string;
  notes?: string;
}): Promise<ImportSessionContext> {
  const supabase = createBrowserSupabase();
  const { data, error } = await supabase
    .from('imports')
    .insert({
      file_name: opts.fileName,
      file_size: opts.fileSize ?? null,
      source_phase: opts.sourcePhase,
      total_rows: opts.totalRows,
      status: 'pending',
      created_by: opts.userId,
      started_at: new Date().toISOString(),
      contract_id: opts.contractId ?? null,
      notes: opts.notes ?? null,
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error('Failed to create import session: ' + (error?.message ?? 'no row returned'));
  }
  return { importId: data.id as string, userId: opts.userId, sourcePhase: opts.sourcePhase };
}

async function updateImportStatus(importId: string, status: ImportStatus): Promise<void> {
  const supabase = createBrowserSupabase();
  await supabase.from('imports').update({ status }).eq('id', importId);
}

export async function recordValidationErrors(
  importId: string,
  errors: ValidationError[],
): Promise<void> {
  if (errors.length === 0) return;
  const supabase = createBrowserSupabase();
  const rows = errors.map(e => ({
    import_id: importId,
    row_index: e.rowIndex,
    field_name: e.fieldName ?? null,
    field_value: e.fieldValue ?? null,
    error_type: e.errorType,
    error_code: e.errorCode,
    error_message: e.errorMessage,
    error_message_ar: e.errorMessageAr ?? null,
  }));
  // Chunk to keep payloads small
  const chunkSize = 100;
  for (let i = 0; i < rows.length; i += chunkSize) {
    await supabase.from('import_errors').insert(rows.slice(i, i + chunkSize));
  }
}

export async function recordRuntimeErrors(
  importId: string,
  runtimeErrors: string[],
): Promise<void> {
  if (runtimeErrors.length === 0) return;
  const supabase = createBrowserSupabase();
  const rows = runtimeErrors.map(msg => ({
    import_id: importId,
    row_index: 0,                  // 0 = chunk-level / non-row-specific
    field_name: null,
    field_value: null,
    error_type: 'database',
    error_code: 'CHUNK_FAILED',
    error_message: msg,
    error_message_ar: msg,
  }));
  await supabase.from('import_errors').insert(rows);
}

export async function completeImportSession(
  importId: string,
  opts: {
    successRows: number;
    failedRows: number;
    totalChunks: number;
    successfulChunks: number;
    failedChunks: number;
    durationMs: number;
    finalStatus?: ImportStatus;
  },
): Promise<void> {
  const status: ImportStatus = opts.finalStatus
    ?? (opts.failedRows === 0 && opts.failedChunks === 0
      ? 'completed'
      : opts.successRows > 0
        ? 'partial'
        : 'failed');

  const supabase = createBrowserSupabase();
  await supabase
    .from('imports')
    .update({
      success_rows: opts.successRows,
      failed_rows: opts.failedRows,
      total_chunks: opts.totalChunks,
      successful_chunks: opts.successfulChunks,
      failed_chunks: opts.failedChunks,
      duration_ms: opts.durationMs,
      status,
      completed_at: new Date().toISOString(),
    })
    .eq('id', importId);
}

// ─── High-level orchestrators (validate → import → record) ──────

export async function importContractsWithSession(
  rows: ImportContractRow[],
  userId: string,
  fileName: string,
  onProgress?: ImportProgressCallback,
): Promise<SessionImportSummary> {
  const t0 = Date.now();
  const session = await startImportSession({
    fileName,
    totalRows: rows.length,
    sourcePhase: 'contracts',
    userId,
  });

  await updateImportStatus(session.importId, 'validating');
  const validation = validateContracts(rows);
  await recordValidationErrors(session.importId, validation.errors);

  await updateImportStatus(session.importId, 'running');
  const result = await importContracts(validation.validRows, userId, onProgress);
  const data = result.data;

  const successRows = data?.imported ?? 0;
  const runtimeErrors = data?.errors ?? (result.error ? [result.error] : []);
  await recordRuntimeErrors(session.importId, runtimeErrors);

  const failedRows = validation.errors.length + Math.max(0, validation.validRows.length - successRows);
  const metrics = data?.metrics ?? { totalChunks: 0, successfulChunks: 0, failedChunks: 0, totalRows: 0, durationMs: 0 };

  await completeImportSession(session.importId, {
    successRows,
    failedRows,
    totalChunks: metrics.totalChunks,
    successfulChunks: metrics.successfulChunks,
    failedChunks: metrics.failedChunks,
    durationMs: Date.now() - t0,
  });

  return {
    importId: session.importId,
    status: failedRows === 0 ? 'completed' : successRows > 0 ? 'partial' : 'failed',
    totalRows: rows.length,
    successRows,
    failedRows,
    validationErrors: validation.errors,
    runtimeErrors,
    durationMs: Date.now() - t0,
  };
}

export async function importBOQTemplatesWithSession(
  rows: ImportBOQRow[],
  userId: string,
  fileName: string,
  onProgress?: ImportProgressCallback,
): Promise<SessionImportSummary> {
  const t0 = Date.now();
  const session = await startImportSession({
    fileName,
    totalRows: rows.length,
    sourcePhase: 'boq_templates',
    userId,
  });

  await updateImportStatus(session.importId, 'validating');
  const validation = await validateBOQTemplates(rows);
  await recordValidationErrors(session.importId, validation.errors);

  await updateImportStatus(session.importId, 'running');
  const result = await importBOQTemplates(validation.validRows, onProgress);
  const data = result.data;

  const successRows = data?.imported ?? 0;
  const runtimeErrors = data?.errors ?? (result.error ? [result.error] : []);
  await recordRuntimeErrors(session.importId, runtimeErrors);

  const failedRows = validation.errors.length + Math.max(0, validation.validRows.length - successRows);
  const metrics = data?.metrics ?? { totalChunks: 0, successfulChunks: 0, failedChunks: 0, totalRows: 0, durationMs: 0 };

  await completeImportSession(session.importId, {
    successRows,
    failedRows,
    totalChunks: metrics.totalChunks,
    successfulChunks: metrics.successfulChunks,
    failedChunks: metrics.failedChunks,
    durationMs: Date.now() - t0,
  });

  return {
    importId: session.importId,
    status: failedRows === 0 ? 'completed' : successRows > 0 ? 'partial' : 'failed',
    totalRows: rows.length,
    successRows,
    failedRows,
    validationErrors: validation.errors,
    runtimeErrors,
    durationMs: Date.now() - t0,
  };
}

export async function importStaffTemplatesWithSession(
  rows: ImportStaffRow[],
  userId: string,
  fileName: string,
  onProgress?: ImportProgressCallback,
): Promise<SessionImportSummary> {
  const t0 = Date.now();
  const session = await startImportSession({
    fileName,
    totalRows: rows.length,
    sourcePhase: 'staff_templates',
    userId,
  });

  await updateImportStatus(session.importId, 'validating');
  const validation = await validateStaffTemplates(rows);
  await recordValidationErrors(session.importId, validation.errors);

  await updateImportStatus(session.importId, 'running');
  const result = await importStaffTemplates(validation.validRows, onProgress);
  const data = result.data;

  const successRows = data?.imported ?? 0;
  const runtimeErrors = data?.errors ?? (result.error ? [result.error] : []);
  await recordRuntimeErrors(session.importId, runtimeErrors);

  const failedRows = validation.errors.length + Math.max(0, validation.validRows.length - successRows);
  const metrics = data?.metrics ?? { totalChunks: 0, successfulChunks: 0, failedChunks: 0, totalRows: 0, durationMs: 0 };

  await completeImportSession(session.importId, {
    successRows,
    failedRows,
    totalChunks: metrics.totalChunks,
    successfulChunks: metrics.successfulChunks,
    failedChunks: metrics.failedChunks,
    durationMs: Date.now() - t0,
  });

  return {
    importId: session.importId,
    status: failedRows === 0 ? 'completed' : successRows > 0 ? 'partial' : 'failed',
    totalRows: rows.length,
    successRows,
    failedRows,
    validationErrors: validation.errors,
    runtimeErrors,
    durationMs: Date.now() - t0,
  };
}

export async function importHistoricalClaimsWithSession(
  claimRows: ImportClaimRow[],
  boqRows: ImportClaimBOQRow[],
  userId: string,
  fileName: string,
  onProgress?: ImportProgressCallback,
): Promise<SessionImportSummary> {
  const t0 = Date.now();
  const session = await startImportSession({
    fileName,
    totalRows: claimRows.length + boqRows.length,
    sourcePhase: 'historical_claims',
    userId,
  });

  await updateImportStatus(session.importId, 'validating');
  const validation = await validateHistoricalClaims(claimRows, boqRows);
  const allValidationErrors = validation.claims.errors.concat(validation.boq.errors);
  await recordValidationErrors(session.importId, allValidationErrors);

  await updateImportStatus(session.importId, 'running');
  const result = await importHistoricalClaims(
    validation.claims.validRows,
    validation.boq.validRows,
    userId,
    onProgress,
  );
  const data = result.data;

  const successRows = (data?.claims ?? 0) + (data?.boqItems ?? 0);
  const runtimeErrors = data?.errors ?? (result.error ? [result.error] : []);
  await recordRuntimeErrors(session.importId, runtimeErrors);

  const validatedTotal = validation.claims.validRows.length + validation.boq.validRows.length;
  const failedRows = allValidationErrors.length + Math.max(0, validatedTotal - successRows);

  const totalChunks = (data?.metrics.claims.totalChunks ?? 0) + (data?.metrics.boqItems.totalChunks ?? 0);
  const successfulChunks = (data?.metrics.claims.successfulChunks ?? 0) + (data?.metrics.boqItems.successfulChunks ?? 0);
  const failedChunks = (data?.metrics.claims.failedChunks ?? 0) + (data?.metrics.boqItems.failedChunks ?? 0);

  await completeImportSession(session.importId, {
    successRows,
    failedRows,
    totalChunks,
    successfulChunks,
    failedChunks,
    durationMs: Date.now() - t0,
  });

  return {
    importId: session.importId,
    status: failedRows === 0 ? 'completed' : successRows > 0 ? 'partial' : 'failed',
    totalRows: claimRows.length + boqRows.length,
    successRows,
    failedRows,
    validationErrors: allValidationErrors,
    runtimeErrors,
    durationMs: Date.now() - t0,
  };
}
