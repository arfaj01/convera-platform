'use client';

/**
 * ملخص العقود — Smart Contracts Summary Panel
 *
 * Shows each contract with:
 * - name + contract number + contractor
 * - current value, approved spending, remaining balance
 * - change order status
 * - visual risk badge if near ceiling
 */

import Link from 'next/link';
import type { ContractSpend, ChangeOrderSummary } from '@/services/dashboard';

interface Props {
  contracts:    ContractSpend[];
  changeOrders: ChangeOrderSummary[];
}

function fmtSAR(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'م م';
  if (n >= 1_000_000)     return (n / 1_000_000).toFixed(1) + 'م';
  if (n >= 1_000)         return (n / 1_000).toFixed(0) + 'ك';
  return Math.round(n).toLocaleString('ar-SA');
}

const RISK_BADGE = {
  critical: { bg: 'bg-[#FDECEA]', text: 'text-[#991B1B]', label: 'حرج' },
  warning:  { bg: 'bg-[#FFF8E0]', text: 'text-[#7A4F00]', label: 'تحذير' },
  normal:   null,
};

const PROGRESS_COLOR = {
  critical: '#DC2626',
  warning:  '#FFC845',
  normal:   '#87BA26',
};

export default function ContractsSummaryPanel({ contracts, changeOrders }: Props) {
  const coByContract = new Map(changeOrders.map(co => [co.contractId, co]));

  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#045859]">
        <div className="flex items-center gap-2">
          <div className="w-1 h-5 rounded bg-[#87BA26]" />
          <h3 className="text-[0.85rem] font-black text-white">ملخص العقود</h3>
        </div>
        <Link href="/contracts" className="text-[0.65rem] text-[#87BA26] font-bold no-underline hover:text-white">
          عرض الكل ←
        </Link>
      </div>

      {/* Table header */}
      <div className="hidden md:grid grid-cols-12 gap-0 px-4 py-2 bg-[#F7F8FA] border-b border-gray-100">
        <div className="col-span-4 text-[0.65rem] font-bold text-gray-400">العقد</div>
        <div className="col-span-2 text-[0.65rem] font-bold text-gray-400 text-center">
          القيمة الأساسية
          <div className="text-[0.55rem] font-normal text-gray-300 mt-0.5">قبل ض.ق.م</div>
        </div>
        <div className="col-span-2 text-[0.65rem] font-bold text-gray-400 text-center">
          المعتمد
          <div className="text-[0.55rem] font-normal text-gray-300 mt-0.5">إجمالي قبل ض.ق.م</div>
        </div>
        <div className="col-span-2 text-[0.65rem] font-bold text-gray-400 text-center">
          الرصيد المتاح
          <div className="text-[0.55rem] font-normal text-gray-300 mt-0.5">السقف − المعتمد</div>
        </div>
        <div className="col-span-1 text-[0.65rem] font-bold text-gray-400 text-center">أوامر تغيير</div>
        <div className="col-span-1 text-[0.65rem] font-bold text-gray-400 text-center">الحالة</div>
      </div>

      {/* Rows */}
      {contracts.length === 0 ? (
        <div className="py-10 text-center text-[0.8rem] text-gray-400">لا توجد عقود نشطة</div>
      ) : (
        <div className="divide-y divide-gray-50">
          {contracts.map(ct => {
            const riskBadge = RISK_BADGE[ct.riskLevel];
            const barColor  = PROGRESS_COLOR[ct.riskLevel];
            const co        = coByContract.get(ct.contractId);

            return (
              <div key={ct.contractId} className="px-4 py-3 hover:bg-[#F7F8FA] transition-colors">
                {/* Desktop layout */}
                <div className="hidden md:grid grid-cols-12 gap-0 items-center">
                  {/* Contract name */}
                  <div className="col-span-4 pe-3">
                    <Link href={`/contracts/${ct.contractId}`} className="no-underline group">
                      <div className="text-[0.78rem] font-bold text-[#045859] group-hover:text-[#00A79D] truncate">
                        {ct.title}
                      </div>
                      <div className="text-[0.62rem] text-gray-400 mt-0.5">{ct.contractNo}</div>
                    </Link>
                  </div>

                  {/* Base value */}
                  <div className="col-span-2 text-center">
                    <div className="text-[0.8rem] font-black text-gray-700 tabular-nums">{fmtSAR(ct.baseValue)}</div>
                    <div className="text-[0.58rem] text-gray-400">
                      سقف: {fmtSAR(ct.ceiling)}
                    </div>
                  </div>

                  {/* Approved spend */}
                  <div className="col-span-2 text-center">
                    <div className="text-[0.8rem] font-black tabular-nums" style={{ color: barColor }}>
                      {fmtSAR(ct.approvedSpend)}
                    </div>
                    <div className="text-[0.58rem] text-gray-400">{ct.pctConsumed.toFixed(1)}% من السقف</div>
                  </div>

                  {/* Remaining = ceiling − approvedSpend */}
                  <div className="col-span-2 text-center">
                    <div className={`text-[0.8rem] font-black tabular-nums ${
                      ct.remaining < 0 ? 'text-[#DC2626]' : 'text-[#045859]'
                    }`}>
                      {ct.remaining < 0 ? '−' : ''}{fmtSAR(Math.abs(ct.remaining))}
                    </div>
                    <div className="text-[0.58rem] text-gray-400">ر.س · قبل ض.ق.م</div>
                  </div>

                  {/* Change orders */}
                  <div className="col-span-1 text-center">
                    {co ? (
                      <div>
                        <div className="text-[0.78rem] font-bold text-[#502C7C]">{co.count}</div>
                        {co.pendingCount > 0 && (
                          <div className="text-[0.58rem] text-[#C05728] font-bold">{co.pendingCount} معلّق</div>
                        )}
                      </div>
                    ) : (
                      <div className="text-[0.68rem] text-gray-300">—</div>
                    )}
                  </div>

                  {/* Risk badge */}
                  <div className="col-span-1 text-center">
                    {riskBadge ? (
                      <span className={`text-[0.6rem] font-bold px-1.5 py-0.5 rounded-full ${riskBadge.bg} ${riskBadge.text}`}>
                        {riskBadge.label}
                      </span>
                    ) : (
                      <span className="text-[0.6rem] font-bold text-[#87BA26]">طبيعي</span>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                <div className="hidden md:block mt-2">
                  <div className="w-full h-1 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(ct.pctConsumed, 100)}%`,
                        background: barColor,
                      }}
                    />
                  </div>
                </div>

                {/* Mobile layout */}
                <div className="md:hidden">
                  <div className="flex justify-between items-start">
                    <div>
                      <Link href={`/contracts/${ct.contractId}`} className="text-[0.82rem] font-bold text-[#045859] no-underline">
                        {ct.title.substring(0, 35)}
                      </Link>
                      <div className="text-[0.65rem] text-gray-400 mt-0.5">{ct.contractNo}</div>
                    </div>
                    {riskBadge && (
                      <span className={`text-[0.6rem] font-bold px-1.5 py-0.5 rounded-full ${riskBadge.bg} ${riskBadge.text}`}>
                        {riskBadge.label}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-4 mt-2 text-[0.7rem]">
                    <div>
                      <span className="text-gray-400">المعتمد: </span>
                      <span className="font-bold" style={{ color: barColor }}>{fmtSAR(ct.approvedSpend)}</span>
                    </div>
                    <div>
                      <span className="text-gray-400">الرصيد: </span>
                      <span className="font-bold text-[#045859]">{fmtSAR(Math.max(ct.remaining, 0))}</span>
                    </div>
                  </div>
                  <div className="mt-1.5 w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.min(ct.pctConsumed, 100)}%`, background: barColor }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* VAT basis footnote */}
      <div className="px-4 py-2 border-t border-gray-50 bg-[#F7F8FA]">
        <p className="text-[0.58rem] text-gray-400 text-center">
          السقف المالي = القيمة الأساسية × ١١٠٪ | الرصيد = السقف − المعتمد |{' '}
          <span className="font-bold text-[#045859]">جميع القيم قبل ضريبة القيمة المضافة (١٥٪)</span>
        </p>
      </div>
    </div>
  );
}
