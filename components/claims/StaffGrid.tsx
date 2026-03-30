'use client';

import { useState, useCallback } from 'react';
import { fmt } from '@/lib/formatters';
import { calcStaffLine, type StaffLineResult } from '@/lib/calculations';
import type { StaffFormItem } from '@/lib/types';

interface StaffGridProps {
  items: StaffFormItem[];
  onChange: (results: StaffLineResult[], total: number) => void;
  readonly?: boolean;
}

export default function StaffGrid({ items, onChange, readonly = false }: StaffGridProps) {
  const [values, setValues] = useState<Record<number, { days: number; ot: number; perf: number }>>(
    () => Object.fromEntries(items.map(it => [it.id, { days: 0, ot: 0, perf: 100 }]))
  );

  const recalc = useCallback((newValues: typeof values) => {
    const results = items.map(it => {
      const v = newValues[it.id] || { days: 0, ot: 0, perf: 100 };
      return calcStaffLine(it, v.days, v.ot, v.perf);
    });
    const total = results.reduce((s, r) => s + r.afterPerf, 0);
    onChange(results, total);
  }, [items, onChange]);

  const handleChange = (itemId: number, field: 'days' | 'ot' | 'perf', value: number) => {
    const newValues = { ...values, [itemId]: { ...values[itemId], [field]: value } };
    setValues(newValues);
    recalc(newValues);
  };

  const results = items.map(it => {
    const v = values[it.id] || { days: 0, ot: 0, perf: 100 };
    return calcStaffLine(it, v.days, v.ot, v.perf);
  });
  const total = results.reduce((s, r) => s + r.afterPerf, 0);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="bg-teal-dark text-white/85 text-[0.69rem] text-right px-3 py-2">#</th>
            <th className="bg-teal-dark text-white/85 text-[0.69rem] text-right px-3 py-2">المسمى الوظيفي</th>
            <th className="bg-teal-dark text-white/85 text-[0.69rem] text-right px-3 py-2">الدور</th>
            <th className="bg-teal-dark text-white/85 text-[0.69rem] text-right px-3 py-2">الراتب الشهري</th>
            <th className="bg-teal-dark text-white/85 text-[0.69rem] text-center px-3 py-2">أيام العمل</th>
            <th className="bg-teal-dark text-white/85 text-[0.69rem] text-center px-3 py-2">ساعات إضافية</th>
            <th className="bg-teal-dark text-white/85 text-[0.69rem] text-right px-3 py-2">الأساسي</th>
            <th className="bg-teal-dark text-white/85 text-[0.69rem] text-right px-3 py-2">الإضافي</th>
            <th className="bg-teal-dark text-white/85 text-[0.69rem] text-right px-3 py-2">الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, idx) => {
            const r = results[idx];
            const v = values[it.id] || { days: 0, ot: 0, perf: 100 };
            return (
              <tr key={it.id} className="hover:bg-teal-ultra">
                <td className="px-3 py-[11px] text-[0.8rem] border-b border-gray-100">{it.id}</td>
                <td className="px-3 py-[11px] text-[0.75rem] border-b border-gray-100">{it.name}</td>
                <td className="px-3 py-[11px] text-[0.72rem] border-b border-gray-100 text-gray-400">{it.role}</td>
                <td className="px-3 py-[11px] text-[0.8rem] border-b border-gray-100 font-bold text-teal-dark">{fmt(it.price)}</td>
                <td className="px-3 py-[11px] border-b border-gray-100 text-center">
                  {readonly ? (
                    <span>{v.days}</span>
                  ) : (
                    <input
                      type="number"
                      min={0}
                      max={31}
                      value={v.days}
                      onChange={e => handleChange(it.id, 'days', parseFloat(e.target.value) || 0)}
                      className="w-[50px] text-center border border-gray-200 rounded px-1 py-1 text-xs font-sans focus:border-teal focus:outline-none"
                    />
                  )}
                </td>
                <td className="px-3 py-[11px] border-b border-gray-100 text-center">
                  {readonly ? (
                    <span>{v.ot}</span>
                  ) : (
                    <input
                      type="number"
                      min={0}
                      value={v.ot}
                      onChange={e => handleChange(it.id, 'ot', parseFloat(e.target.value) || 0)}
                      className="w-[50px] text-center border border-gray-200 rounded px-1 py-1 text-xs font-sans focus:border-teal focus:outline-none"
                    />
                  )}
                </td>
                <td className="px-3 py-[11px] text-[0.8rem] border-b border-gray-100 font-bold text-teal-dark">{fmt(r.basicAmount)}</td>
                <td className="px-3 py-[11px] text-[0.8rem] border-b border-gray-100 font-bold text-teal-dark">{fmt(r.extraAmount)}</td>
                <td className="px-3 py-[11px] text-[0.8rem] border-b border-gray-100 font-bold text-teal-dark">{fmt(r.totalAmount)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={6} className="bg-teal-dark text-white font-bold px-3 py-2 border-none text-right">
              إجمالي الكوادر
            </td>
            <td colSpan={3} className="bg-teal-dark text-white font-bold px-3 py-2 border-none">
              {fmt(total)} ريال
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
