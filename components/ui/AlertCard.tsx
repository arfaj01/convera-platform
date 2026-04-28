'use client';

/**
 * AlertCard — governance-grade alert panel.
 * Use for SLA breaches, change-order ceiling warnings, missing attachments,
 * mandatory-action banners on claim/contract pages.
 */

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, ShieldAlert } from 'lucide-react';

export type AlertLevel = 'info' | 'success' | 'warning' | 'danger' | 'critical';

const LEVEL_STYLES: Record<AlertLevel, { bg: string; border: string; text: string; iconBg: string; icon: LucideIcon }> = {
  info: {
    bg: 'bg-[#E0F4F3]',
    border: 'border-r-4 border-r-[#00796B]',
    text: 'text-[#00796B]',
    iconBg: 'bg-white text-[#00796B]',
    icon: Info,
  },
  success: {
    bg: 'bg-[#F0F7E0]',
    border: 'border-r-4 border-r-[#558B2F]',
    text: 'text-[#558B2F]',
    iconBg: 'bg-white text-[#558B2F]',
    icon: CheckCircle2,
  },
  warning: {
    bg: 'bg-[#FFF8E0]',
    border: 'border-r-4 border-r-[#C46A00]',
    text: 'text-[#C46A00]',
    iconBg: 'bg-white text-[#C46A00]',
    icon: AlertTriangle,
  },
  danger: {
    bg: 'bg-[#FAEEE8]',
    border: 'border-r-4 border-r-[#C05728]',
    text: 'text-[#C05728]',
    iconBg: 'bg-white text-[#C05728]',
    icon: AlertCircle,
  },
  critical: {
    bg: 'bg-[#FDECEA]',
    border: 'border-r-4 border-r-[#C0392B]',
    text: 'text-[#C0392B]',
    iconBg: 'bg-white text-[#C0392B]',
    icon: ShieldAlert,
  },
};

export interface AlertCardProps {
  level?: AlertLevel;
  title: string;
  description?: string;
  /** Optional CTA — link or button rendered inline at the end */
  action?: ReactNode;
  /** Override the default icon for this level */
  icon?: LucideIcon;
  className?: string;
}

export default function AlertCard({
  level = 'info',
  title,
  description,
  action,
  icon: IconOverride,
  className = '',
}: AlertCardProps) {
  const s = LEVEL_STYLES[level];
  const Icon = IconOverride ?? s.icon;
  return (
    <div className={'rounded-lg p-4 flex items-start gap-3 ' + s.bg + ' ' + s.border + ' ' + className}>
      <div className={'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ' + s.iconBg}>
        <Icon size={18} strokeWidth={2.2} />
      </div>
      <div className="flex-1 min-w-0">
        <div className={'text-sm font-bold mb-0.5 ' + s.text}>{title}</div>
        {description && <div className="text-xs text-gray-700 leading-relaxed">{description}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}
