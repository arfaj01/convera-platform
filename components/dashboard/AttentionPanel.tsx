'use client';

/**
 * يتطلب انتباه — Priority / Attention Panel
 *
 * Shows all critical and warning items that require immediate action:
 * - SLA breaches (supervisor stage > 3 days)
 * - SLA warnings (supervisor stage > 2 days)
 * - Contracts near financial ceiling
 * - Returned claims waiting for contractor
 * - Pending amendments needing director approval
 */

import Link from 'next/link';
import type { AttentionItem } from '@/services/dashboard';

interface Props {
  items: AttentionItem[];
}

const ICONS: Record<AttentionItem['type'], string> = {
  sla_breach:         '🚨',
  sla_warning:        '⚠️',
  near_ceiling:       '📊',
  missing_docs:       '📎',
  returned:           '↩️',
  pending_amendment:  '📝',
};

const SEVERITY_STYLES = {
  critical: {
    bg:     'bg-[#FDECEA]',
    border: 'border-[#DC2626]/20',
    dot:    'bg-[#DC2626]',
    title:  'text-[#991B1B]',
    sub:    'text-[#B91C1C]/70',
    badge:  'bg-[#DC2626] text-white',
  },
  warning: {
    bg:     'bg-[#FFF8E0]',
    border: 'border-[#FFC845]/30',
    dot:    'bg-[#FFC845]',
    title:  'text-[#7A4F00]',
    sub:    'text-[#7A4F00]/70',
    badge:  'bg-[#FFC845] text-[#7A4F00]',
  },
  info: {
    bg:     'bg-[#E0F4F3]',
    border: 'border-[#00A79D]/20',
    dot:    'bg-[#00A79D]',
    title:  'text-[#005F5A]',
    sub:    'text-[#005F5A]/70',
    badge:  'bg-[#00A79D] text-white',
  },
};

const TYPE_BADGES: Record<AttentionItem['type'], string> = {
  sla_breach:         'تجاوز SLA',
  sla_warning:        'تحذير SLA',
  near_ceiling:       'اقتراب من السقف',
  missing_docs:       'مستندات ناقصة',
  returned:           'مُرجَّعة للمقاول',
  pending_amendment:  'تعديل معلّق',
};

export default function AttentionPanel({ items }: Props) {
  const criticalCount = items.filter(i => i.severity === 'critical').length;
  const warningCount  = items.filter(i => i.severity === 'warning').length;

  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#FDECEA] border-b border-[#DC2626]/10">
        <div className="flex items-center gap-2">
          <div className="w-1 h-5 rounded bg-[#DC2626]" />
          <h3 className="text-[0.85rem] font-black text-[#991B1B]">يتطلب انتباه</h3>
        </div>
        <div className="flex gap-1.5">
          {criticalCount > 0 && (
            <span className="text-[0.6rem] font-bold px-2 py-0.5 rounded-full bg-[#DC2626] text-white">
              {criticalCount} حرج
            </span>
          )}
          {warningCount > 0 && (
            <span className="text-[0.6rem] font-bold px-2 py-0.5 rounded-full bg-[#FFC845] text-[#7A4F00]">
              {warningCount} تحذير
            </span>
          )}
          {items.length === 0 && (
            <span className="text-[0.6rem] font-bold px-2 py-0.5 rounded-full bg-[#87BA26] text-white">
              لا إجراءات مطلوبة
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 gap-2">
          <span className="text-3xl">✅</span>
          <p className="text-[0.82rem] text-[#87BA26] font-bold">جميع العمليات ضمن المعدل الطبيعي</p>
          <p className="text-[0.7rem] text-gray-400">لا تأخير، لا تجاوز، لا مطالبات معلّقة</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-50 max-h-[420px] overflow-y-auto">
          {items.map((item, i) => {
            const s = SEVERITY_STYLES[item.severity];
            return (
              <div key={i} className={`flex items-start gap-3 px-4 py-3 ${s.bg} hover:brightness-[0.985] transition-all`}>
                {/* Severity dot */}
                <div className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${s.dot}`} />

                {/* Icon */}
                <span className="text-base flex-shrink-0">{ICONS[item.type]}</span>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className={`text-[0.75rem] font-bold leading-snug ${s.title}`}>
                      {item.claimId ? (
                        <Link href={`/claims/${item.claimId}`} className="hover:underline no-underline">
                          {item.title}
                        </Link>
                      ) : item.contractId ? (
                        <Link href={`/contracts/${item.contractId}`} className="hover:underline no-underline">
                          {item.title}
                        </Link>
                      ) : (
                        item.title
                      )}
                    </p>
                    <span className={`text-[0.58rem] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${s.badge}`}>
                      {TYPE_BADGES[item.type]}
                    </span>
                  </div>
                  <p className={`text-[0.67rem] mt-0.5 ${s.sub}`}>{item.subtitle}</p>
                </div>

                {/* Action link */}
                {(item.claimId || item.contractId) && (
                  <Link
                    href={item.claimId ? `/claims/${item.claimId}` : `/contracts/${item.contractId}`}
                    className="flex-shrink-0 text-[0.65rem] text-[#045859] font-bold no-underline hover:text-[#00A79D] whitespace-nowrap"
                  >
                    عرض ←
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
