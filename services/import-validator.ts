/**
 * CONVERA Import Validator (P1.1 Governance Layer)
 *
 * Pre-flight validation that runs BEFORE any DB write.
 * Splits incoming rows into (validRows, errors); the caller
 * decides whether to proceed with valid rows + persist errors
 * to the import_errors table, or abort the whole session.
 *
 * Validation rules:
 *   R1 — Required field presence (string non-empty / number defined)
 *   R2 — Numeric range (no negatives where positives are required)
 *   R3 — Reference integrity (contract exists in DB)
 *   R4 — Scope coherence (BOQ item_no must exist in contract template)
 *   R5 — Duplicate reference_no (within-file AND against existing claims)
 *   R6 — Date format basic (YYYY-MM-DD)
 *
 * No DB writes are performed by this module — only reads to verify
 * references. This keeps validation idempotent and side-effect free.
 */

import { createBrowserSupabase } from '@/lib/supabase';
import type {
  ImportContractRow,
  ImportBOQRow,
  ImportStaffRow,
  ImportClaimRow,
  ImportClaimBOQRow,
} from './bulk-import';

// ─── Types ──────────────────────────────────────────────────────

export interface ValidationError {
  rowIndex: number;          // 1-based position in source file
  fieldName?: string;
  fieldValue?: string;
  errorType: 'validation' | 'reference' | 'duplicate';
  errorCode: string;
  errorMessage: string;
  errorMessageAr: string;
}

export interface ValidationResult<T> {
  validRows: T[];
  validRowIndices: number[]; // 1-based indices of validRows in original input
  errors: ValidationError[];
  totalRows: number;
}

// ─── Helpers ────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isNonNegativeNumber(v: unknown): v is number {
  return isFiniteNumber(v) && v >= 0;
}

function err(
  rowIndex: number,
  fieldName: string,
  fieldValue: unknown,
  errorCode: string,
  errorMessage: string,
  errorMessageAr: string,
  errorType: ValidationError['errorType'] = 'validation',
): ValidationError {
  return {
    rowIndex,
    fieldName,
    fieldValue: fieldValue == null ? '' : String(fieldValue),
    errorType,
    errorCode,
    errorMessage,
    errorMessageAr,
  };
}

// ─── Contract validation ────────────────────────────────────────

export function validateContracts(
  rows: ImportContractRow[],
): ValidationResult<ImportContractRow> {
  const errors: ValidationError[] = [];
  const validRows: ImportContractRow[] = [];
  const validRowIndices: number[] = [];
  const seenContractNos = new Set<string>();

  rows.forEach((row, idx) => {
    const i = idx + 1;
    const rowErrors: ValidationError[] = [];

    if (!isNonEmptyString(row.contract_no)) {
      rowErrors.push(err(i, 'contract_no', row.contract_no, 'MISSING_REQUIRED',
        'contract_no is required', 'رقم العقد مطلوب'));
    } else if (seenContractNos.has(row.contract_no)) {
      rowErrors.push(err(i, 'contract_no', row.contract_no, 'DUPLICATE_IN_FILE',
        'Duplicate contract_no within file', 'رقم العقد مكرر داخل الملف', 'duplicate'));
    } else {
      seenContractNos.add(row.contract_no);
    }

    if (!isNonEmptyString(row.title)) {
      rowErrors.push(err(i, 'title', row.title, 'MISSING_REQUIRED',
        'title is required', 'عنوان العقد مطلوب'));
    }
    if (!isNonEmptyString(row.party_name)) {
      rowErrors.push(err(i, 'party_name', row.party_name, 'MISSING_REQUIRED',
        'party_name is required', 'اسم المتعاقد مطلوب'));
    }
    if (!isNonNegativeNumber(row.base_value) || row.base_value <= 0) {
      rowErrors.push(err(i, 'base_value', row.base_value, 'INVALID_NUMBER',
        'base_value must be > 0', 'قيمة العقد يجب أن تكون أكبر من صفر'));
    }
    if (!isFiniteNumber(row.retention_pct) || row.retention_pct < 0 || row.retention_pct > 100) {
      rowErrors.push(err(i, 'retention_pct', row.retention_pct, 'INVALID_NUMBER',
        'retention_pct must be between 0 and 100', 'نسبة الضمان يجب أن تكون بين 0 و 100'));
    }
    if (!isNonEmptyString(row.start_date) || !DATE_RE.test(row.start_date)) {
      rowErrors.push(err(i, 'start_date', row.start_date, 'INVALID_DATE',
        'start_date must be YYYY-MM-DD', 'تاريخ البداية بصيغة YYYY-MM-DD'));
    }
    if (!isNonEmptyString(row.end_date) || !DATE_RE.test(row.end_date)) {
      rowErrors.push(err(i, 'end_date', row.end_date, 'INVALID_DATE',
        'end_date must be YYYY-MM-DD', 'تاريخ النهاية بصيغة YYYY-MM-DD'));
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
    } else {
      validRows.push(row);
      validRowIndices.push(i);
    }
  });

  return { validRows, validRowIndices, errors, totalRows: rows.length };
}

