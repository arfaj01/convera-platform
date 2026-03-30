'use client';

/**
 * CONVERA — تقرير المطالبات المالية
 * /reports/financial-claims
 *
 * Financial Claims Report with:
 * - KPI bar: total, approved, pending, returned, total value, approved value
 * - Filters: contract, status, date range, claim type
 * - Full data table with financial columns
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
import { fetchFinancialClaimsReport, type FinancialClaimRow } from '@/services/reports';
import { CLAIM_STATUS_LABELS, CONTRACT_TYPE_LABELS } from '@/lib/constants';
import type { ClaimStatus } from '@/lib/types';

// ─── Helpers ───────────────────────────────────────────────────────

function sar(v: number) {
  return v.toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ر.س';
}

function fmtDate(s: string) {
  if (!s) return '—';
  return s.slice(0, 10);
}

const CLAIM_TYPE_AR: Record<string, string> = {
  boq_only: 'جداول الكميات',
  staff_only: 'كوادر بشرية',
  mixed: 'مختلط',
  supervision: 'إشراف',
};

const ALL_STATUSES: ClaimStatus[] = [
  'submitted', 'under_supervisor_review', 'returned_by_supervisor',
  'under_auditor_review', 'returned_by_auditor',
  'under_reviewer_check', 'pending_director_approval', 'approved', 'rejected',
];

// ─── Page ──────────────────────────────────────────────────────────

export default function FinancialClaimsReportPage() {
  const { profile, loading: authLoading } = useAuth();
  const router = useRouter();

  const [rows, setRows] = useState<FinancialClaimRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [filterContract, setFilterContract] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
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
      const { rows: r } = await fetchFinancialClaimsReport();
      setRows(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ في تحميل البيانات');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Unique contracts for filter dropdown
  const contractOptions = useMemo(() => {
    const seen = new Map<string, string>();
    rows.forEach(r => { if (!seen.has(r.contractId)) seen.set(r.contractId, r.contractNo); });
    return Array.from(seen.entries()).map(([id, no]) => ({ id, no }));
  }, [rows]);

  // Filtered rows
  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (filterContract && r.contractId !== filterContract) return false;
      if (filterStatus && r.status !== filterStatus) return false;
      if (filterType && r.claimType !== filterType) return false;
      if (filterDateFrom && r.periodFrom && r.periodFrom < filterDateFrom) return false;
      if (filterDateTo && r.periodTo && r.periodTo > filterDateTo) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !String(r.claimNo).includes(q) &&
          !r.contractNo.toLowerCase().includes(q) &&
          !r.contractTitle.toLowerCase().includes(q) &&
          !r.referenceNo.toLowerCase().includes(q)
        ) return false;
      }
      return true;
    });
  }, [rows, filterContract, filterStatus, filterType, filterDateFrom, filterDateTo, search]);

  // KPI from filtered
  const kpiCards: KPICard[] = useMemo(() => {
    const approved = filtered.filter(r => r.status === 'approved');
    const pending = filtered.filter(r =>
      ['submitted', 'under_supervisor_review', 'under_auditor_review',
       'under_reviewer_check', 'pending_director_approval'].includes(r.status)
    );
    const returned = filtered.filter(r =>
      ['returned_by_supervisor', 'returned_by_auditor'].includes(r.status)
    );
    const totalVal = filtered.reduce((s, r) => s + r.totalAmount, 0);
    const approvedVal = approved.reduce((s, r) => s + r.totalAmount, 0);
    const pendingVal = pending.reduce((s, r) => s + r.totalAmount, 0);

    return [
      { label: 'إجمالي المطالبات', value: filtered.length, icon: '📄', variant: 'default' },
      { label: 'معتمدة', value: approved.length, icon: '✅', variant: 'success' },
      { label: 'قيد المراجعة', value: pending.length, icon: '⏳', variant: 'warning' },
      { label: 'مُرجَّعة', value: returned.length, icon: '↩', variant: 'danger' },
      {
        label: 'إجمالي القيمة',
        value: totalVal.toLocaleString('ar-SA', { maximumFractionDigits: 0 }),
        subLabel: 'ر.س',
        icon: '💵',
        variant: 'info',
      },
      {
        label: 'المعتمد',
        value: approvedVal.toLocaleString('ar-SA', { maximumFractionDigits: 0 }),
        subLabel: 'ر.س',
        icon: '💎',
        variant: 'success',
      },
      {
        label: 'قيد الصرف',
        value: pendingVal.toLocaleString('ar-SA', { maximumFractionDigits: 0 }),
        subLabel: 'ر.س',
        icon: '🔄',
        variant: 'warning',
      },
    ];
  }, [filtered]);

  const handleExport = () => {
    exportToCSV(
      [
        { key: 'claimNo', label: 'رقم المطالبة' },
        { key: 'contractNo', label: 'رقم العقد' },
        { key: 'contractTitle', label: 'العقد' },
        { key: 'referenceNo', label: 'رقم المرجع' },
        { key: 'periodFrom', label: 'من' },
        { key: 'periodTo', label: 'إلى' },
        { key: 'claimType', label: 'النوع' },
        { key: 'status', label: 'الحالة' },
        { key: 'boqAmount', label: 'جداول الكميات' },
        { key: 'staffAmount', label: 'الكوادر' },
        { key: 'grossAmount', label: 'الإجمالي' },
        { key: 'retentionAmount', label: 'الاستقطاع' },
        { key: 'netAmount', label: 'الصافي' },
        { key: 'vatAmount', label: 'الضريبة' },
        { key: 'totalAmount', label: 'الإجمالي النهائي' },
        { key: 'submittedAt', label: 'تاريخ التقديم' },
        { key: 'approvedAt', label: 'تاريخ الاعتماد' },
      ],
      filtered.map(r => ({ ...r, status: CLAIM_STATUS_LABELS[r.status as ClaimStatus] ?? r.status })),
      'تقرير_المطالبات_المالية',
    );
  };

  if (authLoading || (!profile && !error)) {
    return <div className="flex items-center justify-center h-48"><p className="text-sm text-gray-400 animate-pulse">جاري التحميل...</p></div>;
  }

  return (
    <div className="space-y-4 print:space-y-3" dir="rtl">
      {/* Print header */}
      <div className="hidden print:block text-center mb-4 pb-3 border-b border-gray-300">
        <h1 className="text-xl font-black text-[#045859]">تقرير المطالبات المالية</h1>
        <p className="text-xs text-gray-500 mt-1">منصة CONVERA — وزارة البلديات والإسكان — {new Date().toLocaleDateString('ar-SA')}</p>
      </div>

      <PageHeader
        title="تقرير المطالبات المالية"
        subtitle="تحليل شامل لجميع المطالبات المالية مع التفاصيل المحاسبية والحالات"
        action={<ExportButton onExportCSV={handleExport} disabled={loading || filtered.length === 0} reportTitle="تقرير المطالبات المالية" />}
      />

      {/* KPI Bar */}
      <ReportKPIBar cards={kpiCards} className="grid-cols-2 sm:grid-cols-4 lg:grid-cols-7" />

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 print:hidden">
        <p className="text-xs font-bold text-gray-500 mb-3 flex items-center gap-1.5">
          <span>🔍</span> الفلاتر والبحث
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
          {/* Search */}
          <input
            type="text"
            placeholder="بحث... رقم / عقد / مرجع"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="col-span-2 border border-gray-200 rounded px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#045859] text-right"
          />
          {/* Contract */}
          <select
            value={filterContract}
            onChange={e => setFilterContract(e.target.value)}
            className="border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#045859] text-right"
          >
            <option value="">كل العقود</option>
            {contractOptions.map(c => (
              <option key={c.id} value={c.id}>{c.no}</option>
            ))}
          </select>
          {/* Status */}
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
          {/* Date from/to */}
          <input
            type="date"
            value={filterDateFrom}
            onChange={e => setFilterDateFrom(e.target.value)}
            className="border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#045859]"
            title="الفترة من"
          />
          <input
            type="date"
            value={filterDateTo}
            onChange={e => setFilterDateTo(e.target.value)}
            className="border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#045859]"
            title="الفترة إلى"
          />
        </div>
        {(filterContract || filterStatus || filterDateFrom || filterDateTo || search || filterType) && (
          <button
            onClick={() => { setFilterContract(''); setFilterStatus(''); setFilterType(''); setFilterDateFrom(''); setFilterDateTo(''); setSearch(''); }}
            className="mt-2 text-xs text-[#C05728] hover:underline"
          >
            ✕ مسح الفلاتر ({filtered.length} من {rows.length})
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
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-sm text-gray-400">لا توجد بيانات تطابق الفلاتر المحددة</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs print:text-[0.65rem]" style={{ minWidth: 900 }}>
              <thead>
                <tr style={{ background: '#045859', color: '#fff' }}>
                  {['رقم', 'العقد', 'الفترة', 'جداول الكميات', 'الكوادر', 'الإجمالي', 'الاستقطاع', 'الصافي', 'الضريبة', 'الإجمالي النهائي', 'الحالة', 'الاعتماد'].map(h => (
                    <th key={h} className="px-2.5 py-2.5 text-right font-bold whitespace-nowrap border-l border-white/10">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <tr key={r.id} className={i % 2 === 0 ? 'bg-white' : 'bg-[#F7F8FA]'}>
                    <td className="px-2.5 py-2 font-bold text-[#045859] whitespace-nowrap">
                      <Link href={`/claims/${r.id}`} className="hover:underline">#{r.claimNo}</Link>
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap">
                      <div className="font-bold text-gray-800">{r.contractNo}</div>
                      <div className="text-gray-400 text-[0.6rem]">{r.contractTitle}</div>
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap text-gray-600">
                      {fmtDate(r.periodFrom)} — {fmtDate(r.periodTo)}
                    </td>
                    <td className="px-2.5 py-2 text-left tabular-nums">{r.boqAmount > 0 ? sar(r.boqAmount) : '—'}</td>
                    <td className="px-2.5 py-2 text-left tabular-nums">{r.staffAmount > 0 ? sar(r.staffAmount) : '—'}</td>
                    <td className="px-2.5 py-2 text-left tabular-nums font-bold">{sar(r.grossAmount)}</td>
                    <td className="px-2.5 py-2 text-left tabular-nums text-[#C05728]">{r.retentionAmount > 0 ? `(${sar(r.retentionAmount)})` : '—'}</td>
                    <td className="px-2.5 py-2 text-left tabular-nums">{sar(r.netAmount)}</td>
                    <td className="px-2.5 py-2 text-left tabular-nums text-gray-500">{sar(r.vatAmount)}</td>
                    <td className="px-2.5 py-2 text-left tabular-nums font-black text-[#045859]">{sar(r.totalAmount)}</td>
                    <td className="px-2.5 py-2">
                      <Badge status={r.status as ClaimStatus} />
                    </td>
                    <td className="px-2.5 py-2 text-gray-500 whitespace-nowrap">{fmtDate(r.approvedAt ?? '')}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: '#045859', color: '#fff' }}>
                  <td colSpan={3} className="px-2.5 py-2 font-black text-right">الإجماليات ({filtered.length} مطالبة)</td>
                  <td className="px-2.5 py-2 text-left tabular-nums">{sar(filtered.reduce((s, r) => s + r.boqAmount, 0))}</td>
                  <td className="px-2.5 py-2 text-left tabular-nums">{sar(filtered.reduce((s, r) => s + r.staffAmount, 0))}</td>
                  <td className="px-2.5 py-2 text-left tabular-nums font-bold">{sar(filtered.reduce((s, r) => s + r.grossAmount, 0))}</td>
                  <td className="px-2.5 py-2 text-left tabular-nums">{sar(filtered.reduce((s, r) => s + r.retentionAmount, 0))}</td>
                  <td className="px-2.5 py-2 text-left tabular-nums">{sar(filtered.reduce((s, r) => s + r.netAmount, 0))}</td>
                  <td className="px-2.5 py-2 text-left tabular-nums">{sar(filtered.reduce((s, r) => s + r.vatAmount, 0))}</td>
                  <td className="px-2.5 py-2 text-left tabular-nums font-black">{sar(filtered.reduce((s, r) => s + r.totalAmount, 0))}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Print footer */}
      <div className="hidden print:block text-center pt-4 border-t border-gray-300 mt-4">
        <p className="text-[0.6rem] text-gray-400">
          CONVERA — منصة إدارة المطالبات المالية | وزارة البلديات والإسكان | طُبع: {new Date().toLocaleString('ar-SA')}
        </p>
      </div>
    </div>
  );
}
