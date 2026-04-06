'use client';

import { useState, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import Card, { CardBody } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
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
  type ImportResult,
} from '@/services/bulk-import';

// SheetJS will be loaded dynamically
declare const XLSX: any;

export default function ImportPage() {
  const { profile } = useAuth();
  const { showToast } = useToast();

  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<ImportResult | null>(null);
  const [xlsxLoaded, setXlsxLoaded] = useState(false);

  // Dynamically load SheetJS
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

  const handleImport = async () => {
    if (!file || !profile) return;

    if (!xlsxLoaded) {
      showToast('جاري تحميل مكتبة Excel...', 'error');
      return;
    }

    setImporting(true);
    setResults(null);

    try {
      const parsed = await parseExcel(file);

      const importResult: ImportResult = {
        contracts: { imported: 0, errors: [] },
        boqTemplates: { imported: 0, errors: [] },
        staffTemplates: { imported: 0, errors: [] },
        claims: { imported: 0, errors: [] },
        claimBOQItems: { imported: 0, errors: [] },
      };

      // Import in order: contracts → BOQ → Staff → Claims
      if (parsed.contracts.length > 0) {
        const r = await importContracts(parsed.contracts, profile.id);
        if (r.success && r.data) {
          importResult.contracts = r.data;
        } else {
          importResult.contracts.errors.push(r.error || 'خطأ في استيراد العقود');
        }
      }

      if (parsed.boqTemplates.length > 0) {
        const r = await importBOQTemplates(parsed.boqTemplates);
        if (r.success && r.data) {
          importResult.boqTemplates = r.data;
        } else {
          importResult.boqTemplates.errors.push(r.error || 'خطأ في استيراد قوالب BOQ');
        }
      }

      if (parsed.staffTemplates.length > 0) {
        const r = await importStaffTemplates(parsed.staffTemplates);
        if (r.success && r.data) {
          importResult.staffTemplates = r.data;
        } else {
          importResult.staffTemplates.errors.push(r.error || 'خطأ في استيراد قوالب الكادر');
        }
      }

      if (parsed.claims.length > 0) {
        const r = await importHistoricalClaims(parsed.claims, parsed.claimBOQItems, profile.id);
        if (r.success && r.data) {
          importResult.claims = { imported: r.data.claims, errors: r.data.errors };
          importResult.claimBOQItems = { imported: r.data.boqItems, errors: [] };
        } else {
          importResult.claims.errors.push(r.error || 'خطأ في استيراد المطالبات');
        }
      }

      setResults(importResult);

      const totalImported =
        importResult.contracts.imported +
        importResult.boqTemplates.imported +
        importResult.staffTemplates.imported +
        importResult.claims.imported +
        importResult.claimBOQItems.imported;

      const totalErrors =
        importResult.contracts.errors.length +
        importResult.boqTemplates.errors.length +
        importResult.staffTemplates.errors.length +
        importResult.claims.errors.length +
        importResult.claimBOQItems.errors.length;

      if (totalErrors === 0) {
        showToast(`تم استيراد ${totalImported} سجل بنجاح`, 'success');
      } else {
        showToast(`تم استيراد ${totalImported} سجل مع ${totalErrors} خطأ`, 'error');
      }
    } catch (e: any) {
      showToast(`خطأ في قراءة الملف: ${e.message}`, 'error');
    } finally {
      setImporting(false);
    }
  };

  const downloadTemplate = () => {
    if (!xlsxLoaded) {
      loadXLSX();
      showToast('جاري تحميل مكتبة Excel — حاول مرة أخرى', 'error');
      return;
    }

    const wb = XLSX.utils.book_new();

    // Contracts sheet
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

    // BOQ Templates sheet
    const boqData = [
      {
        contract_no: 'C-001',
        item_no: 1,
        description: 'أعمال الحفر',
        unit: 'م³',
        unit_price: 50,
        contractual_qty: 1000,
      },
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(boqData), 'boq_templates');

    // Staff Templates sheet
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

    // Claims sheet
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

    // Claim BOQ Items sheet
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
    showToast('تم تحميل قالب الاستيراد', 'success');
  };

  if (!profile) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="الاستيراد الجماعي"
        subtitle="استيراد العقود والمطالبات التاريخية من ملفات Excel"
      />

      {/* Instructions */}
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
              <Button variant="secondary" onClick={downloadTemplate}>
                تحميل قالب الاستيراد (Excel)
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* File Upload */}
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
            <Button
              onClick={handleImport}
              disabled={!file || importing}
            >
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

      {/* Results */}
      {results && (
        <Card>
          <CardBody>
            <h3 className="font-bold text-[#045859] mb-3">نتائج الاستيراد</h3>
            <div className="space-y-3">
              {[
                { label: 'العقود', data: results.contracts },
                { label: 'قوالب BOQ', data: results.boqTemplates },
                { label: 'قوالب الكادر', data: results.staffTemplates },
                { label: 'المطالبات', data: results.claims },
                { label: 'بنود BOQ', data: results.claimBOQItems },
              ].map(({ label, data }) => (
                <div key={label} className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-2">
                  <span className="font-bold text-sm">{label}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-green-700 font-bold">
                      {data.imported} تم استيرادها
                    </span>
                    {data.errors.length > 0 && (
                      <span className="text-sm text-red-600 font-bold">
                        {data.errors.length} خطأ
                      </span>
                    )}
                  </div>
                </div>
              ))}

              {/* Error details */}
              {[results.contracts, results.boqTemplates, results.staffTemplates, results.claims, results.claimBOQItems]
                .flatMap(r => r.errors)
                .length > 0 && (
                <div className="mt-4">
                  <h4 className="font-bold text-red-600 text-sm mb-2">تفاصيل الأخطاء:</h4>
                  <div className="bg-red-50 rounded-lg p-3 max-h-60 overflow-y-auto">
                    {[results.contracts, results.boqTemplates, results.staffTemplates, results.claims, results.claimBOQItems]
                      .flatMap(r => r.errors)
                      .map((err, i) => (
                        <div key={i} className="text-xs text-red-700 py-0.5">{err}</div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
