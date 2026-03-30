'use client';

import { useState, useCallback, memo, useMemo } from 'react';
import { fmt } from '@/lib/formatters';
import { calcBOQLine, validateBoqProgress, type BOQLineResult } from '@/lib/calculations';
import type { BOQFormItem } from '@/lib/types';

interface BOQTableProps {
  items: BOQFormItem[];
  onChange: (results: BOQLineResult[], total: number, hasErrors?: boolean) => void;
  readonly?: boolean;
}

function BOQTableInner({ items, onChange, readonly = false }: BOQTableProps) {
  // prev = الكميات المنفذة (سابق), curr = الكميات الحالية (جاري)
  const [values, setValues] = useState<Record<number, { prev: number; curr: number }>>(
    () => Object.fromEntries(items.map(it => [it.id, { prev: 0, curr: 0 }]))
  );

  // Validation errors per item
  const [errors, setErrors] = useState<Record<number, string | null>>({});

  const recalc = useCallback((newValues: typeof values) => {
    const results = items.map(it => {
      const v = newValues[it.id] || { prev: 0, curr: 0 };
      return calcBOQLine(it, v.prev, v.curr);
    });
    // Total = sum of current period amounts only
    const total = results.reduce((s, r) => s + r.periodAmount, 0);

    // Validate each item
    const newErrors: Record<number, string | null> = {};
    let hasErrors = false;
    items.forEach(it => {
      const v = newValues[it.id] || { prev: 0, curr: 0 };
      const model = it.model || 'count';
      const validation = validateBoqProgress(v.curr, v.prev, it.contractualQty, model);
      if (!validation.valid) {
        newErrors[it.id] = validation.message || 'خطأ في التحقق';
        hasErrors = true;
      } else {
        newErrors[it.id] = null;
      }
    });
    setErrors(newErrors);
    onChange(results, total, hasErrors);
  }, [items, onChange]);

  const handleChange = (itemId: number, field: 'prev' | 'curr', value: number) => {
    const newValues = { ...values, [itemId]: { ...values[itemId], [field]: value } };
    setValues(newValues);
    recalc(newValues);
  };

  const results = items.map(it => {
    const v = values[it.id] || { prev: 0, curr: 0 };
    return calcBOQLine(it, v.prev, v.curr);
  });
  const total = results.reduce((s, r) => s + r.periodAmount, 0);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse min-w-[800px]">
        <thead>
          <tr>
            <th className="bg-teal-dark text-white/85 text-[0.64rem] text-right px-2 py-2">#</th>
            <th className="bg-teal-dark text-white/85 text-[0.64rem] text-right px-2 py-2">البند</th>
            <th className="bg-teal-dark text-white/85 text-[0.64rem] text-right px-2 py-2">سعر الوحدة</th>
            <th className="bg-teal-dark text-white/85 text-[0.64rem] text-center px-2 py-2">الكمية التعاقدية</th>
            <th className="bg-teal-dark text-white/85 text-[0.64rem] text-center px-2 py-2">الكميات المنفذة</th>
            <th className="bg-teal-dark text-white/85 text-[0.64rem] text-center px-1.5 py-2 bg-teal">الكميات الحالية (جاري)</th>
            <th className="bg-teal-dark text-white/85 text-[0.64rem] text-center px-2 py-2">نسبة الإنجاز</th>
            <th className="bg-teal-dark text-white/85 text-[0.64rem] text-right px-2 py-2">المستحق الجاري</th>
            <th className="bg-teal-dark text-white/85 text-[0.64rem] text-right px-2 py-2">المبلغ الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, idx) => {
            const r = results[idx];
            const v = values[it.id] || { prev: 0, curr: 0 };

            // نسبة الإنجاز = (المنفذة + الحالية) / التعاقدية
            const progressPct = it.contractualQty > 0
              ? ((r.cumulativeQty / it.contractualQty) * 100).toFixed(1)
              : '0.0';

            return (
              <tr key={it.id} className="hover:bg-teal-ultra">
                <td className="px-2 py-1.5 text-[0.75rem] border-b border-gray-100">{it.id}</td>
                <td className="px-2 py-1.5 text-[0.7rem] border-b border-gray-100 max-w-[180px] truncate">{it.name}</td>
                <td className="px-2 py-1.5 text-[0.75rem] border-b border-gray-100 font-bold text-teal-dark tabular-nums">{fmt(it.price)}</td>
                <td className="px-2 py-1.5 text-[0.75rem] border-b border-gray-100 text-center tabular-nums">{fmt(it.contractualQty)}</td>
                {/* الكميات المنفذة (سابق) */}
                <td className="px-2 py-1.5 border-b border-gray-100 text-center">
                  {readonly ? (
                    <span className="tabular-nums">{v.prev}</span>
                  ) : (
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={v.prev || ''}
                      placeholder="0"
                      onChange={e => handleChange(it.id, 'prev', parseFloat(e.target.value) || 0)}
                      className="w-[65px] text-center border border-gray-200 rounded px-1 py-1 text-xs font-sans focus:border-teal focus:outline-none tabular-nums"
                    />
                  )}
                </td>
                {/* الكميات الحالية (جاري) — highlighted */}
                <td className="px-1.5 py-1.5 border-b border-gray-100 text-center bg-teal-ultra/50">
                  {readonly ? (
                    <span className="tabular-nums font-bold">{v.curr}</span>
                  ) : (
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={v.curr || ''}
                      placeholder="0"
                      onChange={e => handleChange(it.id, 'curr', parseFloat(e.target.value) || 0)}
                      className="w-[65px] text-center border border-teal/30 rounded px-1 py-1 text-xs font-sans font-bold focus:border-teal focus:outline-none tabular-nums bg-white"
                    />
                  )}
                </td>
                <td className="px-2 py-1.5 text-[0.72rem] border-b border-gray-100 text-center tabular-nums">
                  <span className={parseFloat(progressPct) > 100 ? 'text-red font-bold' : ''}>
                    {progressPct}%
                  </span>
                  {errors[it.id] && (
                    <div className="text-red text-[0.6rem] mt-0.5 leading-tight">
                      {errors[it.id]}
                    </div>
                  )}
                </td>
                <td className="px-2 py-1.5 text-[0.75rem] border-b border-gray-100 font-bold text-teal-dark tabular-nums">{fmt(r.periodAmount)}</td>
                <td className="px-2 py-1.5 text-[0.75rem] border-b border-gray-100 font-bold text-teal-dark tabular-nums">{fmt(r.afterPerf)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={7} className="bg-teal-dark text-white font-bold px-2.5 py-2 border-none text-right text-[0.78rem]">
              إجمالي تكلفة الفاتورة الحالية (جاري)
            </td>
            <td colSpan={2} className="bg-teal-dark text-white font-bold px-2.5 py-2 border-none text-[0.78rem] tabular-nums">
              {fmt(total)} ريال
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

const BOQTable = memo(BOQTableInner);
export default BOQTable;
