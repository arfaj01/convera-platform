'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';

import PageHeader from '@/components/ui/PageHeader';
import { CustomBadge } from '@/components/ui/Badge';
import { fetchContracts } from '@/services/contracts';
import { fmt, fmtDate } from '@/lib/formatters';
import { CONTRACT_TYPE_LABELS } from '@/lib/constants';
import { isExternal } from '@/lib/permissions';
import type { ContractView, ContractStatus } from '@/lib/types';

// ─── No-scope empty state ─────────────────────────────────────────
function NoScopeState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: '#E8F4F4' }}>
        <svg className="w-8 h-8" style={{ color: '#045859' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <h3 className="text-base font-bold mb-2" style={{ color: '#045859' }}>
        لا توجد عقود مرتبطة بحسابك حالياً
      </h3>
      <p className="text-sm text-gray-500 max-w-sm leading-relaxed">
        تم تقييد صلاحياتك التشغيلية لعدم وجود عقود مرتبطة — تواصل مع مدير الإدارة لربط حسابك بالعقود المطلوبة
      </p>
    </div>
  );
}

// ─── Status display ───────────────────────────────────────────────
const STATUS_LABELS: Record<ContractStatus, string> = {
  draft:     'مسودة',
  active:    'نشط',
  completed: 'منتهي',
  suspended: 'معلق',
  closed:    'مغلق',
};

const STATUS_TOOLTIPS: Record<ContractStatus | 'all', string> = {
  all:       'عرض جميع العقود بغض النظر عن حالتها',
  active:    'عقود سارية المفعول وجارٍ تنفيذها حالياً',
  draft:     'عقود قيد الإعداد ولم تُفعَّل بعد — لا تظهر في التقارير المالية',
  completed: 'عقود اكتملت مدتها الزمنية المحددة',
  suspended: 'عقود موقوفة مؤقتاً بقرار إداري',
  closed:    'عقود أُغلقت نهائياً — لا يمكن تعديلها أو رفع مستخلصات عليها',
};

const STATUS_VARIANT: Record<ContractStatus, 'teal' | 'green' | 'gray' | 'orange' | 'red'> = {
  draft:     'gray',
  active:    'green',
  completed: 'teal',
  suspended: 'orange',
  closed:    'gray',
};

// ─── Contract row ─────────────────────────────────────────────────
function ContractRow({ contract }: { contract: ContractView }) {
  const router = useRouter();
  return (
    <tr
      className="hover:bg-teal-ultra cursor-pointer transition-colors"
      onClick={() => router.push(`/contracts/${contract.id}`)}
    >
      <td className="px-3 py-3 border-b border-gray-100">
        <span className="text-xs font-bold text-teal bg-teal-pale px-2 py-0.5 rounded">
          {contract.no}
        </span>
      </td>
      <td className="px-3 py-3 border-b border-gray-100">
        <div className="text-sm font-bold text-teal-dark leading-tight">{contract.title}</div>
        <div className="text-[0.72rem] text-gray-400 mt-0.5">{contract.party}</div>
      </td>
      <td className="px-3 py-3 border-b border-gray-100 text-xs text-gray-600">
        {contract.type}
      </td>
      <td className="px-3 py-3 border-b border-gray-100">
        <div className="text-sm font-bold text-teal-dark">{fmt(contract.value)}</div>
        <div className="text-[0.67rem] text-gray-400">ريال</div>
      </td>
      <td className="px-3 py-3 border-b border-gray-100 text-xs text-gray-600">
        {fmtDate(contract.start)}
      </td>
      <td className="px-3 py-3 border-b border-gray-100 text-xs text-gray-600">
        {contract.duration} شهر
      </td>
      <td className="px-3 py-3 border-b border-gray-100">
        <CustomBadge
          label={STATUS_LABELS[contract.status] || contract.status}
          variant={STATUS_VARIANT[contract.status] || 'gray'}
        />
      </td>
    </tr>
  );
}

