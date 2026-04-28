'use client';

/**
 * EmptyState — a graceful "no data" panel.
 * Drop in inside any Card or section that may have nothing to show.
 */

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Inbox } from 'lucide-react';

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** Optional CTA — usually an internal link or a button */
  action?: ReactNode;
  /** Pad more aggressively for full-page placeholders */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export default function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  size = 'md',
  className = '',
}: EmptyStateProps) {
  const padding =
    size === 'lg' ? 'py-16'
  : size === 'sm' ? 'py-6'
  : 'py-10';

  const iconSize = size === 'lg' ? 56 : size === 'sm' ? 28 : 40;

  return (
    <div className={'flex flex-col items-center justify-center text-center ' + padding + ' ' + className}>
      <div className="w-16 h-16 rounded-full bg-gray-50 text-gray-400 flex items-center justify-center mb-3">
        <Icon size={iconSize / 1.6} strokeWidth={1.5} />
      </div>
      <div className="text-sm font-bold text-gray-700 mb-1">{title}</div>
      {description && <div className="text-xs text-gray-500 max-w-md">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
