'use client';

import { useState, useCallback, useMemo } from 'react';
import { useAuth } from '@/components/AuthProvider';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import Card, { CardBody } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import {
  type ImportContractRow,
  type ImportBOQRow,
  type ImportStaffRow,
  type ImportClaimRow,
  type ImportClaimBOQRow,
  type ImportProgressCallback,
} from '@/services/bulk-import';
import {
  importContractsWithSession,
  importBOQTemplatesWithSession,
  importStaffTemplatesWithSession,
  importHistoricalClaimsWithSession,
  type SessionImportSummary,
  type ImportStatus,
  type ImportSourcePhase,
} from '@/services/import-session';

declare const XLSX: any;

type UiPhase = 'idle' | ImportStatus;

interface PhaseSummary {
  phase: ImportSourcePhase;
  sheetName: string;
  labelAr: string;
  totalRows: number;
  summary: SessionImportSummary | null;
}

interface ProgressInfo {
  phase: string;
  current: number;
  total: number;
  pct: number;
  rowsProcessed: number;
  totalRows: number;
}

const PHASE_LABELS: Record<ImportSourcePhase, string> = {
  contracts: 'العقود',
  boq_templates: 'قوالب BOQ',
  staff_templates: 'قوالب الكادر',
  historical_claims: 'المطالبات التاريخية',
};

const SHEET_NAMES: Record<ImportSourcePhase, string> = {
  contracts: 'contracts',
  boq_templates: 'boq_templates',
  staff_templates: 'staff_templates',
  historical_claims: 'claims + claim_boq_items',
};

const STATUS_LABELS: Record<UiPhase, string> = {
  idle: 'جاهز',
  pending: 'قيد التهيئة',
  validating: 'جاري التحقق',
  running: 'جاري الاستيراد',
  completed: 'مكتمل بنجاح',
  partial: 'مكتمل جزئياً',
  failed: 'فشل',
};

const STATUS_COLOR: Record<UiPhase, string> = {
  idle: 'bg-gray-100 text-gray-700',
  pending: 'bg-blue-50 text-blue-700',
  validating: 'bg-blue-50 text-blue-700',
  running: 'bg-amber-50 text-amber-700',
  completed: 'bg-green-50 text-green-700',
  partial: 'bg-amber-50 text-amber-700',
  failed: 'bg-red-50 text-red-700',
};

