'use client';

/**
 * KpiCard — a single metric tile for executive dashboards.
 * Replaces ad-hoc KPI cards previously rolled per-page.
 */

import type { LucideIcon } from 'lucide-react';

export type KpiTone = 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const TONE_RING: Record<KpiTone, string> = {
  primary: 'border-r-[3px] border-r-[#045859]',
  success: 'border-r-[3px] border-r-[#558B2F]',
  warning: 'border-r-[3px] border-r-[#C05728]',
  danger:  'border-r-[3px] border-r-[#C0392B]',
  info:    'border-r-[3px] border-r-[#00796B]',
  neutral: 'border-r-[3px] border-r-gray-300',
};

const TONE_ICON_BG: Record<KpiTone, string> = {
  primary: 'bg-[#E8F4F4] text-[#045859]',
  success: 'bg-[#F0F7E0] text-[#558B2F]',
  warning: 'bg-[#FAEEE8] text-[#C05728]',
  danger:  'bg-[#FDECEA] text-[#C0392B]',
  info:    'bg-[#E0F4F3] text-[#00796B]',
  neutral: 'bg-gray-100 text-gray-600',
};

export interface KpiCardProps {
  label: string;
  value: string | number;
  /** Sub-line under the value, e.g. "+12% من الشهر الماضي" */
  hint?: string;
  /** Sub-label under the main label, e.g. "كل العقود" */
  sublabel?: string;
  tone?: KpiTone;
  icon?: LucideIcon;
  /** When provided, the card becomes a link/clickable tile */
  href?: string;
  onClick?: () => void;
  className?: string;
}

export default function KpiCard({
  label,
  value,
  hint,
  sublabel,
  tone = 'primary',
  icon: Icon,
  href,
  onClick,
  className = '',
}: KpiCardProps) {
  const interactive = !!(href || onClick);
  const baseClass =
    'bg-white rounded-xl shadow-card p-4 ' + TONE_RING[tone] +
    (interactive ? ' hover:shadow-md transition-shadow cursor-pointer' : '') +
    ' ' + className;

  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-xs text-gray-500 font-bold mb-1">{label}</div>
          {sublabel && <div className="text-[10px] text-gray-400 mb-1">{sublabel}</div>}
          <div className="text-2xl font-extrabold text-[#1A1A2E] tabular-nums truncate">
            {value}
          </div>
          {hint && <div className="text-[11px] text-gray-500 mt-1">{hint}</div>}
        </div>
        {Icon && (
          <div className={'w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ' + TONE_ICON_BG[tone]}>
            <Icon size={20} strokeWidth={2} />
          </div>
        )}
      </div>
    </>
  );

  if (href) {
    return (
      <a href={href} className={baseClass + ' block no-underline'}>
        {content}
      </a>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={baseClass + ' text-right w-full'}>
        {content}
      </button>
    );
  }
  return <div className={baseClass}>{content}</div>;
}
