'use client';

/**
 * FilterBar — pill row used by list pages (claims, contracts, workflow,
 * action-center). Replaces the per-page hand-rolled filter chip rows.
 */

import type { ReactNode } from 'react';

export interface FilterItem<V extends string = string> {
  value: V;
  label: string;
  /** Optional count rendered as a small badge */
  count?: number;
  /** Optional icon rendered before the label */
  icon?: ReactNode;
}

export interface FilterBarProps<V extends string = string> {
  items: FilterItem<V>[];
  value: V;
  onChange: (value: V) => void;
  /** Label rendered before the pills (e.g. "تصفية:") */
  label?: string;
  className?: string;
  size?: 'sm' | 'md';
}

export default function FilterBar<V extends string = string>({
  items,
  value,
  onChange,
  label,
  className = '',
  size = 'md',
}: FilterBarProps<V>) {
  const padding = size === 'sm' ? 'px-2.5 py-1' : 'px-3 py-1.5';
  const fontSize = size === 'sm' ? 'text-[11px]' : 'text-xs';
  return (
    <div className={'flex flex-wrap items-center gap-2 ' + className}>
      {label && (
        <span className="text-xs text-gray-500 font-bold ms-1 me-2">{label}</span>
      )}
      {items.map(it => {
        const isActive = it.value === value;
        return (
          <button
            key={it.value}
            type="button"
            onClick={() => onChange(it.value)}
            className={
              'inline-flex items-center gap-1.5 rounded-full border transition-colors font-bold ' +
              padding + ' ' + fontSize + ' ' +
              (isActive
                ? 'bg-[#045859] text-white border-[#045859]'
                : 'bg-white text-gray-600 border-gray-200 hover:border-[#045859] hover:text-[#045859]')
            }
          >
            {it.icon}
            <span>{it.label}</span>
            {typeof it.count === 'number' && (
              <span
                className={
                  'inline-flex items-center justify-center rounded-full px-1.5 min-w-[18px] tabular-nums text-[10px] font-bold ' +
                  (isActive ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600')
                }
              >
                {it.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
