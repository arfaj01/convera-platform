'use client';

/**
 * SectionCard — a Card with a built-in title row that includes optional
 * subtitle, icon, and an "actions" slot (buttons / filters) on the
 * opposite side of the title.
 *
 * Use for sectioned content on dashboards and detail pages.
 */

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export interface SectionCardProps {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  /** Right-side area: buttons, dropdowns, filters */
  actions?: ReactNode;
  /** Body content */
  children: ReactNode;
  /** Compact = less padding */
  compact?: boolean;
  className?: string;
}

export default function SectionCard({
  title,
  subtitle,
  icon: Icon,
  actions,
  children,
  compact = false,
  className = '',
}: SectionCardProps) {
  const headerPad = compact ? 'px-4 py-2.5' : 'px-5 py-3.5';
  const bodyPad = compact ? 'p-4' : 'p-5';
  return (
    <div className={'bg-white rounded-xl shadow-card border border-gray-100 ' + className}>
      <div className={'flex items-center justify-between gap-3 border-b border-gray-100 ' + headerPad}>
        <div className="flex items-center gap-2.5 min-w-0">
          {Icon && (
            <div className="w-8 h-8 rounded-lg bg-[#E8F4F4] text-[#045859] flex items-center justify-center flex-shrink-0">
              <Icon size={16} strokeWidth={2} />
            </div>
          )}
          <div className="min-w-0">
            <h3 className="text-sm font-extrabold text-[#045859] truncate">{title}</h3>
            {subtitle && <p className="text-[11px] text-gray-500 mt-0.5 truncate">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
      </div>
      <div className={bodyPad}>{children}</div>
    </div>
  );
}
