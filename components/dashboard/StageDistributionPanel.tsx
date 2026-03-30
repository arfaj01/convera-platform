'use client';

/**
 * توزيع المطالبات حسب المرحلة — Stage Distribution Panel (Sprint E · Phase 1)
 *
 * Visual pipeline showing how many claims are at each workflow stage,
 * with total value and SLA health indicator per stage.
 */

import Link from 'next/link';
import type { StageDistribution } from '@/lib/claim-intelligence';

interface Props {
  stages: StageDistribution[];
}

function fmtSAR(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + ' مليون';
  if (n >= 1_000)     return (n / 1_000).toFixed(0) + ' ألف';
  return Math.round(n).toLocaleString('ar-SA');
}

export default function StageDistributionPanel({ stages }: Props) {
  const total = stages.reduce((s, st) => s + st.count, 0);

  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100"
           style={{ borderTop: '3px solid #502C7C' }}>
        <div className="flex items-center gap-2">
          <span className="text-base leading-none">📊</span>
          <span className="text-[0.8rem] font-black text-gray-800">توزيع المطالبات حسب المرحلة</span>
        </div>
        <span className="text-[0.65rem] font-black text-white rounded-full px-2 py-0.5"
              style={{ background: '#502C7C' }}>
          {total} مطالبة
        </span>
      </div>

      {stages.length === 0 ? (
        <div className="py-8 text-center text-[0.8rem] text-gray-400">
          لا توجد مطالبات نشطة
        </div>
      ) : (
        <div className="divide-y divide-gray-50">
          {stages.map((stage) => {
            const pct = total > 0 ? (stage.count / total) * 100 : 0;
            // Count overdue/warning claims in this stage
            const overdueCount = stage.claims.filter(c => c.sla.status === 'overdue').length;
            const warningCount = stage.claims.filter(c => c.sla.status === 'warning').length;

            return (
              <div key={stage.stage} className="px-4 py-3 hover:bg-gray-50/50 transition-colors">
                {/* Stage header row */}
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{stage.icon}</span>
                    <span className="text-[0.75rem] font-black text-gray-800">
                      {stage.label}
                    </span>
                    <span className="text-[0.65rem] font-black text-white rounded-full px-1.5 py-0.5"
                          style={{ background: stage.color }}>
                      {stage.count}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* SLA health badges */}
                    {overdueCount > 0 && (
                      <span className="text-[0.58rem] font-bold px-1.5 py-0.5 rounded-full bg-[#DC2626] text-white">
                        {overdueCount} متأخرة
                      </span>
                    )}
                    {warningCount > 0 && (
                      <span className="text-[0.58rem] font-bold px-1.5 py-0.5 rounded-full bg-[#FFC845] text-[#7A4F00]">
                        {warningCount} تحذير
                      </span>
                    )}
                    <span className="text-[0.62rem] font-bold text-gray-400">
                      {fmtSAR(stage.totalValue)} ر.س
                    </span>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.max(pct, 3)}%`, background: stage.color }}
                  />
                </div>

                {/* Claim pills (first 3) */}
                {stage.claims.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {stage.claims.slice(0, 3).map(c => (
                      <Link
                        key={c.id}
                        href={`/claims/${c.id}`}
                        className="no-underline text-[0.6rem] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
                      >
                        #{c.claimNo} · {c.daysInStage}د
                        {c.sla.status === 'overdue' && ' 🔴'}
                        {c.sla.status === 'warning' && ' 🟡'}
                      </Link>
                    ))}
                    {stage.claims.length > 3 && (
                      <span className="text-[0.58rem] text-gray-400 font-bold self-center">
                        +{stage.claims.length - 3} أخرى
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
