'use client';

/**
 * عمليات المطالبات — Claims Operations / Activity Panel
 *
 * Shows 4 tabbed views of claim workflow activity:
 * - آخر المقدمة      (latest submitted)
 * - آخر المعتمدة     (latest approved)
 * - آخر المُرجَّعة   (latest returned)
 * - آخر المرفوضة     (latest rejected)
 *
 * Each row shows: claim number, contract, stage, amount, age in days
 */

import { useState } from 'react';
import Link from 'next/link';
import Badge from '@/components/ui/Badge';
import type { ClaimActivity } from '@/services/dashboard';
import type { ClaimStatus } from '@/lib/types';

interface Props {
  activities: ClaimActivity[];
}

type Tab = 'submitted' | 'approved' | 'returned' | 'rejected';

const TABS: { key: Tab; label: string; statuses: ClaimStatus[] }[] = [
  {
    key:      'submitted',
    label:    'قيد الإجراء',
    statuses: [
      'submitted',
      'under_supervisor_review',
      'under_auditor_review',
      'under_reviewer_check',
      'pending_director_approval',
    ],
  },
  {
    key:      'approved',
    label:    'معتمدة',
    statuses: ['approved'],
  },
  {
    key:      'returned',
    label:    'مُرجَّعة',
    statuses: ['returned_by_supervisor', 'returned_by_auditor'],
  },
  {
    key:      'rejected',
    label:    'مرفوضة',
    statuses: ['rejected'],
  },
];

function fmtSAR(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'م';
  if (n >= 1_000)     return (n / 1_000).toFixed(0) + 'ك';
  return Math.round(n).toLocaleString('ar-SA');
}

const AGE_COLOR = (days: number) =>
  days > 14 ? 'text-[#DC2626]' : days > 7 ? 'text-[#C05728]' : 'text-gray-400';

export default function ClaimsActivityPanel({ activities }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('submitted');

  const current = TABS.find(t => t.key === activeTab)!;
  const filtered = activities
    .filter(a => current.statuses.includes(a.status))
    .slice(0, 10);

  const tabCounts = Object.fromEntries(
    TABS.map(t => [t.key, activities.filter(a => t.statuses.includes(a.status)).length])
  ) as Record<Tab, number>;

  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#045859]">
        <div className="flex items-center gap-2">
          <div className="w-1 h-5 rounded bg-[#87BA26]" />
          <h3 className="text-[0.85rem] font-black text-white">عمليات المطالبات</h3>
        </div>
        <Link href="/claims" className="text-[0.65rem] text-[#87BA26] font-bold no-underline hover:text-white">
          عرض الكل ←
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-100 bg-[#F7F8FA]">
        {TABS.map(tab => {
          const count   = tabCounts[tab.key];
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 px-2 py-2.5 text-[0.7rem] font-bold transition-colors relative ${
                isActive
                  ? 'text-[#045859] bg-white border-b-2 border-[#045859]'
                  : 'text-gray-500 hover:text-[#045859] hover:bg-white/50'
              }`}
            >
              {tab.label}
              {count > 0 && (
                <span className={`ms-1 text-[0.58rem] px-1 py-0.5 rounded-full font-black ${
                  isActive ? 'bg-[#045859] text-white' : 'bg-gray-200 text-gray-600'
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {filtered.length === 0 ? (
        <div className="py-10 text-center text-[0.8rem] text-gray-400">
          لا توجد مطالبات في هذه الفئة
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-[#F7F8FA]">
                <th className="text-start px-3 py-2 text-[0.65rem] font-bold text-gray-400">#</th>
                <th className="text-start px-3 py-2 text-[0.65rem] font-bold text-gray-400">العقد</th>
                <th className="text-start px-3 py-2 text-[0.65rem] font-bold text-gray-400 hidden sm:table-cell">الحالة</th>
                <th className="text-start px-3 py-2 text-[0.65rem] font-bold text-gray-400">
                  المبلغ الإجمالي
                  <div className="text-[0.55rem] font-normal text-gray-300">قبل ض.ق.م</div>
                </th>
                <th className="text-start px-3 py-2 text-[0.65rem] font-bold text-gray-400">العمر</th>
                <th className="text-start px-3 py-2 text-[0.65rem] font-bold text-gray-400"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a, i) => (
                <tr
                  key={a.id}
                  className={`border-b border-gray-50 hover:bg-[#F7F8FA] transition-colors ${
                    i % 2 === 0 ? '' : 'bg-[#FAFAFA]'
                  }`}
                >
                  {/* Claim # */}
                  <td className="px-3 py-2.5">
                    <Link href={`/claims/${a.id}`} className="no-underline">
                      <span className="text-[0.78rem] font-black text-[#045859] hover:text-[#00A79D]">
                        #{a.claimNo}
                      </span>
                    </Link>
                  </td>

                  {/* Contract */}
                  <td className="px-3 py-2.5 max-w-[160px]">
                    <div className="text-[0.72rem] font-bold text-gray-700 truncate">{a.contractNo}</div>
                    <div className="text-[0.62rem] text-gray-400 truncate max-w-[130px]">
                      {a.contractTitle.substring(0, 30)}
                    </div>
                  </td>

                  {/* Status */}
                  <td className="px-3 py-2.5 hidden sm:table-cell">
                    <Badge status={a.status} />
                  </td>

                  {/* Amount */}
                  <td className="px-3 py-2.5">
                    <span className="text-[0.78rem] font-black text-gray-700 tabular-nums">
                      {fmtSAR(a.totalAmount)}
                    </span>
                    <span className="text-[0.58rem] text-gray-400 ms-0.5">ر.س</span>
                  </td>

                  {/* Age */}
                  <td className="px-3 py-2.5">
                    <span className={`text-[0.72rem] font-bold tabular-nums ${AGE_COLOR(a.daysOld)}`}>
                      {a.daysOld}د
                    </span>
                  </td>

                  {/* Action */}
                  <td className="px-3 py-2.5">
                    <Link
                      href={`/claims/${a.id}`}
                      className="text-[0.65rem] text-[#00A79D] font-bold no-underline hover:text-[#045859]"
                    >
                      عرض
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