// ─── BOQ template validation ────────────────────────────────────

export async function validateBOQTemplates(
  rows: ImportBOQRow[],
): Promise<ValidationResult<ImportBOQRow>> {
  const errors: ValidationError[] = [];
  const validRows: ImportBOQRow[] = [];
  const validRowIndices: number[] = [];

  // Resolve contracts that exist
  const contractNos = Array.from(new Set(rows.map(r => r.contract_no).filter(isNonEmptyString)));
  const existing = await resolveExistingContractNos(contractNos);

  const seen = new Set<string>(); // contract_no:item_no within file

  rows.forEach((row, idx) => {
    const i = idx + 1;
    const rowErrors: ValidationError[] = [];

    if (!isNonEmptyString(row.contract_no)) {
      rowErrors.push(err(i, 'contract_no', row.contract_no, 'MISSING_REQUIRED',
        'contract_no is required', 'رقم العقد مطلوب'));
    } else if (!existing.has(row.contract_no)) {
      rowErrors.push(err(i, 'contract_no', row.contract_no, 'CONTRACT_NOT_FOUND',
        'Contract not found in DB — import contract first',
        'العقد غير موجود في قاعدة البيانات — يجب ترحيل العقد أولاً', 'reference'));
    }

    if (!isFiniteNumber(row.item_no) || row.item_no <= 0) {
      rowErrors.push(err(i, 'item_no', row.item_no, 'INVALID_NUMBER',
        'item_no must be > 0', 'رقم البند يجب أن يكون أكبر من صفر'));
    }
    if (!isNonEmptyString(row.description)) {
      rowErrors.push(err(i, 'description', row.description, 'MISSING_REQUIRED',
        'description is required', 'وصف البند مطلوب'));
    }
    if (!isNonEmptyString(row.unit)) {
      rowErrors.push(err(i, 'unit', row.unit, 'MISSING_REQUIRED',
        'unit is required', 'الوحدة مطلوبة'));
    }
    if (!isNonNegativeNumber(row.unit_price) || row.unit_price <= 0) {
      rowErrors.push(err(i, 'unit_price', row.unit_price, 'INVALID_NUMBER',
        'unit_price must be > 0', 'سعر الوحدة يجب أن يكون أكبر من صفر'));
    }
    if (!isNonNegativeNumber(row.contractual_qty) || row.contractual_qty <= 0) {
      rowErrors.push(err(i, 'contractual_qty', row.contractual_qty, 'INVALID_NUMBER',
        'contractual_qty must be > 0', 'الكمية التعاقدية يجب أن تكون أكبر من صفر'));
    }

    if (isNonEmptyString(row.contract_no) && isFiniteNumber(row.item_no)) {
      const key = row.contract_no + ':' + row.item_no;
      if (seen.has(key)) {
        rowErrors.push(err(i, 'item_no', row.item_no, 'DUPLICATE_IN_FILE',
          'Duplicate (contract_no,item_no) within file',
          'البند مكرر لنفس العقد داخل الملف', 'duplicate'));
      } else {
        seen.add(key);
      }
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
    } else {
      validRows.push(row);
      validRowIndices.push(i);
    }
  });

  return { validRows, validRowIndices, errors, totalRows: rows.length };
}

