'use client';

/**
 * CONVERA — تقرير التأخير والزمن
 * /reports/delay-time
 *
 * Delay & Time Report:
 * - KPI: total pending, SLA breached, SLA warning, avg days, oldest claim
 * - Shows non-terminal claims with days in current stage
 * - SLA breach = supervisor stage > 3 days (per CLAUDE.md Rule G4)
 * - Filters: status/stage, contract, SLA status, min days
 * - Red/amber/green color coding
 * - CSV export + Print
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import PageHeader from '@/components/ui/PageHeader';
import ReportKPIBar, { type KPICard } from '@/components/reports/ReportKPIBar';
import ExportButton, { exportToCSV } from '@/components/reports/ExportButton';
import { fetchDelayReport, type DelayRow } from '@/services/reports';
import { CLAIM_STATUS_LABELS } from '@/lib/constants';
import type { ClaimStatus } from '@/lib/types';

const SLA_COLORS = {
  ok:       { bg: '#F0F7E0', text: '#4A7B00', label: 'ضمن المدة' },
  warning:  { bg: '#FFF8E0', text: '#B8860B', label: 'تحذير' },
  breached: { bg: '#FAEEE8', text: '#C05728', label: 'خرق SLA' },
};

function DaysChip({ days, sla }: { days: number; sla: DelayRow['slaStatus'] }) {
  const c = SLA_COLORS[sla];
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-black"
      style={{ background: c.bg, color: c.text }}
    >
      {sla !== 'ok' && (sla === 'breached' ? '🔴' : '🟡')}
      {days} يوم
    </span>
  );
}

const ACTIVE_STATUSES: ClaimStatus[] = [
  'submitted', 'under_supervisor_review', 'returned_by_supervisor',
  'under_auditor_review', 'returned_by_auditor',
  'under_reviewer_check', 'pending_director_approval',
];

export default function DelayTimePage() {
  const { profile, loading: authLoading } = useAuth();
  const router = useRouter();

  const [rows, setRows] = useState<DelayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filterSLA, setFilterSLA] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [minDays, setMinDays] = useState('');
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
      const { rows: r } = await fetchDelayReport();
      setRows(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ في تحميل البيانات');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const minD = minDays ? parseInt(minDays, 10) : 0;
    return rows.filter(r => {
      if (filterSLA && r.slaStatus !== filterSLA) return false;
      if (filterStatus && r.status !== filterStatus) return false;
      if (minD > 0 && r.daysInStage < minD) return false;
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
  }, [rows, filterSLA, filterStatus, minDays, search]);

  // Sort: breached first, then warning, then ok — then by days desc
  const sorted = useMemo(() => {
    const priority = { breached: 0, warning: 1, ok: 2 };
    return [...filtered].sort((a, b) => {
      const pd = priority[a.slaStatus] - priority[b.slaStatus];
      if (pd !== 0) return pd;
      return b.daysInStage - a.daysInStage;
    });
  }, [filtered]);

  const kpiCards: KPICard[] = useMemo(() => {
    const breached = filtered.filter(r => r.slaStatus === 'breached');
    const warning = filtered.filter(r => r.slaStatus === 'warning');
    const avg = filtered.length > 0
      ? Math.round(filtered.reduce((s, r) => s + r.daysInStage, 0) / filtered.length)
      : 0;
    const oldest = filtered.length > 0 ? Math.max(...filtered.map(r => r.daysInStage)) : 0;

    return [
      { label: 'مطالبات قيد الانتظار', value: filtered.length, icon: '📋', variant: 'default' },
      { label: 'خرق SLA', value: breached.length, icon: '🔴', variant: breached.length > 0 ? 'danger' : 'success', subLabel: breached.length > 0 ? 'تتطلب تدخلاً فورياً' : 'لا يوجد' },
      { label: 'تحذير SLA', value: warning.length, icon: '🟡', variant: warning.length > 0 ? 'warning' : 'success', subLabel: warning.length > 0 ? 'يُوصى بالمتابعة' : 'لا يوجد' },
      { label: 'متوسط الأيام في المرحلة', value: avg, icon: '📅', variant: avg > 7 ? 'warning' : 'info', subLabel: 'يوم' },
      { label: 'أقدم مطالبة', value: oldest, icon: '⏱', variant: oldest > 14 ? 'danger' : oldest > 7 ? 'warning' : 'info', subLabel: 'يوم في المرحلة الحالية' },
    ];
  }, [filtered]);

  const handleExport = () => {
    exportToCSV(
      [
        { key: 'claimNo', label: 'رقم المطالبة' },
        { key: 'contractNo', label: 'رقم العقد' },
        { key: 'contractTitle', label: 'العقد' },
        { key: 'currentStage', label: 'المرحلة الحالية' },
        { key: 'daysInStage', label: 'الأيام في المرحلة' },
        { key: 'slaStatus', label: 'حالة SLA' },
        { key: 'lastActorName', label: 'آخر إجراء بواسطة' },
        { key: 'lastActionAt', label: 'تاريخ آخر إجراء' },
        { key: 'submittedAt', label: 'تاريخ التقديم' },
      ],
      sorted.map(r => ({
        ...r,
        slaStatus: SLA_COLORS[r.slaStatus].label,
        lastActionAt: r.lastActionAt ? r.lastActionAt.slice(0, 10) : '',
        submittedAt: r.submittedAt ? r.submittedAt.slice(0, 10) : '',
      })),
      'تقرير_التأخير_والزمن',
    );
  };

  if (authLoading || (!profile && !error)) {
    return <div className="flex items-center justify-center h-48"><p className="text-sm text-gray-400 animate-pulse">جاري التحميل...</p></div>;
  }

  return (
    <div className="space-y-4 print:space-y-3" dir="rtl">
      <div className="hidden print:block text-center mb-4 pb-3 border-b border-gray-300">
        <h1 className="text-xl font-black text-[#045859]">تقرير التأخير والزمن</h1>
        <p className="text-xs text-gray-500 mt-1">منصة CONVERA — وزارة البلديات والإسكان — {new Date().toLocaleDateString('ar-SA')}</p>
      </div>

      <PageHeader
        title="تقرير التأخير والزمن"
        subtitle="المطالبات قيد الانتظار، خروقات SLA جهة الإشراف (3 أيام)، وعدد أيام كل مرحلة"
        action={<ExportButton onExportCSV={handleExport} disabled={loading || sorted.length === 0} reportTitle="تقرير التأخير والزمن" />}
      />

      <ReportKPIBar cards={kpiCards} className="grid-cols-2 sm:grid-cols-3 lg:grid-cols-5" />

      {/* SLA rule reminder */}
      <div className="flex items-start gap-3 p-3 rounded-lg border text-xs bg-[#FFF8E0] border-[#FFC84540] print:hidden">
        <span>ℹ</span>
        <p className="text-gray-600">
          <span className="font-bold text-[#B8860B]">قاعدة SLA جهة الإشراف:</span> الحد الأقصى 3 أيام عمل.
          تُرسل تنبيهات في اليوم الثاني، ويُصعَّد للمدير في اليوم الثالث.
          المراحل الأخرى: تحذير عند 7 أيام، خرق عند 14 يوم.
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
            value={filterSLA}
            onChange={e => setFilterSLA(e.target.value)}
            className="border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#045859] text-right"
          >
            <option value="">كل حالات SLA</option>
            <option value="breached">خرق SLA</option>
            <option value="warning">تحذير</option>
            <option value="ok">ضمن المدة</option>
          </select>
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#045859] text-right"
          >
            <option value="">كل المراحل</option>
            {ACTIVE_STATUSES.map(s => (
              <option key={s} value={s}>{CLAIM_STATUS_LABELS[s]}</option>
            ))}
          </select>
          <div className="flex items-center gap-1 col-span-2 md:col-span-1">
            <label className="text-xs text-gray-500 whitespace-nowrap">الحد الأدنى للأيام:</label>
            <input
              type="number"
              min="0"
              value={minDays}
              onChange={e => setMinDays(e.target.value)}
              placeholder="0"
              className="flex-1 border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#045859]"
            />
          </div>
        </div>
        {(filterSLA || filterStatus || minDays || search) && (
          <button onClick={() => { setFilterSLA(''); setFilterStatus(''); setMinDays(''); setSearch(''); }}
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
        <div className="bg-white rounded-xl border border-[#F0F7E0] p-8 text-center">
          <div className="text-3xl mb-2">✅</div>
          <p className="text-sm font-bold text-[#87BA26]">لا توجد مطالبات معلقة</p>
          <p className="text-xs text-gray-400 mt-1">جميع المطالبات إما مكتملة أو لا توجد مطالبات نشطة</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs print:text-[0.65rem]" style={{ minWidth: 760 }}>
              <thead>
                <tr style={{ background: '#045859', color: '#fff' }}>
                  {['رقم', 'العقد', 'المرحلة الحالية', 'أيام في المرحلة', 'حالة SLA', 'آخر إجراء بواسطة', 'تاريخ آخر إجراء', 'تاريخ التقديم'].map(h => (
                    <th key={h} className="px-2.5 py-2.5 text-right font-bold whitespace-nowrap border-l border-white/10">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((r, i) => {
                  const slac = SLA_COLORS[r.slaStatus];
                  return (
                    <tr
                      key={r.id}
                      className={i % 2 === 0 ? 'bg-white' : 'bg-[#F7F8FA]'}
                      style={r.slaStatus === 'breached' ? { borderRight: '3px solid #C05728' } : r.slaStatus === 'warning' ? { borderRight: '3px solid #FFC845' } : {}}
                    >
                      <td className="px-2.5 py-2 font-bold text-[#045859] whitespace-nowrap">
                        <Link href={`/claims/${r.id}`} className="hover:underline">#{r.claimNo}</Link>
                      </td>
                      <td className="px-2.5 py-2 whitespace-nowrap">
                        <div className="font-bold text-gray-800">{r.contractNo}</div>
                        <div className="text-gray-400 text-[0.6rem]">{r.contractTitle}</div>
                      </td>
                      <td className="px-2.5 py-2 text-gray-700">{r.currentStage}</td>
                      <td className="px-2.5 py-2">
                        <DaysChip days={r.daysInStage} sla={r.slaStatus} />
                      </td>
                      <td className="px-2.5 py-2">
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-[0.65rem] font-bold"
                          style={{ background: slac.bg, color: slac.text }}
                        >
                          {slac.label}
                        </span>
                      </td>
                      <td className="px-2.5 py-2 text-gray-600">{r.lastActorName}</td>
                      <td className="px-2.5 py-2 text-gray-500 whitespace-nowrap">
                        {r.lastActionAt ? r.lastActionAt.slice(0, 10) : '—'}
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
          <div className="px-4 py-2 border-t border-gray-100 flex gap-4 text-[0.65rem] text-gray-400 print:hidden">
            <span className="flex items-center gap-1"><span className="w-2 h-full border-r-4 border-[#C05728] inline-block" /> خرق SLA — يتطلب تدخلاً فورياً</span>
            <span className="flex items-center gap-1"><span className="w-2 h-full border-r-4 border-[#FFC845] inline-block" /> تحذير — مراجعة مُوصى بها</span>
          </div>
        </div>
      )}

      <div className="hidden print:block text-center pt-4 border-t border-gray-300 mt-4">
        <p className="text-[0.6rem] text-gray-400">CONVERA — طُبع: {new Date().toLocaleString('ar-SA')}</p>
      </div>
    </div>
  );
}