function csvEscape(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

interface CsvErrorRow {
  importId: string;
  phase: string;
  sheet: string;
  rowIndex: number;
  field: string;
  fieldValue: string;
  errorType: string;
  errorCode: string;
  errorMessage: string;
  errorMessageAr: string;
  source: 'validation' | 'runtime';
}

function buildErrorCsv(rows: CsvErrorRow[]): string {
  const header = [
    'import_id', 'phase', 'sheet', 'row_index',
    'field_name', 'field_value', 'error_type', 'error_code',
    'error_message', 'error_message_ar', 'source',
  ].join(',');
  const lines = rows.map(r => [
    r.importId, r.phase, r.sheet, r.rowIndex,
    r.field, r.fieldValue, r.errorType, r.errorCode,
    r.errorMessage, r.errorMessageAr, r.source,
  ].map(csvEscape).join(','));
  return [header, ...lines].join('\n');
}

function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function ImportPage() {
  const { profile } = useAuth();
  const { showToast } = useToast();

  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [overallStatus, setOverallStatus] = useState<UiPhase>('idle');
  const [phases, setPhases] = useState<PhaseSummary[]>([]);
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [xlsxLoaded, setXlsxLoaded] = useState(false);

  const loadXLSX = useCallback(async () => {
    if (xlsxLoaded) return;
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    script.onload = () => setXlsxLoaded(true);
    document.head.appendChild(script);
  }, [xlsxLoaded]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      setPhases([]);
      setProgress(null);
      setOverallStatus('idle');
      loadXLSX();
    }
  };

  const parseExcel = async (file: File): Promise<{
    contracts: ImportContractRow[];
    boqTemplates: ImportBOQRow[];
    staffTemplates: ImportStaffRow[];
    claims: ImportClaimRow[];
    claimBOQItems: ImportClaimBOQRow[];
  }> => {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array' });

    const parseSheet = <T,>(sheetName: string): T[] => {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) return [];
      return XLSX.utils.sheet_to_json(sheet) as T[];
    };

    return {
      contracts: parseSheet<ImportContractRow>('contracts'),
      boqTemplates: parseSheet<ImportBOQRow>('boq_templates'),
      staffTemplates: parseSheet<ImportStaffRow>('staff_templates'),
      claims: parseSheet<ImportClaimRow>('claims'),
      claimBOQItems: parseSheet<ImportClaimBOQRow>('claim_boq_items'),
    };
  };

  const makeProgressHandler = (phase: ImportSourcePhase): ImportProgressCallback => (info) => {
    setProgress({
      phase,
      current: info.chunkIndex,
      total: info.totalChunks,
      pct: info.totalChunks > 0 ? Math.round((info.chunkIndex / info.totalChunks) * 100) : 0,
      rowsProcessed: info.rowsProcessed,
      totalRows: info.totalRows,
    });
  };

  const handleImport = async () => {
    if (!file || !profile) return;

    if (!xlsxLoaded) {
      showToast('جاري تحميل مكتبة Excel...', 'error');
      return;
    }

    setImporting(true);
    setPhases([]);
    setProgress(null);
    setOverallStatus('pending');

    try {
      const parsed = await parseExcel(file);
      const fileName = file.name;

      const work: PhaseSummary[] = [];
      if (parsed.contracts.length > 0) {
        work.push({ phase: 'contracts', sheetName: SHEET_NAMES.contracts, labelAr: PHASE_LABELS.contracts, totalRows: parsed.contracts.length, summary: null });
      }
      if (parsed.boqTemplates.length > 0) {
        work.push({ phase: 'boq_templates', sheetName: SHEET_NAMES.boq_templates, labelAr: PHASE_LABELS.boq_templates, totalRows: parsed.boqTemplates.length, summary: null });
      }
      if (parsed.staffTemplates.length > 0) {
        work.push({ phase: 'staff_templates', sheetName: SHEET_NAMES.staff_templates, labelAr: PHASE_LABELS.staff_templates, totalRows: parsed.staffTemplates.length, summary: null });
      }
      if (parsed.claims.length > 0) {
        work.push({ phase: 'historical_claims', sheetName: SHEET_NAMES.historical_claims, labelAr: PHASE_LABELS.historical_claims, totalRows: parsed.claims.length + parsed.claimBOQItems.length, summary: null });
      }
      setPhases(work);

      if (work.length === 0) {
        showToast('لا توجد صفوف للاستيراد في الملف', 'info');
        setOverallStatus('idle');
        setImporting(false);
        return;
      }

      setOverallStatus('validating');

      const updatePhase = (phase: ImportSourcePhase, summary: SessionImportSummary) =>
        setPhases(prev => prev.map(p => p.phase === phase ? { ...p, summary } : p));

      let anySuccess = false;
      let anyFailed = false;

      if (parsed.contracts.length > 0) {
        setOverallStatus('running');
        const r = await importContractsWithSession(parsed.contracts, profile.id, fileName, makeProgressHandler('contracts'));
        updatePhase('contracts', r);
        if (r.successRows > 0) anySuccess = true;
        if (r.status === 'failed') anyFailed = true;
      }

      if (parsed.boqTemplates.length > 0) {
        setOverallStatus('running');
        const r = await importBOQTemplatesWithSession(parsed.boqTemplates, profile.id, fileName, makeProgressHandler('boq_templates'));
        updatePhase('boq_templates', r);
        if (r.successRows > 0) anySuccess = true;
        if (r.status === 'failed') anyFailed = true;
      }

      if (parsed.staffTemplates.length > 0) {
        setOverallStatus('running');
        const r = await importStaffTemplatesWithSession(parsed.staffTemplates, profile.id, fileName, makeProgressHandler('staff_templates'));
        updatePhase('staff_templates', r);
        if (r.successRows > 0) anySuccess = true;
        if (r.status === 'failed') anyFailed = true;
      }

      if (parsed.claims.length > 0) {
        setOverallStatus('running');
        const r = await importHistoricalClaimsWithSession(parsed.claims, parsed.claimBOQItems, profile.id, fileName, makeProgressHandler('historical_claims'));
        updatePhase('historical_claims', r);
        if (r.successRows > 0) anySuccess = true;
        if (r.status === 'failed') anyFailed = true;
      }

      const final: UiPhase = anyFailed && !anySuccess ? 'failed' : anyFailed ? 'partial' : 'completed';
      setOverallStatus(final);

      if (final === 'completed') {
        showToast('اكتمل الاستيراد بنجاح', 'ok');
      } else if (final === 'partial') {
        showToast('اكتمل الاستيراد مع وجود أخطاء — راجع التقرير', 'error');
      } else {
        showToast('فشل الاستيراد — راجع تقرير الأخطاء', 'error');
      }
    } catch (e: any) {
      setOverallStatus('failed');
      showToast('خطأ في قراءة الملف: ' + e.message, 'error');
    } finally {
      setImporting(false);
      setProgress(null);
    }
  };

  const totals = useMemo(() => {
    let totalRows = 0;
    let validRows = 0;
    let errorRows = 0;
    for (const p of phases) {
      totalRows += p.totalRows;
      if (p.summary) {
        validRows += p.summary.successRows;
        errorRows += p.summary.failedRows;
      }
    }
    return { totalRows, validRows, errorRows };
  }, [phases]);

  const allErrorRows: CsvErrorRow[] = useMemo(() => {
    const out: CsvErrorRow[] = [];
    for (const p of phases) {
      const s = p.summary;
      if (!s) continue;
      for (const e of s.validationErrors) {
        out.push({
          importId: s.importId,
          phase: p.labelAr,
          sheet: p.sheetName,
          rowIndex: e.rowIndex,
          field: e.fieldName ?? '',
          fieldValue: e.fieldValue ?? '',
          errorType: e.errorType,
          errorCode: e.errorCode,
          errorMessage: e.errorMessage,
          errorMessageAr: e.errorMessageAr,
          source: 'validation',
        });
      }
      for (const msg of s.runtimeErrors) {
        out.push({
          importId: s.importId,
          phase: p.labelAr,
          sheet: p.sheetName,
          rowIndex: 0,
          field: '',
          fieldValue: '',
          errorType: 'database',
          errorCode: 'CHUNK_FAILED',
          errorMessage: msg,
          errorMessageAr: msg,
          source: 'runtime',
        });
      }
    }
    return out;
  }, [phases]);

  const handleDownloadErrorCsv = () => {
    if (allErrorRows.length === 0) {
      showToast('لا توجد أخطاء لتنزيلها', 'info');
      return;
    }
    const csv = buildErrorCsv(allErrorRows);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    downloadCsv('CONVERA_import_errors_' + stamp + '.csv', csv);
  };

  const downloadTemplate = () => {
    if (!xlsxLoaded) {
      loadXLSX();
      showToast('جاري تحميل مكتبة Excel — حاول مرة أخرى', 'error');
      return;
    }

    const wb = XLSX.utils.book_new();

    const contractsData = [
      {
        contract_no: 'C-001',
        title: 'عقد تصميم مبنى إداري',
        title_ar: 'عقد تصميم مبنى إداري',
        type: 'consultancy',
        party_name: 'شركة الاستشارات الهندسية',
        party_name_ar: 'شركة الاستشارات الهندسية',
        base_value: 1000000,
        retention_pct: 10,
        boq_progress_model: 'count',
        start_date: '2026-01-01',
        end_date: '2027-01-01',
        duration_months: 12,
      },
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(contractsData), 'contracts');

    const boqData = [
      {
        contract_no: 'C-001',
        item_no: 1,
        description: 'أعمال الحفر',
        unit: 'م3',
        unit_price: 50,
        contractual_qty: 1000,
      },
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(boqData), 'boq_templates');

    const staffData = [
      {
        contract_no: 'C-001',
        item_no: 1,
        position: 'مهندس مشرف',
        monthly_rate: 15000,
        contract_months: 12,
      },
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(staffData), 'staff_templates');

    const claimsData = [
      {
        contract_no: 'C-001',
        claim_no: 1,
        period_from: '2026-01-01',
        period_to: '2026-01-31',
        boq_amount: 50000,
        staff_amount: 15000,
        retention_amount: 6500,
        vat_amount: 8775,
        status: 'approved',
      },
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(claimsData), 'claims');

    const claimBoqData = [
      {
        contract_no: 'C-001',
        claim_no: 1,
        item_no: 1,
        prev_progress: 0,
        curr_progress: 100,
        period_amount: 5000,
        performance_pct: 100,
      },
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(claimBoqData), 'claim_boq_items');

    XLSX.writeFile(wb, 'CONVERA_Import_Template.xlsx');
    showToast('تم تحميل قالب الاستيراد', 'ok');
  };

  if (!profile) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="الاستيراد الجماعي"
        subtitle="استيراد العقود والمطالبات التاريخية من ملفات Excel"
      />

      <Card>
        <CardBody>
          <h3 className="font-bold text-[#045859] mb-3">تعليمات الاستيراد</h3>
          <div className="text-sm text-gray-600 space-y-2">
            <p>يجب أن يحتوي ملف Excel على الأوراق التالية (حسب الحاجة):</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
              <div className="bg-gray-50 rounded-lg p-3">
                <span className="font-bold text-[#045859]">contracts</span>
                <span className="text-xs block text-gray-500">بيانات العقود الأساسية</span>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <span className="font-bold text-[#045859]">boq_templates</span>
                <span className="text-xs block text-gray-500">قوالب جدول الكميات</span>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <span className="font-bold text-[#045859]">staff_templates</span>
                <span className="text-xs block text-gray-500">قوالب الكادر الوظيفي</span>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <span className="font-bold text-[#045859]">claims</span>
                <span className="text-xs block text-gray-500">المطالبات التاريخية (معتمدة)</span>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <span className="font-bold text-[#045859]">claim_boq_items</span>
                <span className="text-xs block text-gray-500">بنود BOQ للمطالبات</span>
              </div>
            </div>
            <div className="mt-3">
              <Button variant="outline" onClick={downloadTemplate}>
                تحميل قالب الاستيراد (Excel)
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <h3 className="font-bold text-[#045859] mb-3">رفع الملف</h3>
          <div className="flex items-center gap-4">
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileChange}
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
            />
            <Button onClick={handleImport} disabled={!file || importing}>
              {importing ? 'جاري الاستيراد...' : 'بدء الاستيراد'}
            </Button>
          </div>
          {file && (
            <p className="text-xs text-gray-500 mt-2">
              الملف: {file.name} ({(file.size / 1024).toFixed(1)} KB)
            </p>
          )}
        </CardBody>
      </Card>

      {overallStatus !== 'idle' && (
        <Card>
          <CardBody>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-[#045859]">حالة الاستيراد</h3>
              <span className={'text-xs font-bold rounded-lg px-3 py-1 ' + STATUS_COLOR[overallStatus]}>
                {STATUS_LABELS[overallStatus]}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <div className="text-xs text-gray-500">إجمالي الصفوف</div>
                <div className="text-xl font-bold text-[#045859]">{totals.totalRows}</div>
              </div>
              <div className="bg-green-50 rounded-lg p-3 text-center">
                <div className="text-xs text-gray-500">صفوف ناجحة</div>
                <div className="text-xl font-bold text-green-700">{totals.validRows}</div>
              </div>
              <div className="bg-red-50 rounded-lg p-3 text-center">
                <div className="text-xs text-gray-500">صفوف فاشلة</div>
                <div className="text-xl font-bold text-red-700">{totals.errorRows}</div>
              </div>
            </div>

            {progress && importing && (
              <div className="mb-4">
                <div className="flex justify-between text-xs text-gray-600 mb-1">
                  <span>{progress.phase}</span>
                  <span>{progress.rowsProcessed}/{progress.totalRows} ({progress.pct}%)</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                  <div className="bg-[#087272] h-2 transition-all" style={{ width: progress.pct + '%' }} />
                </div>
              </div>
            )}

            <div className="space-y-2">
              {phases.map(p => {
                const s = p.summary;
                const status: UiPhase = s ? s.status : (importing ? 'running' : 'pending');
                return (
                  <div key={p.phase} className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-2">
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-sm text-[#045859]">{p.labelAr}</span>
                      <span className="text-xs text-gray-400">({p.sheetName})</span>
                    </div>
                    <div className="flex items-center gap-3">
                      {s ? (
                        <>
                          <span className="text-xs text-gray-500">{p.totalRows} صف</span>
                          <span className="text-sm text-green-700 font-bold">{s.successRows} ناجح</span>
                          {s.failedRows > 0 && (
                            <span className="text-sm text-red-600 font-bold">{s.failedRows} خطأ</span>
                          )}
                        </>
                      ) : (
                        <span className="text-xs text-gray-500">{p.totalRows} صف</span>
                      )}
                      <span className={'text-xs font-bold rounded-lg px-2 py-0.5 ' + STATUS_COLOR[status]}>
                        {STATUS_LABELS[status]}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardBody>
        </Card>
      )}

      {allErrorRows.length > 0 && (
        <Card>
          <CardBody>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-red-700">تقرير الأخطاء ({allErrorRows.length})</h3>
              <Button variant="outline" onClick={handleDownloadErrorCsv}>
                تنزيل تقرير الأخطاء (CSV)
              </Button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs border border-gray-200 rounded-lg overflow-hidden">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-2 py-2 text-right font-bold">المرحلة</th>
                    <th className="px-2 py-2 text-right font-bold">الورقة</th>
                    <th className="px-2 py-2 text-right font-bold">الصف</th>
                    <th className="px-2 py-2 text-right font-bold">الحقل</th>
                    <th className="px-2 py-2 text-right font-bold">القيمة</th>
                    <th className="px-2 py-2 text-right font-bold">الكود</th>
                    <th className="px-2 py-2 text-right font-bold">الرسالة</th>
                  </tr>
                </thead>
                <tbody>
                  {allErrorRows.slice(0, 200).map((e, i) => (
                    <tr key={i} className={i % 2 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-2 py-1.5">{e.phase}</td>
                      <td className="px-2 py-1.5 text-gray-500">{e.sheet}</td>
                      <td className="px-2 py-1.5 font-mono">{e.rowIndex || '-'}</td>
                      <td className="px-2 py-1.5 font-mono">{e.field || '-'}</td>
                      <td className="px-2 py-1.5 font-mono text-gray-500" title={e.fieldValue}>
                        {e.fieldValue.length > 24 ? e.fieldValue.slice(0, 24) + '...' : e.fieldValue}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-red-600">{e.errorCode}</td>
                      <td className="px-2 py-1.5 text-red-700">{e.errorMessageAr || e.errorMessage}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {allErrorRows.length > 200 && (
                <p className="text-xs text-gray-500 mt-2 text-center">
                  يعرض أول 200 خطأ - حمّل ملف CSV لكامل التقرير ({allErrorRows.length} خطأ)
                </p>
              )}
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
