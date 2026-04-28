'use client';

/**
 * ComplianceChecklist — governance-grade requirements panel.
 *
 * Each item has one of four states:
 *   complete  — مكتمل
 *   missing   — ناقص
 *   review    — يحتاج مراجعة
 *   violation — مخالف
 *
 * The component is purely presentational. The caller computes the items
 * (e.g. on a claim detail page based on attachments + workflow state).
 */

import type { ReactNode } from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, ShieldAlert, Eye } from 'lucide-react';

export type ChecklistState = 'complete' | 'missing' | 'review' | 'violation';

const STATE_STYLES: Record<ChecklistState, { icon: typeof CheckCircle2; iconClass: string; rowBg: string; labelAr: string; labelClass: string }> = {
  complete: {
    icon: CheckCircle2,
    iconClass: 'text-[#558B2F]',
    rowBg: 'bg-[#F0F7E0]/40',
    labelAr: 'مكتمل',
    labelClass: 'bg-[#F0F7E0] text-[#558B2F]',
  },
  missing: {
    icon: AlertCircle,
    iconClass: 'text-[#C05728]',
    rowBg: 'bg-[#FAEEE8]/40',
    labelAr: 'ناقص',
    labelClass: 'bg-[#FAEEE8] text-[#C05728]',
  },
  review: {
    icon: Eye,
    iconClass: 'text-[#C46A00]',
    rowBg: 'bg-[#FFF8E0]/40',
    labelAr: 'يحتاج مراجعة',
    labelClass: 'bg-[#FFF8E0] text-[#C46A00]',
  },
  violation: {
    icon: ShieldAlert,
    iconClass: 'text-[#C0392B]',
    rowBg: 'bg-[#FDECEA]/40',
    labelAr: 'مخالف',
    labelClass: 'bg-[#FDECEA] text-[#C0392B]',
  },
};

export interface ComplianceItem {
  id: string;
  title: string;
  /** Sub-line under the title (e.g. "3 من 4 ملفات مرفوعة") */
  hint?: string;
  state: ChecklistState;
  /** Optional inline CTA (e.g. "ارفع الملف") */
  action?: ReactNode;
}

export interface ComplianceChecklistProps {
  items: ComplianceItem[];
  /** Total / passing summary at the top */
  showSummary?: boolean;
  className?: string;
}

export default function ComplianceChecklist({
  items,
  showSummary = true,
  className = '',
}: ComplianceChecklistProps) {
  const counts = items.reduce(
    (acc, it) => { acc[it.state] += 1; return acc; },
    { complete: 0, missing: 0, review: 0, violation: 0 } as Record<ChecklistState, number>,
  );
  const total = items.length;
  const completePct = total > 0 ? Math.round((counts.complete / total) * 100) : 0;
  const blocked = counts.missing + counts.violation;

  return (
    <div className={'bg-white rounded-xl border border-gray-100 ' + className}>
      {showSummary && (
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-extrabold text-[#045859]">قائمة المتطلبات</div>
            <div className="text-[11px] text-gray-500">
              {counts.complete} مكتمل من أصل {total} — {completePct}%
              {blocked > 0 && <span className="text-[#C0392B] font-bold"> · {blocked} عنصر محجوب</span>}
            </div>
          </div>
          {/* Progress ring */}
          <div className="flex items-center gap-1 text-xs flex-shrink-0">
            {(['complete','review','missing','violation'] as ChecklistState[]).map(s =>
              counts[s] > 0 ? (
                <span key={s} className={'rounded-full px-2 py-0.5 font-bold ' + STATE_STYLES[s].labelClass}>
                  {STATE_STYLES[s].labelAr} {counts[s]}
                </span>
              ) : null
            )}
          </div>
        </div>
      )}

      <ul className="divide-y divide-gray-100">
        {items.map(item => {
          const s = STATE_STYLES[item.state];
          const Icon = s.icon;
          return (
            <li key={item.id} className={'px-5 py-3 flex items-start gap-3 ' + s.rowBg}>
              <div className="flex-shrink-0 mt-0.5">
                <Icon size={18} strokeWidth={2.2} className={s.iconClass} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-gray-800">{item.title}</div>
                {item.hint && <div className="text-[11px] text-gray-500 mt-0.5">{item.hint}</div>}
                {item.action && <div className="mt-2">{item.action}</div>}
              </div>
              <span className={'text-[10px] font-bold rounded-full px-2 py-0.5 flex-shrink-0 ' + s.labelClass}>
                {s.labelAr}
              </span>
            </li>
          );
        })}
      </ul>

      {items.length === 0 && (
        <div className="px-5 py-8 text-center text-sm text-gray-400">
          لا توجد متطلبات مسجّلة
        </div>
      )}
    </div>
  );
}
