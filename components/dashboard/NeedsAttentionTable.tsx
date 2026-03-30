'use client';

/**
 * يتطلب تدخل — Needs Attention Table (Sprint E · Phase 1)
 *
 * Shows claims requiring immediate action, prioritized by:
 * 1. SLA overdue (highest priority)
 * 2. SLA warning
 * 3. Returned claims awaiting contractor
 */

import Link from 'next/link';
import Badge from '@/components/ui/Badge';
import type { EnrichedClaim } from '@/lib/claim-intelligence';

interface Props {
  claims: EnrichedClaim[];
}

function fmtSAR(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'م';
  if (n >= 1_000)     return (n / 1_000).toFixed(0) + 'ك';
  return Math.round(n).toLocaleString('ar-SA');
}

const REASON_ICON: Record<string, { icon: string; label: string; color: string }> = {
  overdue:  { icon: '🔴', label: 'تجاوز المدة',       color: '#DC2626' },
  warning:  { icon: '🟡', label: 'اقتراب من المدة',    color: '#FFC845' },
  returned: { icon: '↩️', label: 'مُرجَّعة للمقاول',   color: '#C05728' },
};

function getAttentionReason(c: EnrichedClaim): { icon: string; label: string; color: string } {
  if (c.sla.status === 'overdue') return REASON_ICON.overdue;
  if (c.sla.status === 'warning') return REASON_ICON.warning;
  return REASON_ICON.returned;
}

export default function NeedsAttentionTable({ claims }: Props) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100"
           style={{ borderTop: '3px solid #DC2626' }}>
        <div className="flex items-center gap-2">
          <span className="text-base leading-none">🚨</span>
          <span className="text-[0.8rem] font-black text-gray-800">يتطلب تدخل عاجل</span>
        </div>
        {claims.length > 0 && (
          <span className="text-[0.65rem] font-black text-white rounded-full px-2 py-0.5 bg-[#DC2626]">
            {claims.length}
          </span>
        )}
      </div>

      {claims.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 gap-2">
          <span className="text-2xl">✅</span>
          <p className="text-[0.78rem] text-[#87BA26] font-bold">لا توجد بنود تتطلب تدخلاً عاجلاً</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-50">
          {claims.map((c) => {
            const reason = getAttentionReason(c);
            return (
              <Link
                key={c.id}
                href={`/claims/${c.id}`}
                className="no-underline flex items-start gap-3 px-4 py-3 hover:bg-red-50/40 transition-colors group"
              >
                {/* Priority dot */}
                <div
                  className="flex-shrink-0 w-2.5 h-2.5 rounded-full mt-1.5"
                  style={{ background: reason.color }}
                />

                {/* Icon */}
                <span className="text-base flex-shrink-0">{reason.icon}</span>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-[0.75rem] font-black text-gray-800 leading-snug group-hover:text-[#045859] transition-colors">
                        مطالبة #{c.claimNo} — {c.contractNo}
                      </p>
                      <p className="text-[0.65rem] text-gray-500 mt-0.5">
                        {c.stageLabel} · المالك: <span className="font-bold">{c.owner.primaryOwner || c.owner.label}</span> · {c.daysInStage} يوم
                      </p>
                      {c.returnReason && (
                        <p className="text-[0.62rem] text-[#C05728] mt-0.5 truncate max-w-[280px]">
                          سبب الإرجاع: {c.returnReason}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span
                        className="text-[0.58rem] font-bold px-1.5 py-0.5 rounded-full"
                        style={{ background: reason.color + '20', color: reason.color }}
                      >
                        {reason.label}
                      </span>
                      <span className="text-[0.62rem] font-bold text-gray-400 tabular-nums">
                        {fmtSAR(c.grossAmount)} ر.س
                      </span>
                    </div>
                  </div>
                </div>

                {/* Arrow */}
                <span className="text-gray-300 text-xs group-hover:text-[#045859] transition-colors flex-shrink-0 mt-1">
                  ←
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
