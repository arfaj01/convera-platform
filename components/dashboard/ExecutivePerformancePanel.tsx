'use client';

/**
 * Executive Performance Panel — 🟢 Green section
 *
 * Shows: fastest approvals, best-performing contractors,
 * healthy contracts (low utilization, no SLA issues).
 */

import type { ContractSpend, ClaimActivity } from '@/services/dashboard';

interface Props {
  contractSpends: ContractSpend[];
  recentActivity: ClaimActivity[];
}

export default function ExecutivePerformancePanel({ contractSpends, recentActivity }: Props) {
  // ── Fastest approvals (approved claims, least days) ────────────
  const approvedClaims = recentActivity
    .filter(c => c.status === 'approved')
    .sort((a, b) => a.daysOld - b.daysOld)
    .slice(0, 3);

  // ── Healthy contracts (< 60% utilization, status active) ───────
  const healthyContracts = contractSpends
    .filter(c => c.pctConsumed < 60 && c.riskLevel === 'normal')
    .sort((a, b) => a.pctConsumed - b.pctConsumed)
    .slice(0, 3);

  // ── Contracts on track (good remaining budget) ─────────────────
  const onTrack = contractSpends.filter(c => c.pctConsumed < 80).length;
  const total   = contractSpends.length;

  if (approvedClaims.length === 0 && healthyContracts.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-4" style={{ boxShadow: '0 2px 8px rgba(4,88,89,.06)' }}>
        <SectionHeader />
        <div className="flex flex-col items-center justify-center py-6 gap-2">
          <span className="text-2xl">📊</span>
          <p className="text-xs text-gray-400 font-bold">لا توجد بيانات أداء متاحة بعد</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden" style={{ boxShadow: '0 2px 8px rgba(4,88,89,.06)' }}>
      <SectionHeader />

      {/* Portfolio health pill */}
      {total > 0 && (
        <div className="px-4 pt-3 pb-2">
          <div className="flex items-center justify-between text-[0.68rem] mb-1.5">
            <span className="text-gray-500 font-bold">صحة المحفظة</span>
            <span className="font-black" style={{ color: '#87BA26' }}>{onTrack} / {total} عقد في الوضع الطبيعي</span>
          </div>
          <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${total > 0 ? (onTrack / total) * 100 : 0}%`,
                background: 'linear-gradient(90deg, #87BA26 0%, #5e8c1c 100%)',
              }}
            />
          </div>
        </div>
      )}

      {/* Healthy contracts */}
      {healthyContracts.length > 0 && (
        <div className="px-4 pt-2 pb-1">
          <p className="text-[0.65rem] font-bold text-gray-400 mb-1.5">عقود في وضع جيد</p>
          <div className="space-y-1.5">
            {healthyContracts.map(ct => (
              <div key={ct.contractId} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#87BA26' }} />
                  <p className="text-[0.7rem] text-gray-700 font-bold truncate">{ct.title.slice(0, 35)}</p>
                </div>
                <span
                  className="flex-shrink-0 text-[0.62rem] font-black px-1.5 py-0.5 rounded-full"
                  style={{ background: '#F0F7E0', color: '#5a7c1a' }}
                >
                  {ct.pctConsumed.toFixed(0)}٪
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Fast approvals */}
      {approvedClaims.length > 0 && (
        <div className="px-4 py-2 border-t border-gray-50 mt-1">
          <p className="text-[0.65rem] font-bold text-gray-400 mb-1.5">أسرع اعتمادات</p>
          <div className="space-y-1.5">
            {approvedClaims.map(c => (
              <div key={c.id} className="flex items-center justify-between gap-2">
                <p className="text-[0.7rem] text-gray-700 font-bold truncate flex-1">
                  مطالبة #{c.claimNo} — {c.contractNo}
                </p>
                <span
                  className="flex-shrink-0 text-[0.62rem] font-black px-1.5 py-0.5 rounded-full"
                  style={{ background: '#E8F4F4', color: '#045859' }}
                >
                  {c.daysOld} يوم
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SectionHeader() {
  return (
    <div
      className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100"
      style={{ borderTop: '3px solid #87BA26' }}
    >
      <span className="text-base leading-none">🟢</span>
      <span className="text-[0.8rem] font-black text-gray-800">الأداء والصحة</span>
    </div>
  );
}
