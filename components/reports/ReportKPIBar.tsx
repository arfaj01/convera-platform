'use client';

/**
 * ReportKPIBar — Generic KPI strip for report pages.
 * Each card accepts a label, value, optional subLabel, and color variant.
 */

export interface KPICard {
  label: string;
  value: string | number;
  subLabel?: string;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'purple';
  icon?: string;
}

const VARIANT_STYLES: Record<NonNullable<KPICard['variant']>, { bg: string; accent: string; text: string }> = {
  default: { bg: '#F7F8FA',  accent: '#045859', text: '#045859' },
  success: { bg: '#F0F7E0',  accent: '#87BA26', text: '#4A7B00' },
  warning: { bg: '#FFF8E0',  accent: '#FFC845', text: '#B8860B' },
  danger:  { bg: '#FAEEE8',  accent: '#C05728', text: '#C05728' },
  info:    { bg: '#E0F4F3',  accent: '#00A79D', text: '#006B63' },
  purple:  { bg: '#F3E5FF',  accent: '#502C7C', text: '#502C7C' },
};

interface ReportKPIBarProps {
  cards: KPICard[];
  className?: string;
}

export default function ReportKPIBar({ cards, className = '' }: ReportKPIBarProps) {
  return (
    <div
      className={`grid gap-2 print:gap-1 ${className}`}
      style={{ gridTemplateColumns: `repeat(${Math.min(cards.length, 6)}, minmax(0, 1fr))` }}
    >
      {cards.map((card, i) => {
        const v = VARIANT_STYLES[card.variant ?? 'default'];
        return (
          <div
            key={i}
            className="rounded-lg border p-3 print:p-2"
            style={{
              background: v.bg,
              borderColor: `${v.accent}30`,
              borderTopWidth: 3,
              borderTopColor: v.accent,
            }}
          >
            <div className="flex items-start justify-between gap-1">
              <p className="text-[0.7rem] text-gray-500 leading-tight font-medium">{card.label}</p>
              {card.icon && <span className="text-base opacity-60">{card.icon}</span>}
            </div>
            <p
              className="text-xl font-black mt-1 leading-none tabular-nums"
              style={{ color: v.text }}
            >
              {card.value}
            </p>
            {card.subLabel && (
              <p className="text-[0.65rem] mt-0.5 leading-tight" style={{ color: v.accent }}>
                {card.subLabel}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
