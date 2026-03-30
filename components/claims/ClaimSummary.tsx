'use client';

import { fmtCurrency } from '@/lib/formatters';
import type { ClaimFinancialSummary as ClaimSummaryType } from '@/lib/calculations';

interface ClaimSummaryProps {
  summary: ClaimSummaryType;
  hideStaff?: boolean;
}

export default function ClaimSummaryBox({ summary, hideStaff }: ClaimSummaryProps) {
  const rows: { label: string; value: number; isTotal?: boolean }[] = [
    { label: 'إجمالي تكلفة الفاتورة الحالية (جاري)', value: summary.boqTotal },
    ...(!hideStaff && summary.staffTotal > 0 ? [{ label: 'إجمالي الكوادر', value: summary.staffTotal }] : []),
    { label: 'الإجمالي قبل الضريبة', value: summary.grossAmount },
    { label: 'ضريبة القيمة المضافة 15%', value: summary.vatAmount },
    { label: 'المبلغ الإجمالي المستحق', value: summary.totalAmount, isTotal: true },
  ];

  return (
    <div className="bg-teal-dark rounded p-4 text-white">
      {rows.map((row, idx) => (
        <div
          key={idx}
          className={`flex justify-between items-center py-1.5 ${
            idx < rows.length - 1 ? 'border-b border-white/[.07]' : ''
          } ${row.isTotal ? 'pt-2.5' : ''}`}
        >
          <span className={`text-[0.79rem] ${
            row.isTotal ? 'text-lime/90 font-bold' : 'text-white/60'
          }`}>
            {row.label}
          </span>
          <span className={`font-bold tabular-nums ${
            row.isTotal ? 'text-lime/90 text-base' : 'text-sm'
          }`}>
            {fmtCurrency(Math.abs(row.value))}
          </span>
        </div>
      ))}
    </div>
  );
}