// ─── Staff template validation ──────────────────────────────────

export async function validateStaffTemplates(
  rows: ImportStaffRow[],
): Promise<ValidationResult<ImportStaffRow>> {
  const errors: ValidationError[] = [];
  const validRows: ImportStaffRow[] = [];
  const validRowIndices: number[] = [];

  const contractNos = Array.from(new Set(rows.map(r => r.contract_no).filter(isNonEmptyString)));
  const existing = await resolveExistingContractNos(contractNos);

  const seen = new Set<string>();

  rows.forEach((row, idx) => {
    const i = idx + 1;
    const rowErrors: ValidationError[] = [];

    if (!isNonEmptyString(row.contract_no)) {
      rowErrors.push(err(i, 'contract_no', row.contract_no, 'MISSING_REQUIRED',
        'contract_no is required', 'رقم العقد مطلوب'));
    } else if (!existing.has(row.contract_no)) {
      rowErrors.push(err(i, 'contract_no', row.contract_no, 'CONTRACT_NOT_FOUND',
        'Contract not found in DB — import contract first',
        'العقد غير موجود في قاعدة البيانات — يجب ترحيل العقد أولاً', 'reference'));
    }

    if (!isFiniteNumber(row.item_no) || row.item_no <= 0) {
      rowErrors.push(err(i, 'item_no', row.item_no, 'INVALID_NUMBER',
        'item_no must be > 0', 'رقم البند يجب أن يكون أكبر من صفر'));
    }
    if (!isNonEmptyString(row.position)) {
      rowErrors.push(err(i, 'position', row.position, 'MISSING_REQUIRED',
        'position is required', 'المسمى الوظيفي مطلوب'));
    }
    if (!isNonNegativeNumber(row.monthly_rate) || row.monthly_rate <= 0) {
      rowErrors.push(err(i, 'monthly_rate', row.monthly_rate, 'INVALID_NUMBER',
        'monthly_rate must be > 0', 'الراتب الشهري يجب أن يكون أكبر من صفر'));
    }
    if (!isFiniteNumber(row.contract_months) || row.contract_months <= 0) {
      rowErrors.push(err(i, 'contract_months', row.contract_months, 'INVALID_NUMBER',
        'contract_months must be > 0', 'مدة العقد بالأشهر يجب أن تكون أكبر من صفر'));
    }

    if (isNonEmptyString(row.contract_no) && isFiniteNumber(row.item_no)) {
      const key = row.contract_no + ':' + row.item_no;
      if (seen.has(key)) {
        rowErrors.push(err(i, 'item_no', row.item_no, 'DUPLICATE_IN_FILE',
          'Duplicate (contract_no,item_no) within file',
          'البند مكرر لنفس العقد داخل الملف', 'duplicate'));
      } else {
        seen.add(key);
      }
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
    } else {
      validRows.push(row);
      validRowIndices.push(i);
    }
  });

  return { validRows, validRowIndices, errors, totalRows: rows.length };
}

// ─── Historical claims validation ───────────────────────────────

