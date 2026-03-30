'use client';

/**
 * CONVERA — تقرير العقود
 * /reports/contracts
 *
 * Contracts Report with:
 * - KPI bar: portfolio value, spent, remaining, active/completed count
 * - Filters: type, status, search
 * - Table with spend % bar, ceiling proximity warning
 * - CSV export + Print
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import PageHeader from '@/components/ui/PageHeader';
import ReportKPIBar, { type KPICard } from '@/components/reports/ReportKPIBar';
import ExportButton, { exportToCSV } from '@/components/reports/ExportButton';
import { fetchContractsReport, type ContractReportRow } from '@/services/reports';
import { CONTRACT_TYPE_LABELS } from '@/lib/constants';
import type { ContractType } from '@/lib/types';

function sar(v: number) {
  return v.toLocaleString('ar-SA', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' ر.س';
}

const CONTRACT_STATUS_AR: Record<string, string> = {
  draft: 'مسودة',
  active: 'نشط',
  completed: 'مكتمل',
  suspended: 'موقوف',
  closed: 'مغلق',
};

const CONTRACT_STATUS_COLOR: Record<string, string> = {
  active: '#87BA26',
  completed: '#045859',
  suspended: '#FFC845',
  closed: '#54565B',
  draft: '#54565B',
};

function SpendBar({ pct }: { pct: number }) {
  const clampedPct = Math.min(pct, 100);
  const color = pct >= 90 ? '#C05728' : pct >= 70 ? '#FFC845' : '#87BA26';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden" style={{ minWidth: 60 }}>
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${clampedPct}%`, background: color }}
        />
      </div>
      <span className="text-xs font-bold tabular-nums" style={{ color, minWidth: 36 }}>
        {pct.toFixed(1)}%
      </span>
    </div>
  );
}

export default function ContractsReportPage() {
  const { profile, loading: authLoading } = useAuth();
  const router = useRouter();

  const [rows, setRows] = useState<ContractReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
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
      const { rows: r } = await fetchContractsReport();
      setRows(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ في تحميل البيانات');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (filterType && r.type !== filterType) return false;
      if (filterStatus && r.status !== filterStatus) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !r.contractNo.toLowerCase().includes(q) &&
          !r.title.toLowerCase().includes(q) &&
          !r.partyName.toLowerCase().includes(q)
        ) return false;
      }
      return true;
    });
  }, [rows, filterType, filterStatus, search]);

  const kpiCards: KPICard[] = useMemo(() => {
    const active = filtered.filter(r => r.status === 'active');
    const completed = filtered.filter(r => r.status === 'completed');
    const nearCeiling = filtered.filter(r => r.spentPct >= 90);
    const totalPortfolio = filtered.reduce((s, r) => s + r.totalValue, 0);
    const totalSpent = filtered.reduce((s, r) => s + r.approvedClaimsValue, 0);
    const totalRemaining = filtered.reduce((s, r) => s + r.remainingValue, 0);

    return [
      { label: 'إجمالي العقود', value: filtered.length, icon: '📋', variant: 'default' },
      { label: 'نشطة', value: active.length, icon: '✅', variant: 'success' },
      { label: 'مكتملة', value: completed.length, icon: '🏁', variant: 'info' },
      { label: 'قرب السقف (90%+)', value: nearCeiling.length, icon: '⚠', variant: 'danger' },
      { label: 'قيمة المحفظة', value: totalPortfolio.toLocaleString('ar-SA', { maximumFractionDigits: 0 }), subLabel: 'ر.س', icon: '💰', variant: 'default' },
      { label: 'إجمالي المصروف', value: totalSpent.toLocaleString('ar-SA', { maximumFractionDigits: 0 }), subLabel: 'ر.س', icon: '💸', variant: 'warning' },
      { label: 'إجمالي المتبقي', value: totalRemaining.toLocaleString('ar-SA', { maximumFractionDigits: 0 }), subLabel: 'ر.س', icon: '🏦', variant: 'success' },
    ];
  }, [filtered]);

  const handleExport = () => {
    exportToCSV(
      [
        { key: 'contractNo', label: 'رقم العقد' },
        { key: 'title', label: 'المسمى' },
        { key: 'type', label: 'النوع' },
        { key: 'status', label: 'الحالة' },
        { key: 'partyName', label: 'الجهة المنفذة' },
        { key: 'baseValue', label: 'القيمة الأساسية' },
        { key: 'totalValue', label: 'القيمة بالضريبة' },
        { key: 'retentionPct', label: 'نسبة الاستقطاع %' },
        { key: 'startDate', label: 'تاريخ البداية' },
        { key: 'endDate', label: 'تاريخ النهاية' },
        { key: 'durationMonths', label: 'المدة (شهر)' },
        { key: 'claimCount', label: 'عدد المطالبات المعتمدة' },
        { key: 'approvedClaimsValue', label: 'إجمالي المطالبات المعتمدة' },
        { key: 'spentPct', label: 'نسبة الاستهلاك %' },
        { key: 'remainingValue', label: 'المتبقي' },
      ],
      filtered.map(r => ({
        ...r,
        type: CONTRACT_TYPE_LABELS[r.type as ContractType] ?? r.type,
        status: CONTRACT_STATUS_AR[r.status] ?? r.status,
        spentPct: r.spentPct.toFixed(2),
      })),
      'تقرير_العقود',
    );
  };

  if (authLoading || (!profile && !error)) {
    return <div className="flex items-center justify-center h-48"><p className="text-sm text-gray-400 animate-pulse">جاري التحميل...</p></div>;
  }

  return (
    <div className="space-y-4 print:space-y-3" dir="rtl">
      <div className="hidden print:block text-center mb-4 pb-3 border-b border-gray-300">
        <h1 className="text-xl font-black text-[#045859]">تقرير العقود</h1>
        <p className="text-xs text-gray-500 mt-1">منصة CONVERA — وزارة البلديات والإسكان — {new Date().toLocaleDateString('ar-SA')}</p>
      </div>

      <PageHeader
        title="تقرير العقود"
        subtitle="ملخص محفظة العقود — القيمة، الاستهلاك، السقف التعاقدي، والمتبقي"
        action={<ExportButton onExportCSV={handleExport} disabled={loading || filtered.length === 0} reportTitle="تقرير العقود" />}
      />

      <ReportKPIBar cards={kpiCards} className="grid-cols-2 sm:grid-cols-4 lg:grid-cols-7" />

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 print:hidden">
        <p className="text-xs font-bold text-gray-500 mb-3 flex items-center gap-1.5"><span>🔍</span> الفلاتر والبحث</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <input
            type="text"
            placeholder="بحث... رقم / اسم / جهة"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="col-span-2 border border-gray-200 rounded px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#045859] text-right"
          />
          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
            className="border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#045859] text-right"
          >
            <option value="">كل الأنواع</option>
            {Object.entries(CONTRACT_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#045859] text-right"
          >
            <option value="">كل الحالات</option>
            {Object.entries(CONTRACT_STATUS_AR).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        {(filterType || filterStatus || search) && (
          <button
            onClick={() => { setFilterType(''); setFilterStatus(''); setSearch(''); }}
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
          <p className="text-sm text-gray-400">لا توجد عقود تطابق الفلاتر</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs print:text-[0.65rem]" style={{ minWidth: 900 }}>
              <thead>
                <tr style={{ background: '#045859', color: '#fff' }}>
                  {['رقم العقد', 'المسمى', 'النوع', 'الحالة', 'الجهة', 'القيمة الأساسية', 'ق. بالضريبة', 'المطالبات', 'الصرف', 'نسبة الاستهلاك', 'المتبقي', 'المدة', 'التاريخ'].map(h => (
                    <th key={h} className="px-2.5 py-2.5 text-right font-bold whitespace-nowrap border-l border-white/10">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <tr
                    key={r.id}
                    className={`${i % 2 === 0 ? 'bg-white' : 'bg-[#F7F8FA]'} ${r.spentPct >= 90 ? 'ring-1 ring-inset ring-[#C05728]/20' : ''}`}
                  >
                    <td className="px-2.5 py-2 font-bold text-[#045859] whitespace-nowrap">
                      <Link href={`/contracts/${r.id}`} className="hover:underline">{r.contractNo}</Link>
                    </td>
                    <td className="px-2.5 py-2 max-w-[180px]">
                      <div className="font-bold text-gray-800 truncate">{r.title}</div>
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap text-gray-600">
                      {CONTRACT_TYPE_LABELS[r.type as ContractType] ?? r.type}
                    </td>
                    <td className="px-2.5 py-2">
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-[0.65rem] font-bold"
                        style={{ background: `${CONTRACT_STATUS_COLOR[r.status] ?? '#54565B'}20`, color: CONTRACT_STATUS_COLOR[r.status] ?? '#54565B' }}
                      >
                        {CONTRACT_STATUS_AR[r.status] ?? r.status}
                      </span>
                    </td>
                    <td className="px-2.5 py-2 text-gray-600 max-w-[120px] truncate">{r.partyName}</td>
                    <td className="px-2.5 py-2 text-left tabular-nums">{sar(r.baseValue)}</td>
                    <td className="px-2.5 py-2 text-left tabular-nums font-bold">{sar(r.totalValue)}</td>
                    <td className="px-2.5 py-2 text-center tabular-nums text-gray-600">{r.claimCount}</td>
                    <td className="px-2.5 py-2 text-left tabular-nums">{sar(r.approvedClaimsValue)}</td>
                    <td className="px-2.5 py-2" style={{ minWidth: 120 }}>
                      <SpendBar pct={r.spentPct} />
                    </td>
                    <td className="px-2.5 py-2 text-left tabular-nums text-[#87BA26] font-bold">{sar(r.remainingValue)}</td>
                    <td className="px-2.5 py-2 text-center text-gray-600">{r.durationMonths} ش</td>
                    <td className="px-2.5 py-2 whitespace-nowrap text-gray-500 text-[0.65rem]">
                      {r.startDate.slice(0, 10)} →<br/>{r.endDate.slice(0, 10)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: '#045859', color: '#fff' }}>
                  <td colSpan={5} className="px-2.5 py-2 font-black">الإجماليات ({filtered.length} عقد)</td>
                  <td className="px-2.5 py-2 text-left tabular-nums">{sar(filtered.reduce((s, r) => s + r.baseValue, 0))}</td>
                  <td className="px-2.5 py-2 text-left tabular-nums font-bold">{sar(filtered.reduce((s, r) => s + r.totalValue, 0))}</td>
                  <td className="px-2.5 py-2 text-center">{filtered.reduce((s, r) => s + r.claimCount, 0)}</td>
                  <td className="px-2.5 py-2 text-left tabular-nums">{sar(filtered.reduce((s, r) => s + r.approvedClaimsValue, 0))}</td>
                  <td />
                  <td className="px-2.5 py-2 text-left tabular-nums">{sar(filtered.reduce((s, r) => s + r.remainingValue, 0))}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      <div className="hidden print:block text-center pt-4 border-t border-gray-300 mt-4">
        <p className="text-[0.6rem] text-gray-400">CONVERA — منصة إدارة المطالبات المالية | طُبع: {new Date().toLocaleString('ar-SA')}</p>
      </div>
    </div>
  );
}
