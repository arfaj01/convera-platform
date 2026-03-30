'use client';

/**
 * CONVERA — تقرير المرفقات والمستندات
 * /reports/documents
 *
 * Documents Report:
 * - KPI: total claims, fully documented, partial, missing
 * - Shows per-claim document checklist: invoice, technical report, completion cert, audit form
 * - Color-coded completeness status
 * - Filters: completeness status, contract, claim status, search
 * - CSV export + Print
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import PageHeader from '@/components/ui/PageHeader';
import ReportKPIBar, { type KPICard } from '@/components/reports/ReportKPIBar';
import ExportButton, { exportToCSV } from '@/components/reports/ExportButton';
import Badge from '@/components/ui/Badge';
import { fetchDocumentsReport, type DocumentReportRow } from '@/services/reports';
import { CLAIM_STATUS_LABELS } from '@/lib/constants';
import type { ClaimStatus } from '@/lib/types';

function DocCell({ has }: { has: boolean }) {
  return has
    ? <span className="text-[#87BA26] font-bold text-sm">✓</span>
    : <span className="text-[#C05728] opacity-50 text-sm">✗</span>;
}

const COMPLETION_STYLES = {
  complete: { bg: '#F0F7E0', text: '#4A7B00', label: 'مكتمل', icon: '✓' },
  partial:  { bg: '#FFF8E0', text: '#B8860B', label: 'جزئي', icon: '⚠' },
  missing:  { bg: '#FAEEE8', text: '#C05728', label: 'ناقص', icon: '✗' },
};

const ALL_STATUSES: ClaimStatus[] = [
  'submitted', 'under_supervisor_review', 'returned_by_supervisor',
  'under_auditor_review', 'returned_by_auditor',
  'under_reviewer_check', 'pending_director_approval', 'approved', 'rejected',
];

export default function DocumentsReportPage() {
  const { profile, loading: authLoading } = useAuth();
  const router = useRouter();

  const [rows, setRows] = useState<DocumentReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filterCompletion, setFilterCompletion] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterContract, setFilterContract] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!authLoading && profile && !['director', 'reviewer', 'auditor'].includes(profile.role)) {
      router.replace('/dashboard');
    }
  }, [authLoading, profile, router]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { rows: r } = await fetchDocumentsReport();
      setRows(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ في تحميل البيانات');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const contractOptions = useMemo(() => {
    const seen = new Map<string, string>();
    rows.forEach(r => { if (!seen.has(r.contractNo)) seen.set(r.contractNo, r.contractTitle); });
    return Array.from(seen.entries()).map(([no, title]) => ({ no, title }));
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (filterCompletion && r.completionStatus !== filterCompletion) return false;
      if (filterStatus && r.status !== filterStatus) return false;
      if (filterContract && r.contractNo !== filterContract) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !String(r.claimNo).includes(q) &&
          !r.contractNo.toLowerCase().includes(q) &&
          !r.contractTitle.toLowerCase().includes(q)
        ) return false;
      }
      return true;
    });
  }, [rows, filterCompletion, filterStatus, filterContract, search]);

  // Sort: missing first, then partial, then complete
  const sorted = useMemo(() => {
    const p = { missing: 0, partial: 1, complete: 2 };
    return [...filtered].sort((a, b) => p[a.completionStatus] - p[b.completionStatus]);
  }, [filtered]);

  const kpiCards: KPICard[] = useMemo(() => {
    const complete = filtered.filter(r => r.completionStatus === 'complete');
    const partial = filtered.filter(r => r.completionStatus === 'partial');
    const missing = filtered.filter(r => r.completionStatus === 'missing');
    const totalDocs = filtered.reduce((s, r) => s + r.totalDocuments, 0);
    const withCert = filtered.filter(r => r.hasApprovalDoc).length;

    return [
      { label: 'إجمالي المطالبات', value: filtered.length, icon: '📋', variant: 'default' },
      {
        label: 'مكتملة الوثائق',
        value: complete.length,
        subLabel: filtered.length > 0 ? `${Math.round((complete.length / filtered.length) * 100)}%` : '0%',
        icon: '✓',
        variant: 'success',
      },
      {
        label: 'وثائق جزئية',
        value: partial.length,
        subLabel: 'فاتورة أو تقرير فقط',
        icon: '⚠',
        variant: 'warning',
      },
      {
        label: 'ناقصة الوثائق',
        value: missing.length,
        subLabel: missing.length > 0 ? 'تتطلب متابعة' : 'لا يوجد',
        icon: '✗',
        variant: missing.length > 0 ? 'danger' : 'success',
      },
      { label: 'إجمالي المستندات', value: totalDocs, icon: '📎', variant: 'info' },
      {
        label: 'مطالبات بشهادة إنجاز',
        value: withCert,
        subLabel: 'مُولَّدة تلقائياً',
        icon: '📜',
        variant: 'purple',
      },
    ];
  }, [filtered]);

  const handleExport = () => {
    exportToCSV(
      [
        { key: 'claimNo', label: 'رقم المطالبة' },
        { key: 'contractNo', label: 'رقم العقد' },
        { key: 'contractTitle', label: 'العقد' },
        { key: 'status', label: 'حالة المطالبة' },
        { key: 'hasInvoice', label: 'فاتورة' },
        { key: 'hasClaimDoc', label: 'مستند المطالبة / التقرير' },
        { key: 'hasApprovalDoc', label: 'وثيقة الاعتماد / شهادة إنجاز' },
        { key: 'hasOtherDoc', label: 'مستندات أخرى' },
        { key: 'totalDocuments', label: 'إجمالي المستندات' },
        { key: 'completionStatus', label: 'حالة التوثيق' },
        { key: 'submittedAt', label: 'تاريخ التقديم' },
      ],
      sorted.map(r => ({
        ...r,
        status: CLAIM_STATUS_LABELS[r.status as ClaimStatus] ?? r.status,
        hasInvoice: r.hasInvoice ? 'نعم' : 'لا',
        hasClaimDoc: r.hasClaimDoc ? 'نعم' : 'لا',
        hasApprovalDoc: r.hasApprovalDoc ? 'نعم' : 'لا',
        hasOtherDoc: r.hasOtherDoc ? 'نعم' : 'لا',
        completionStatus: COMPLETION_STYLES[r.completionStatus].label,
        submittedAt: r.submittedAt ? r.submittedAt.slice(0, 10) : '',
      })),
      'تقرير_المرفقات_والمستندات',
    );
  };

  if (authLoading || (!profile && !error)) {
    return <div className="flex items-center justify-center h-48"><p className="text-sm text-gray-400 animate-pulse">جاري التحميل...</p></div>;
  }

  return (
    <div className="space-y-4 print:space-y-3" dir="rtl">
      <div className="hidden print:block text-center mb-4 pb-3 border-b border-gray-300">
        <h1 className="text-xl font-black text-[#045859]">تقرير المرفقات والمستندات</h1>
        <p className="text-xs text-gray-500 mt-1">منصة CONVERA — وزارة البلديات والإسكان — {new Date().toLocaleDateString('ar-SA')}</p>
      </div>

      <PageHeader
        title="تقرير المرفقات والمستندات"
        subtitle="فحص مستندات المطالبات: الفاتورة، التقرير التقني، شهادة الإنجاز، واستمارة المراجعة"
        action={<ExportButton onExportCSV={handleExport} disabled={loading || sorted.length === 0} reportTitle="تقرير المرفقات والمستندات" />}
      />

      <ReportKPIBar cards={kpiCards} className="grid-cols-2 sm:grid-cols-3 lg:grid-cols-6" />

      {/* Mandatory docs reminder */}
      <div className="flex items-start gap-3 p-3 rounded-lg border text-xs bg-[#E8F4F4] border-[#04585940] print:hidden">
        <span>ℹ</span>
        <p className="text-gray-600">
          <span className="font-bold text-[#045859]">المستندات الإلزامية للتقديم (Rule G1):</span> الفاتورة + مستند المطالبة (التقرير الداعم).
          بدونهما يُحظر تقديم المطالبة. وثائق الاعتماد وشهادة الإنجاز تُولَّدان تلقائياً عند الموافقة.
        </p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 print:hidden">
        <p className="text-xs font-bold text-gray-500 mb-3 flex items-center gap-1.5"><span>🔍</span> الفلاتر والبحث</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <input
            type="text"
            placeholder="بحث... رقم مطالبة / عقد"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="col-span-2 border border-gray-200 rounded px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#045859] text-right"
          />
          <select
            value={filterCompletion}
            onChange={e => setFilterCompletion(e.target.value)}
            className="border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#045859] text-right"
          >
            <option value="">كل حالات التوثيق</option>
            <option value="complete">مكتمل</option>
            <option value="partial">جزئي</option>
            <option value="missing">ناقص</option>
          </select>
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#045859] text-right"
          >
            <option value="">كل الحالات</option>
            {ALL_STATUSES.map(s => (
              <option key={s} value={s}>{CLAIM_STATUS_LABELS[s]}</option>
            ))}
          </select>
          <select
            value={filterContract}
            onChange={e => setFilterContract(e.target.value)}
            className="border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#045859] text-right"
          >
            <option value="">كل العقود</option>
            {contractOptions.map(c => <option key={c.no} value={c.no}>{c.no}</option>)}
          </select>
        </div>
        {(filterCompletion || filterStatus || filterContract || search) && (
          <button onClick={() => { setFilterCompletion(''); setFilterStatus(''); setFilterContract(''); setSearch(''); }}
            className="mt-2 text-xs text-[#C05728] hover:underline">
            ✕ مسح الفلاتر ({sorted.length} من {rows.length})
          </button>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <div className="animate-spin w-8 h-8 border-4 border-[#045859] border-t-transparent rounded-full mx-auto mb-2" />
          <p className="text-sm text-gray-400">جاري تحميل البيانات...</p>
        </div>
      ) : error ? (
        <div className="bg-white rounded-xl border border-red-200 p-6 text-center">
          <p className="text-sm text-red-600">⚠ {error}</p>
          <button onClick={load} className="mt-2 text-xs text-[#045859] hover:underline">إعادة المحاولة</button>
        </div>
      ) : sorted.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-sm text-gray-400">لا توجد مطالبات تطابق الفلاتر المحددة</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs print:text-[0.65rem]" style={{ minWidth: 760 }}>
              <thead>
                <tr style={{ background: '#045859', color: '#fff' }}>
                  {['رقم', 'العقد', 'حالة المطالبة', 'فاتورة *', 'مستند مطالبة *', 'اعتماد / شهادة', 'أخرى', 'إجمالي المستندات', 'حالة التوثيق', 'تاريخ التقديم'].map(h => (
                    <th key={h} className="px-2.5 py-2.5 text-right font-bold whitespace-nowrap border-l border-white/10">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((r, i) => {
                  const cs = COMPLETION_STYLES[r.completionStatus];
                  return (
                    <tr
                      key={r.id}
                      className={i % 2 === 0 ? 'bg-white' : 'bg-[#F7F8FA]'}
                      style={r.completionStatus === 'missing' ? { borderRight: '3px solid #C05728' } : r.completionStatus === 'partial' ? { borderRight: '3px solid #FFC845' } : {}}
                    >
                      <td className="px-2.5 py-2 font-bold text-[#045859] whitespace-nowrap">
                        <Link href={`/claims/${r.id}`} className="hover:underline">#{r.claimNo}</Link>
                      </td>
                      <td className="px-2.5 py-2 whitespace-nowrap">
                        <div className="font-bold text-gray-800">{r.contractNo}</div>
                        <div className="text-gray-400 text-[0.6rem]">{r.contractTitle}</div>
                      </td>
                      <td className="px-2.5 py-2">
                        <Badge status={r.status as ClaimStatus} />
                      </td>
                      <td className="px-2.5 py-2 text-center"><DocCell has={r.hasInvoice} /></td>
                      <td className="px-2.5 py-2 text-center"><DocCell has={r.hasClaimDoc} /></td>
                      <td className="px-2.5 py-2 text-center"><DocCell has={r.hasApprovalDoc} /></td>
                      <td className="px-2.5 py-2 text-center"><DocCell has={r.hasOtherDoc} /></td>
                      <td className="px-2.5 py-2 text-center tabular-nums text-gray-700 font-bold">{r.totalDocuments}</td>
                      <td className="px-2.5 py-2">
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.65rem] font-bold"
                          style={{ background: cs.bg, color: cs.text }}
                        >
                          <span>{cs.icon}</span>
                          {cs.label}
                        </span>
                      </td>
                      <td className="px-2.5 py-2 text-gray-500 whitespace-nowrap">
                        {r.submittedAt ? r.submittedAt.slice(0, 10) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 border-t border-gray-100 text-[0.65rem] text-gray-400 print:hidden">
            * المستندات الإلزامية لتقديم المطالبة (Rule G1)
          </div>
        </div>
      )}

      <div className="hidden print:block text-center pt-4 border-t border-gray-300 mt-4">
        <p className="text-[0.6rem] text-gray-400">CONVERA — طُبع: {new Date().toLocaleString('ar-SA')}</p>
      </div>
    </div>
  );
}
