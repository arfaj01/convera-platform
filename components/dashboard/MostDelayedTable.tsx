'use client';

/**
 * أكثر المطالبات تأخراً — Most Delayed Claims Table (Sprint E · Phase 1)
 *
 * Shows claims sorted by days in current stage (descending).
 * Only includes claims in active review stages.
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

const SLA_STYLE = {
  overdue: { bg: 'bg-[#DC2626]', text: 'text-white',     label: 'تجاوز SLA' },
  warning: { bg: 'bg-[#FFC845]', text: 'text-[#7A4F00]', label: 'تحذير' },
  on_track: { bg: 'bg-[#87BA26]', text: 'text-white',    label: 'ضمن المدة' },
  not_applicable: { bg: 'bg-gray-200', text: 'text-gray-500', label: '—' },
};

export default function MostDelayedTable({ claims }: Props) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100"
           style={{ borderTop: '3px solid #C05728' }}>
        <div className="flex items-center gap-2">
          <span className="text-base leading-none">⏳</span>
          <span className="text-[0.8rem] font-black text-gray-800">أكثر المطالبات تأخراً</span>
        </div>
        {claims.length > 0 && (
          <span className="text-[0.65rem] font-black text-white rounded-full px-2 py-0.5"
                style={{ background: '#C05728' }}>
            {claims.length}
          </span>
        )}
      </div>

      {claims.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 gap-2">
          <span className="text-2xl">✅</span>
          <p className="text-[0.78rem] text-[#87BA26] font-bold">لا توجد مطالبات متأخرة</p>
          <p className="text-[0.65rem] text-gray-400">جميع المطالبات النشطة ضمن المدة المحددة</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-[#F7F8FA]">
                <th className="text-start px-3 py-2 text-[0.65rem] font-bold text-gray-400">#</th>
                <th className="text-start px-3 py-2 text-[0.65rem] font-bold text-gray-400">العقد</th>
                <th className="text-start px-3 py-2 text-[0.65rem] font-bold text-gray-400">المرحلة</th>
                <th className="text-start px-3 py-2 text-[0.65rem] font-bold text-gray-400">المالك الحالي</th>
                <th className="text-start px-3 py-2 text-[0.65rem] font-bold text-gray-400">أيام في المرحلة</th>
                <th className="text-start px-3 py-2 text-[0.65rem] font-bold text-gray-400">SLA</th>
                <th className="text-start px-3 py-2 text-[0.65rem] font-bold text-gray-400">المبلغ</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {claims.map((c, i) => {
                const sla = SLA_STYLE[c.sla.status];
                return (
                  <tr
                    key={c.id}
                    className={`border-b border-gray-50 hover:bg-[#F7F8FA] transition-colors ${
                      i % 2 === 0 ? '' : 'bg-[#FAFAFA]'
                    }`}
                  >
                    {/* Claim # */}
                    <td className="px-3 py-2.5">
                      <Link href={`/claims/${c.id}`} className="no-underline">
                        <span className="text-[0.78rem] font-black text-[#045859] hover:text-[#00A79D]">
                          #{c.claimNo}
                        </span>
                      </Link>
                    </td>

                    {/* Contract */}
                    <td className="px-3 py-2.5 max-w-[140px]">
                      <div className="text-[0.7rem] font-bold text-gray-700 truncate">{c.contractNo}</div>
                    </td>

                    {/* Stage */}
                    <td className="px-3 py-2.5">
                      <Badge status={c.status} />
                    </td>

                    {/* Owner */}
                    <td className="px-3 py-2.5">
                      <div>
                        <span className="text-[0.72rem] font-bold text-gray-600">
                          {c.owner.label}
                        </span>
                        {c.owner.primaryOwner && (
                          <div className="text-[0.6rem] text-gray-400 truncate max-w-[100px]">
                            {c.owner.primaryOwner}
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Days in stage */}
                    <td className="px-3 py-2.5">
                      <span className={`text-[0.8rem] font-black tabular-nums ${
                        c.daysInStage >= 3 ? 'text-[#DC2626]' : c.daysInStage >= 2 ? 'text-[#C05728]' : 'text-gray-500'
                      }`}>
                        {c.daysInStage} يوم
                      </span>
                    </td>

                    {/* SLA badge */}
                    <td className="px-3 py-2.5">
                      <span className={`text-[0.6rem] font-bold px-1.5 py-0.5 rounded-full ${sla.bg} ${sla.text}`}>
                        {sla.label}
                      </span>
                    </td>

                    {/* Amount */}
                    <td className="px-3 py-2.5">
                      <span className="text-[0.72rem] font-black text-gray-700 tabular-nums">
                        {fmtSAR(c.grossAmount)}
                      </span>
                      <span className="text-[0.55rem] text-gray-400 ms-0.5">ر.س</span>
                    </td>

                    {/* Action */}
                    <td className="px-3 py-2.5">
                      <Link
                        href={`/claims/${c.id}`}
                        className="text-[0.65rem] text-[#00A79D] font-bold no-underline hover:text-[#045859]"
                      >
                        عرض
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
