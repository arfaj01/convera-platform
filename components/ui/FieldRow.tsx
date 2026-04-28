'use client';

/**
 * FieldRow — display a labelled value pair on detail/summary panels.
 * Pulls the Arabic label and tooltip from lib/field-labels.ts when
 * `fieldKey` is supplied; otherwise falls back to `label`.
 */

import type { ReactNode } from 'react';
import { getLabel, getTooltip } from '@/lib/field-labels';

export interface FieldRowProps {
  /** Lookup key in lib/field-labels.ts (e.g. "contract_no") */
  fieldKey?: string;
  /** Override label (used when fieldKey is not supplied) */
  label?: string;
  /** Override tooltip */
  tooltip?: string;
  value: ReactNode;
  /** Show empty values as "—" instead of hiding the row */
  emptyDash?: boolean;
  className?: string;
}

export default function FieldRow({
  fieldKey,
  label,
  tooltip,
  value,
  emptyDash = true,
  className = '',
}: FieldRowProps) {
  const resolvedLabel = label ?? (fieldKey ? getLabel(fieldKey) : '');
  const resolvedTooltip = tooltip ?? (fieldKey ? getTooltip(fieldKey) : undefined);
  const empty = value == null || value === '' || (typeof value === 'number' && Number.isNaN(value));
  const display = empty && emptyDash ? '—' : value;

  return (
    <div className={'flex items-center justify-between gap-3 py-2 border-b border-gray-100 last:border-b-0 ' + className}>
      <div
        className="text-xs text-gray-500 font-bold"
        title={resolvedTooltip}
      >
        {resolvedLabel}
      </div>
      <div className="text-sm font-bold text-[#1A1A2E] text-left tabular-nums">
        {display}
      </div>
    </div>
  );
}
