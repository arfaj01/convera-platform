'use client';

/**
 * Intelligence KPI Strip — Operational intelligence cards (Sprint E · Phase 1)
 *
 * Shows claim lifecycle + SLA metrics:
 * - Total claims
 * - In progress
 * - Delayed (SLA overdue)
 * - Approved
 * - Returned
 * - Average days in stage
 */

import type { IntelligenceKPIs } from '@/services/dashboard-intelligence';

interface Props {
  kpis: IntelligenceKPIs;
}

function fmtSAR(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + ' مليار';
  if (n >= 1_000_000)     return (n / 1_000_000).toFixed(1) + ' مليون';
  return Math.round(n).toLocaleString('ar-SA');
}

interface MiniCard {
  icon:   string;
  label:  string;
  value:  string;
  sub?:   string;
  color:  string;      // border-top accent color
  bgColor: string;     // background color
  textColor: string;   // value text color
}

export default function IntelligenceKPIStrip({ kpis }: Props) {
  const cards: MiniCard[] = [
    {
      icon: '📋',
      label: 'إجمالي المطالبات',
      value: String(kpis.totalClaims),
      sub: `${kpis.draftClaims} مسودة`,
      color: '#045859',
      bgColor: '#E8F4F4',
      textColor: '#045859',
    },
    {
      icon: '⏳',
      label: 'قيد الإجراء',
      value: String(kpis.claimsInProgress),
      sub: `متوسط ${kpis.avgDaysInStage} يوم بالمرحلة`,
      color: '#00A79D',
      bgColor: '#E0F4F3',
      textColor: '#005F5A',
    },
    {
      icon: '🔴',
      label: 'متأخرة (تجاوز SLA)',
      value: String(kpis.delayedClaims),
      sub: kpis.warningClaims > 0 ? `+ ${kpis.warningClaims} تحذير` : 'لا تحذيرات',
      color: kpis.delayedClaims > 0 ? '#DC2626' : '#87BA26',
      bgColor: kpis.delayedClaims > 0 ? '#FDECEA' : '#F0F7E0',
      textColor: kpis.delayedClaims > 0 ? '#991B1B' : '#4A6B10',
    },
    {
      icon: '✅',
      label: 'معتمدة',
      value: String(kpis.approvedClaims),
      color: '#87BA26',
      bgColor: '#F0F7E0',
      textColor: '#4A6B10',
    },
    {
      icon: '↩️',
      label: 'مُرجَّعة',
      value: String(kpis.returnedClaims),
      sub: kpis.rejectedClaims > 0 ? `${kpis.rejectedClaims} مرفوضة` : undefined,
      color: kpis.returnedClaims > 0 ? '#C05728' : '#87BA26',
      bgColor: kpis.returnedClaims > 0 ? '#FAEEE8' : '#F0F7E0',
      textColor: kpis.returnedClaims > 0 ? '#7A3418' : '#4A6B10',
    },
    {
      icon: '💰',
      label: 'القيمة المالية الإجمالية',
      value: fmtSAR(kpis.totalFinancialValue) + ' ر.س',
      sub: 'قبل ض.ق.م — جميع المطالبات غير المسودة',
      color: '#502C7C',
      bgColor: '#F3F0F9',
      textColor: '#3A1F5C',
    },
  ];

  return (
    <div className="mb-3">
      {/* Section label */}
      <div className="flex items-center gap-2 mb-2">
        <div className="w-1 h-4 rounded bg-[#502C7C]" />
        <h3 className="text-[0.75rem] font-black text-gray-700">مؤشرات الذكاء التشغيلي</h3>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">
        {cards.map((card, i) => (
          <div
            key={i}
            className="rounded-xl p-3 flex flex-col gap-1 border transition-shadow hover:shadow-md"
            style={{
              background: card.bgColor,
              borderColor: card.color + '25',
              borderTopWidth: '3px',
              borderTopColor: card.color,
            }}
          >
            <div className="text-lg">{card.icon}</div>
            <div className="text-[1.2rem] font-black leading-tight tabular-nums"
                 style={{ color: card.textColor }}>
              {card.value}
            </div>
            <div className="text-[0.68rem] font-bold" style={{ color: card.textColor + 'CC' }}>
              {card.label}
            </div>
            {card.sub && (
              <div className="text-[0.58rem]" style={{ color: card.textColor + '99' }}>
                {card.sub}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
