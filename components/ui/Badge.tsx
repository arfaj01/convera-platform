'use client';

import { CLAIM_STATUS_LABELS } from '@/lib/constants';
import type { ClaimStatus } from '@/lib/types';

const STATUS_STYLES: Record<ClaimStatus, string> = {
  draft:                        'bg-gray-100 text-gray-600',
  submitted:                    'bg-[#FFF8E0] text-[#C46A00]',
  under_supervisor_review:      'bg-[#E0F4F3] text-[#00796B]',
  returned_by_supervisor:       'bg-[#FAEEE8] text-[#C05728]',
  under_auditor_review:         'bg-[#EDE7F6] text-[#502C7C]',
  returned_by_auditor:          'bg-[#FAEEE8] text-[#C05728]',
  under_reviewer_check:         'bg-[#FFF8E0] text-[#F57F17]',
  pending_director_approval:    'bg-[#E8F4F4] text-[#045859]',
  approved:                     'bg-[#F0F7E0] text-[#558B2F]',
  rejected:                     'bg-[#FDECEA] text-[#C0392B]',
  cancelled:                    'bg-gray-100 text-gray-500',
};

interface BadgeProps {
  status: ClaimStatus;
  className?: string;
}

export default function Badge({ status, className = '' }: BadgeProps) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold whitespace-nowrap ${STATUS_STYLES[status] || 'bg-gray-100 text-gray-600'} ${className}`}>
      {CLAIM_STATUS_LABELS[status] || status}
    </span>
  );
}

interface CustomBadgeProps {
  label: string;
  variant?: 'teal' | 'lime' | 'red' | 'gray' | 'orange' | 'blue' | 'green' | 'purple';
  className?: string;
}

const VARIANT_STYLES: Record<string, string> = {
  teal:   'bg-[#E0F4F3] text-[#00796B]',
  lime:   'bg-[#F0F7E0] text-[#558B2F]',
  red:    'bg-[#FDECEA] text-[#C0392B]',
  gray:   'bg-gray-100 text-gray-600',
  orange: 'bg-[#FAEEE8] text-[#C05728]',
  blue:   'bg-[#E8F4F4] text-[#045859]',
  green:  'bg-[#F0F7E0] text-['#558B2F]',
  purple: 'bg-[#EDE7F6] text-['#502C7C]',
};

export function CustomBadge({ label, variant = 'teal', className = '' }: CustomBadgeProps) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold whitespace-nowrap ${VARIANT_STYLES[variant] || ''} ${className}`}>
      {label}
    </span>
  );
}