export async function validateHistoricalClaims(
  claimRows: ImportClaimRow[],
  boqRows: ImportClaimBOQRow[],
): Promise<{ claims: ValidationResult<ImportClaimRow>; boq: ValidationResult<ImportClaimBOQRow> }> {
  // ── claims ──
  const claimErrors: ValidationError[] = [];
  const validClaims: ImportClaimRow[] = [];
  const validClaimIndices: number[] = [];

  const contractNos = Array.from(new Set(claimRows.map(r => r.contract_no).filter(isNonEmptyString)));
  const existing = await resolveExistingContractNos(contractNos);

  // Pull existing claim references for duplicate detection
  const existingRefs = await resolveExistingClaimRefs(contractNos);

  const seenRefs = new Set<string>();
  const seenKeys = new Set<string>();

  claimRows.forEach((row, idx) => {
    const i = idx + 1;
    const rowErrors: ValidationError[] = [];

    if (!isNonEmptyString(row.contract_no)) {
      rowErrors.push(err(i, 'contract_no', row.contract_no, 'MISSING_REQUIRED',
        'contract_no is required', 'رقم العقد مطلوب'));
    } else if (!existing.has(row.contract_no)) {
      rowErrors.push(err(i, 'contract_no', row.contract_no, 'CONTRACT_NOT_FOUND',
        'Contract not found in DB',
        'العقد غير موجود في قاعدة البيانات', 'reference'));
    }

    if (!isFiniteNumber(row.claim_no) || row.claim_no <= 0) {
      rowErrors.push(err(i, 'claim_no', row.claim_no, 'INVALID_NUMBER',
        'claim_no must be > 0', 'رقم المطالبة يجب أن يكون أكبر من صفر'));
    }
    if (!isNonEmptyString(row.period_from) || !DATE_RE.test(row.period_from)) {
      rowErrors.push(err(i, 'period_from', row.period_from, 'INVALID_DATE',
        'period_from must be YYYY-MM-DD', 'بداية الفترة بصيغة YYYY-MM-DD'));
    }
    if (!isNonEmptyString(row.period_to) || !DATE_RE.test(row.period_to)) {
      rowErrors.push(err(i, 'period_to', row.period_to, 'INVALID_DATE',
        'period_to must be YYYY-MM-DD', 'نهاية الفترة بصيغة YYYY-MM-DD'));
    }
    if (!isNonNegativeNumber(row.boq_amount)) {
      rowErrors.push(err(i, 'boq_amount', row.boq_amount, 'INVALID_NUMBER',
        'boq_amount must be >= 0', 'قيمة بنود الكميات يجب أن تكون صفر أو أكبر'));
    }
    if (row.staff_amount != null && !isNonNegativeNumber(row.staff_amount)) {
      rowErrors.push(err(i, 'staff_amount', row.staff_amount, 'INVALID_NUMBER',
        'staff_amount must be >= 0', 'قيمة الكوادر يجب أن تكون صفر أو أكبر'));
    }

    // Duplicate (contract_no, claim_no)
    if (isNonEmptyString(row.contract_no) && isFiniteNumber(row.claim_no)) {
      const key = row.contract_no + ':' + row.claim_no;
      if (seenKeys.has(key)) {
        rowErrors.push(err(i, 'claim_no', row.claim_no, 'DUPLICATE_IN_FILE',
          'Duplicate (contract_no,claim_no) within file',
          'المطالبة مكررة لنفس العقد داخل الملف', 'duplicate'));
      } else {
        seenKeys.add(key);
      }
    }

    // Duplicate reference_no (file + DB)
    if (isNonEmptyString(row.reference_no)) {
      if (seenRefs.has(row.reference_no)) {
        rowErrors.push(err(i, 'reference_no', row.reference_no, 'DUPLICATE_IN_FILE',
          'Duplicate reference_no within file',
          'الرقم المرجعي مكرر داخل الملف', 'duplicate'));
      } else if (existingRefs.has(row.reference_no)) {
        rowErrors.push(err(i, 'reference_no', row.reference_no, 'DUPLICATE_IN_DB',
          'reference_no already exists in DB',
          'الرقم المرجعي موجود مسبقاً في قاعدة البيانات', 'duplicate'));
      } else {
        seenRefs.add(row.reference_no);
      }
    }

    if (rowErrors.length > 0) {
      claimErrors.push(...rowErrors);
    } else {
      validClaims.push(row);
      validClaimIndices.push(i);
    }
  });

  // ── BOQ rows: must reference a valid (contract_no,claim_no) from validClaims ──
  const boqErrors: ValidationError[] = [];
  const validBOQ: ImportClaimBOQRow[] = [];
  const validBOQIndices: number[] = [];

  const validClaimKeys = new Set(validClaims.map(c => c.contract_no + ':' + c.claim_no));
  const seenBOQKeys = new Set<string>();

  boqRows.forEach((row, idx) => {
    const i = idx + 1;
    const rowErrors: ValidationError[] = [];

    if (!isNonEmptyString(row.contract_no)) {
      rowErrors.push(err(i, 'contract_no', row.contract_no, 'MISSING_REQUIRED',
        'contract_no is required', 'رقم العقد مطلوب'));
    }
    if (!isFiniteNumber(row.claim_no) || row.claim_no <= 0) {
      rowErrors.push(err(i, 'claim_no', row.claim_no, 'INVALID_NUMBER',
        'claim_no must be > 0', 'رقم المطالبة يجب أن يكون أكبر من صفر'));
    }
    if (!isFiniteNumber(row.item_no) || row.item_no <= 0) {
      rowErrors.push(err(i, 'item_no', row.item_no, 'INVALID_NUMBER',
        'item_no must be > 0', 'رقم البند يجب أن يكون أكبر من صفر'));
    }
    if (!isNonNegativeNumber(row.curr_progress)) {
      rowErrors.push(err(i, 'curr_progress', row.curr_progress, 'INVALID_NUMBER',
        'curr_progress must be >= 0', 'نسبة التقدم يجب أن تكون صفر أو أكبر'));
    }
    if (!isNonNegativeNumber(row.period_amount)) {
      rowErrors.push(err(i, 'period_amount', row.period_amount, 'INVALID_NUMBER',
        'period_amount must be >= 0', 'قيمة الفترة يجب أن تكون صفر أو أكبر'));
    }

    if (isNonEmptyString(row.contract_no) && isFiniteNumber(row.claim_no)) {
      const key = row.contract_no + ':' + row.claim_no;
      if (!validClaimKeys.has(key)) {
        rowErrors.push(err(i, 'claim_no', row.claim_no, 'CLAIM_NOT_VALID',
          'Parent claim is not valid (was rejected or missing)',
          'المطالبة الأم غير صالحة (مرفوضة أو غير موجودة)', 'reference'));
      }
    }

    if (isNonEmptyString(row.contract_no) && isFiniteNumber(row.claim_no) && isFiniteNumber(row.item_no)) {
      const tripleKey = row.contract_no + ':' + row.claim_no + ':' + row.item_no;
      if (seenBOQKeys.has(tripleKey)) {
        rowErrors.push(err(i, 'item_no', row.item_no, 'DUPLICATE_IN_FILE',
          'Duplicate (contract,claim,item) within file',
          'البند مكرر لنفس المطالبة داخل الملف', 'duplicate'));
      } else {
        seenBOQKeys.add(tripleKey);
      }
    }

    if (rowErrors.length > 0) {
      boqErrors.push(...rowErrors);
    } else {
      validBOQ.push(row);
      validBOQIndices.push(i);
    }
  });

  return {
    claims: {
      validRows: validClaims,
      validRowIndices: validClaimIndices,
      errors: claimErrors,
      totalRows: claimRows.length,
    },
    boq: {
      validRows: validBOQ,
      validRowIndices: validBOQIndices,
      errors: boqErrors,
      totalRows: boqRows.length,
    },
  };
}

// ─── DB lookups ─────────────────────────────────────────────────

async function resolveExistingContractNos(nos: string[]): Promise<Set<string>> {
  const set = new Set<string>();
  if (nos.length === 0) return set;
  const supabase = createBrowserSupabase();
  const { data } = await supabase
    .from('contracts')
    .select('contract_no')
    .in('contract_no', nos);
  for (const r of data ?? []) {
    if (typeof r.contract_no === 'string') set.add(r.contract_no);
  }
  return set;
}

async function resolveExistingClaimRefs(contractNos: string[]): Promise<Set<string>> {
  const set = new Set<string>();
  if (contractNos.length === 0) return set;
  const supabase = createBrowserSupabase();

  // Resolve contract IDs first
  const { data: cs } = await supabase
    .from('contracts')
    .select('id')
    .in('contract_no', contractNos);
  const ids = (cs ?? []).map(c => c.id as string);
  if (ids.length === 0) return set;

  const { data } = await supabase
    .from('claims')
    .select('reference_no')
    .in('contract_id', ids)
    .not('reference_no', 'is', null);
  for (const r of data ?? []) {
    if (typeof r.reference_no === 'string' && r.reference_no.length > 0) {
      set.add(r.reference_no);
    }
  }
  return set;
}