// ─── Card view (mobile) ───────────────────────────────────────────
function ContractCard({ contract }: { contract: ContractView }) {
  const router = useRouter();
  return (
    <div
      className="bg-white rounded border border-gray-100 shadow-card p-4 cursor-pointer hover:shadow-cardHover hover:border-teal/20 transition-all"
      onClick={() => router.push(`/contracts/${contract.id}`)}
    >
      <div className="flex items-start justify-between mb-2">
        <span className="text-xs font-bold text-teal bg-teal-pale px-2 py-0.5 rounded">
          {contract.no}
        </span>
        <CustomBadge
          label={STATUS_LABELS[contract.status] || contract.status}
          variant={STATUS_VARIANT[contract.status] || 'gray'}
        />
      </div>
      <div className="text-sm font-bold text-teal-dark mb-0.5">{contract.title}</div>
      <div className="text-xs text-gray-400 mb-3">{contract.party}</div>
      <div className="grid grid-cols-3 gap-2 pt-2 border-t border-gray-100">
        <div>
          <div className="text-[0.65rem] text-gray-400 font-bold">القيمة</div>
          <div className="text-xs font-bold text-teal-dark">{fmt(contract.value)}</div>
        </div>
        <div>
          <div className="text-[0.65rem] text-gray-400 font-bold">النوع</div>
          <div className="text-xs font-bold text-teal-dark truncate">{contract.type}</div>
        </div>
        <div>
          <div className="text-[0.65rem] text-gray-400 font-bold">المدة</div>
          <div className="text-xs font-bold text-teal-dark">{contract.duration} شهر</div>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────
export default function ContractsPage() {
  const { profile } = useAuth();
  const router = useRouter();
  const [contracts, setContracts] = useState<ContractView[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ContractStatus | 'all'>('all');

  const canCreate = profile?.role === 'director' || profile?.role === 'admin';

  useEffect(() => {
    fetchContracts()
      .then(setContracts)
      .catch(e => console.warn('Contracts:', e))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let list = contracts;
    if (statusFilter !== 'all') {
      list = list.filter(c => c.status === statusFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(c =>
        c.title.toLowerCase().includes(q) ||
        c.no.toLowerCase().includes(q) ||
        c.party.toLowerCase().includes(q)
      );
    }
    return list;
  }, [contracts, search, statusFilter]);

  // KPI totals
  const activeContracts    = contracts.filter(c => c.status === 'active');
  const completedContracts = contracts.filter(c => c.status === 'completed' || c.status === 'closed');
  const activeValue        = activeContracts.reduce((s, c) => s + c.value, 0);
  const completedValue     = completedContracts.reduce((s, c) => s + c.value, 0);
  const totalValue         = contracts.reduce((s, c) => s + c.value, 0);

  // Scoped user with no linked contracts — show blocked state immediately
  const isScoped = profile && isExternal(profile.role);
  if (!loading && isScoped && contracts.length === 0) {
    return (
      <>
        <PageHeader title="العقود" subtitle="لا توجد عقود مرتبطة" />
        <NoScopeState />
      </>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-sm text-gray-400 animate-pulse">جاري تحميل العقود...</p>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between mb-1">
        <PageHeader
          title="العقود"
          subtitle={`${contracts.length} عقد — ${activeContracts.length} نشط`}
        />
        {canCreate && (
          <button
            onClick={() => router.push('/contracts/new')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-px hover:shadow-lg"
            style={{ background: 'linear-gradient(135deg, #045859 0%, #038580 100%)', boxShadow: '0 3px 10px rgba(4,88,89,.25)' }}
          >
            <span className="text-base leading-none">＋</span>
            إضافة عقد جديد
          </button>
        )}
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">

        {/* Card 1 — Active */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-card p-4" style={{ borderRightColor: '#87BA26', borderRightWidth: 3 }}>
          <div className="flex items-center justify-between mb-1">
            <div className="text-[0.65rem] text-gray-400 font-bold">العقود النشطة</div>
            <span className="text-[0.6rem] bg-green-50 text-green-700 px-1.5 py-px rounded-full font-bold">{activeContracts.length} عقد</span>
          </div>
          <div className="text-lg font-extrabold text-[#87BA26]">
            {fmt(activeValue)}
          </div>
          <div className="text-[0.62rem] text-gray-400 mt-0.5">ريال سعودي</div>
        </div>

        {/* Card 2 — Completed/Closed */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-card p-4" style={{ borderRightColor: '#00A79D', borderRightWidth: 3 }}>
          <div className="flex items-center justify-between mb-1">
            <div className="text-[0.65rem] text-gray-400 font-bold">المنتهية والمغلقة</div>
            <span className="text-[0.6rem] bg-teal-pale text-teal px-1.5 py-px rounded-full font-bold">{completedContracts.length} عقد</span>
          </div>
          <div className="text-lg font-extrabold text-[#00A79D]">
            {fmt(completedValue)}
          </div>
          <div className="text-[0.62rem] text-gray-400 mt-0.5">ريال سعودي</div>
        </div>

        {/* Card 3 — Full portfolio (spans 2 cols) */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-card p-4 md:col-span-2 relative overflow-hidden"
             style={{ borderRightColor: '#045859', borderRightWidth: 3 }}>
          <div className="absolute left-0 top-0 bottom-0 w-28 opacity-[0.03]"
               style={{ background: 'linear-gradient(to left, transparent, #045859)' }} />
          <div className="flex items-center justify-between mb-1">
            <div className="text-[0.65rem] text-gray-400 font-bold">إجمالي المحفظة الكاملة</div>
            <span className="text-[0.6rem] bg-[#E8F4F4] text-teal-dark px-1.5 py-px rounded-full font-bold">{contracts.length} عقد</span>
          </div>
          <div className="text-2xl font-extrabold text-teal-dark">
            {fmt(totalValue)} <span className="text-sm font-bold text-gray-400">ريال</span>
          </div>
          <div className="flex gap-4 mt-2 pt-2 border-t border-gray-50">
            <span className="text-[0.62rem] text-gray-400">
              نشط: <span className="font-bold text-[#87BA26]">{fmt(activeValue)}</span>
            </span>
            <span className="text-[0.62rem] text-gray-400">
              منتهي/مغلق: <span className="font-bold text-[#00A79D]">{fmt(completedValue)}</span>
            </span>
          </div>
        </div>

      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <input
          type="text"
          placeholder="بحث في العقود (رقم، اسم، طرف...)..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 px-3 py-2 border border-gray-200 rounded text-sm bg-white focus:border-teal focus:outline-none text-right"
        />
        <div className="flex gap-1.5 flex-wrap">
          {(['all', 'active', 'draft', 'completed', 'suspended', 'closed'] as const).map(s => (
            <div key={s} className="relative group">
              <button
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
                  statusFilter === s
                    ? 'bg-teal text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-teal-pale'
                }`}
              >
                {s === 'all' ? `الكل (${contracts.length})` : STATUS_LABELS[s]}
              </button>
              {/* Tooltip */}
              <div className="absolute bottom-full mb-2 end-0 z-50 hidden group-hover:block w-52 pointer-events-none">
                <div className="bg-gray-900 text-white text-[0.68rem] leading-relaxed font-bold px-3 py-2 rounded-lg shadow-xl text-right">
                  {STATUS_TOOLTIPS[s]}
                  <div className="absolute top-full end-4 border-4 border-transparent border-t-gray-900" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Results */}
      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-5xl mb-3">📋</div>
          <p className="text-sm font-bold text-gray-600 mb-1">لا توجد نتائج</p>
          <p className="text-xs text-gray-400">
            {search ? 'جرّب كلمة بحث مختلفة' : 'لا توجد عقود مطابقة للفلتر المحدد'}
          </p>
        </div>
      ) : (
        <>
          {/* Desktop: table */}
          <div className="hidden md:block bg-white rounded border border-gray-100 shadow-card overflow-hidden">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-teal">
                  <th className="text-right px-3 py-2.5 text-[0.72rem] font-bold text-white">رقم العقد</th>
                  <th className="text-right px-3 py-2.5 text-[0.72rem] font-bold text-white">العقد / الطرف</th>
                  <th className="text-right px-3 py-2.5 text-[0.72rem] font-bold text-white">النوع</th>
                  <th className="text-right px-3 py-2.5 text-[0.72rem] font-bold text-white">القيمة</th>
                  <th className="text-right px-3 py-2.5 text-[0.72rem] font-bold text-white">البداية</th>
                  <th className="text-right px-3 py-2.5 text-[0.72rem] font-bold text-white">المدة</th>
                  <th className="text-right px-3 py-2.5 text-[0.72rem] font-bold text-white">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => (
                  <ContractRow key={c.id} contract={c} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: cards */}
          <div className="md:hidden flex flex-col gap-3">
            {filtered.map(c => (
              <ContractCard key={c.id} contract={c} />
            ))}
          </div>

          {/* Footer count */}
          {filtered.length !== contracts.length && (
            <p className="mt-3 text-xs text-gray-400 text-center">
              يعرض {filtered.length} من {contracts.length} عقد
            </p>
          )}
        </>
      )}
    </>
  );
}
