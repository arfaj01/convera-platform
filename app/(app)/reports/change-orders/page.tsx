'use client';

/**
 * CONVERA — تقرير أوامر التغيير
 * /reports/change-orders
 *
 * Change Orders Report:
 * - KPI: total, approved, pending, total value, avg cumulative %, warning contracts
 * - Filters: contract, type, status, search
 * - Cumulative % bar per contract + 10% limit indicator
 * - CSV export + Print
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import PageHeader from '@/components/ui/PageHeader';
import ReportKPIBar, { type KPICard } from '@/components/reports/ReportKPIBar';
import ExportButton, { exportToCSV } from '@/components/reports/ExportButton';
import { fetchChangeOrdersReport, type ChangeOrderRow } from '@/services/reports';
import { CHANGE_ORDER_TYPE_LABELS, CHANGE_ORDER_STATUS_LABELS } from '@/lib/constants';
import type { ChangeOrderType, ChangeOrderStatus } from '@/lib/types';

function sar(v: number) {
  return v.toLocaleString('ar-SA', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' ر.س';
}

function fmtDate(s: string) {
  return s ? s.slice(0, 10) : '—';
}

// 10% ceiling progress bar
function CeilingBar({ pct }: { pct: number }) {
  const clamped = Math.min(pct, 10);
  const fill = (clamped / 10) * 100;
  const color = pct >= 10 ? '#C05728' : pct >= 8 ? '#FFC845' : '#87BA26';
  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1 bg-gray-100 rounded-full h-2 overflow-visible" style={{ minWidth: 70 }}>
        {/* 10% ceiling marker */}
        <div className="absolute top-0 bottom-0 right-0 w-px bg-[#C05728] opacity-60" />
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.min(fill, 100)}%`, background: color }}
        />
      </div>
      <span className="text-xs font-bold tabular-nums" style={{ color, minWidth: 40 }}>
        {pct.toFixed(1)}%
      </span>
    </div>
  );
}

const CO_STATUS_COLORS: Record<string, string> = {
  approved:                    '#87BA26',
  rejected:                    '#C05728',
  draft:                       '#54565B',
  submitted:                   '#FFC845',
  under_supervisor_review:     '#00A79D',
  under_auditor_review:        '#502C7C',
  under_reviewer_check:        '#C05728',
  pending_director_approval:   '#045859',
};

export default function ChangeOrdersReportPage() {
  const { profile, loading: authLoading } = useAuth();
  const router = useRouter();

  const [rows, setRows] = useState<ChangeOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filterContract, setFilterContract] = useState('');
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
      const { rows: r } = await fetchChangeOrdersReport();
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
    rows.forEach(r => { if (!seen.has(r.contractId)) seen.set(r.contractId, r.contractNo); });
    return Array.from(seen.entries()).map(([id, no]) => ({ id, no }));
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (filterContract && r.contractId !== filterContract) return false;
      if (filterType && r.scopeType !== filterType) return false;
      if (filterStatus && r.status !== filterStatus) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !r.orderNo.toLowerCase().includes(q) &&
          !r.contractNo.toLowerCase().includes(q) &&
          !r.contractTitle.toLowerCase().includes(q) &&
          !r.description.toLowerCase().includes(q)
        ) return false;
      }
      return true;
    });
  }, [rows, filterContract, filterType, filterStatus, search]);

  const kpiCards: KPICard[] = useMemo(() => {
    const approved = filtered.filter(r => r.status === 'approved');
    const pending = filtered.filter(r =>
      ['submitted', 'under_supervisor_review', 'under_auditor_review',
       'under_reviewer_check', 'pending_director_approval'].includes(r.status)
    );
    const rejected = filtered.filter(r => r.status === 'rejected');
    const approaching = new Set(filtered.filter(r => r.cumulativePct >= 8).map(r => r.contractId)).size;
    const exceeded = new Set(filtered.filter(r => r.cumulativePct >= 10).map(r => r.contractId)).size;

    return [
      { label: 'إجمالي الأوامر', value: filtered.length, icon: '🔄', variant: 'default' },
      { label: 'معتمدة', value: approved.length, icon: '✅', variant: 'success' },
      { label: 'قيد المراجعة', value: pending.length, icon: '⏳', variant: 'warning' },
      { label: 'مرفوضة', value: rejected.length, icon: '✗', variant: 'danger' },
      {
        label: 'إجمالي القيمة المعتمدة',
        value: approved.reduce((s, r) => s + r.netValueChange, 0).toLocaleString('ar-SA', { maximumFractionDigits: 0 }),
        subLabel: 'ر.س',
        icon: '💰',
        variant: 'info',
      },
      {
        label: 'عقود تقترب من 10%',
        value: approaching,
        subLabel: approaching > 0 ? 'يتطلب مراجعة' : 'لا يوجد',
        icon: '⚠',
        variant: approaching > 0 ? 'warning' : 'success',
      },
      {
        label: 'عقود تجاوزت 10%',
        value: exceeded,
        subLabel: exceeded > 0 ? 'يُحظر اعتماد مزيد' : 'لا يوجد',
        icon: '🚫',
        variant: exceeded > 0 ? 'danger' : 'success',
      },
    ];
  }, [filtered]);

  const handleExport = () => {
    exportToCSV(
      [
        { key: 'orderNo', label: 'رقم الأمر' },
        { key: 'contractNo', label: 'رقم العقد' },
        { key: 'contractTitle', label: 'العقد' },
        { key: 'scopeType', label: 'النوع' },
        { key: 'status', label: 'الحالة' },
        { key: 'description', label: 'الوصف' },
        { key: 'contractBaseValue', label: 'القيمة الأساسية للعقد' },
        { key: 'valueAdded', label: 'مضاف' },
        { key: 'valueDeducted', label: 'محذوف' },
        { key: 'netValueChange', label: 'صافي التغيير' },
        { key: 'durationChange', label: 'تمديد المدة (شهر)' },
        { key: 'cumulativeImpact', label: 'التراكمي المعتمد' },
        { key: 'cumulativePct', label: 'نسبة الاستهلاك %' },
        { key: 'createdAt', label: 'تاريخ الإنشاء' },
        { key: 'approvedAt', label: 'تاريخ الاعتماد' },
      ],
      filtered.map(r => ({
        ...r,
        scopeType: CHANGE_ORDER_TYPE_LABELS[r.scopeType as ChangeOrderType] ?? r.scopeType,
        status: CHANGE_ORDER_STATUS_LABELS[r.status as ChangeOrderStatus] ?? r.status,
        cumulativePct: r.cumulativePct.toFixed(2),
        createdAt: r.createdAt.slice(0, 10),
        approvedAt: r.approvedAt ? r.approvedAt.slice(0, 10) : '',
      })),
      'تقرير_أوامر_التغيير',
    );
  };

  if (authLoading || (!profile && !error)) {
    return <div className="flex items-center justify-center h-48"><p className="text-sm text-gray-400 animate-pulse">جاري التحميل...</p></div>;
  }

  return (
    <div className="space-y-4 print:space-y-3" dir="rtl">
      <div className="hidden print:block text-center mb-4 pb-3 border-b border-gray-300">
        <h1 className="text-xl font-black text-[#045859]">تقرير أوامر التغيير</h1>
        <p className="text-xs text-gray-500 mt-1">منصة CONVERA — وزارة البلديات والإسكان — {new Date().toLocaleDateString('ar-SA')}</p>
      </div>

      <PageHeader
        title="تقرير أوامر التغيير"
        subtitle="متابعة أوامر التغيير، التراكمي، ونسبة الحد الأقصى (10%) لكل عقد"
        action={<ExportButton onExportCSV={handleExport} disabled={loading || filtered.length === 0} reportTitle="تقرير أوامر التغيير" />}
      />

      <ReportKPIBar cards={kpiCards} className="grid-cols-2 sm:grid-cols-4 lg:grid-cols-7" />

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 print:hidden">
        <p className="text-xs font-bold text-gray-500 mb-3 flex items-center gap-1.5"><span>🔍</span> الفلاتر والبحث</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <input
            type="text"
            placeholder="بحث... رقم / عقد / وصف"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="col-span-2 border border-gray-200 rounded px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#045859] text-right"
          />
          <select
            value={filterContract}
            onChange={e => setFilterContract(e.target.value)}
            className="border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#045859] text-right"
          >
            <option value="">كل العقود</option>
            {contractOptions.map(c => <option key={c.id} value={c.id}>{c.no}</option>)}
          </select>
          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
            className="border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#045859] text-right"
          >
            <option value="">كل الأنواع</option>
            {Object.entries(CHANGE_ORDER_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#045859] text-right"
          >
            <option value="">كل الحالات</option>
            {Object.entries(CHANGE_ORDER_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        {(filterContract || filterType || filterStatus || search) && (
          <button onClick={() => { setFilterContract(''); setFilterType(''); setFilterStatus(''); setSearch(''); }}
            className="mt-2 text-xs text-[#C05728] hover:underline">
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
          <p className="text-sm text-gray-400">لا توجد أوامر تطابق الفلاتر المحددة</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs print:text-[0.65rem]" style={{ minWidth: 860 }}>
              <thead>
                <tr style={{ background: '#045859', color: '#fff' }}>
                  {['رقم', 'العقد', 'النوع', 'الوصف', 'الحالة', 'قيمة التغيير', 'التمديد', 'التراكمي المعتمد', 'نسبة من الحد (10%)', 'الإنشاء', 'الاعتماد'].map(h => (
                    <th key={h} className="px-2.5 py-2.5 text-right font-bold whitespace-nowrap border-l border-white/10">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <tr key={r.id} className={`${i % 2 === 0 ? 'bg-white' : 'bg-[#F7F8FA]'} ${r.cumulativePct >= 10 ? 'ring-1 ring-inset ring-[#C05728]/30' : r.cumulativePct >= 8 ? 'ring-1 ring-inset ring-[#FFC845]/40' : ''}`}>
                    <td className="px-2.5 py-2 font-bold text-[#045859] whitespace-nowrap">{r.orderNo}</td>
                    <td className="px-2.5 py-2 whitespace-nowrap">
                      <div className="font-bold text-gray-800">{r.contractNo}</div>
                      <div className="text-gray-400 text-[0.6rem]">{r.contractTitle}</div>
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap text-gray-600">
                      {CHANGE_ORDER_TYPE_LABELS[r.scopeType as ChangeOrderType] ?? r.scopeType}
                    </td>
                    <td className="px-2.5 py-2 max-w-[160px]">
                      <span className="truncate block text-gray-600">{r.description || '—'}</span>
                    </td>
                    <td className="px-2.5 py-2">
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-[0.65rem] font-bold"
                        style={{ background: `${CO_STATUS_COLORS[r.status] ?? '#54565B'}20`, color: CO_STATUS_COLORS[r.status] ?? '#54565B' }}
                      >
                        {CHANGE_ORDER_STATUS_LABELS[r.status as ChangeOrderStatus] ?? r.status}
                      </span>
                    </td>
                    <td className="px-2.5 py-2 text-left tabular-nums font-bold" style={{ color: r.netValueChange >= 0 ? '#045859' : '#C05728' }}>
                      {r.netValueChange !== 0 ? sar(Math.abs(r.netValueChange)) : '—'}
                    </td>
                    <td className="px-2.5 py-2 text-center text-gray-600">
                      {r.durationChange > 0 ? `${r.durationChange} شهر` : '—'}
                    </td>
                    <td className="px-2.5 py-2 text-left tabular-nums text-gray-700">{sar(r.cumulativeImpact)}</td>
                    <td className="px-2.5 py-2" style={{ minWidth: 130 }}>
                      <CeilingBar pct={r.cumulativePct} />
                    </td>
                    <td className="px-2.5 py-2 text-gray-500 whitespace-nowrap">{fmtDate(r.createdAt)}</td>
                    <td className="px-2.5 py-2 text-gray-500 whitespace-nowrap">{fmtDate(r.approvedAt ?? '')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Legend */}
          <div className="px-4 py-2 border-t border-gray-100 flex gap-4 text-[0.65rem] text-gray-400 print:hidden">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-[#FFC845] inline-block" /> تقترب من 10% (≥ 8%)</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-[#C05728] inline-block" /> تجاوزت 10% — مقيَّدة</span>
          </div>
        </div>
      )}

      <div className="hidden print:block text-center pt-4 border-t border-gray-300 mt-4">
        <p className="text-[0.6rem] text-gray-400">CONVERA — طُبع: {new Date().toLocaleString('ar-SA')}</p>
      </div>
    </div>
  );
}
