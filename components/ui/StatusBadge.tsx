'use client';

/**
 * StatusBadge — unified status pill for any entity type in CONVERA.
 *
 * Different entities (claims, contracts, change-orders, permission requests,
 * imports) used to roll their own badge styles. This component centralizes
 * the colour mapping so a status name resolves to a consistent visual.
 *
 * For claim statuses you can keep using the existing default Badge in
 * components/ui/Badge.tsx — this is the wider catch-all.
 */

import type { ReactNode } from 'react';

// ─── Colour vocabulary ─────────────────────────────────────────────

export type StatusTone =
  | 'neutral'   // grey
  | 'info'      // teal — neutral active state
  | 'progress'  // amber — in-progress / under review
  | 'review'    // purple — awaiting human decision
  | 'success'   // green — approved / completed
  | 'danger'    // red — rejected / breached
  | 'warning'   // orange — returned / needs attention
  | 'muted';    // light grey — draft / cancelled

const TONE_STYLES: Record<StatusTone, string> = {
  neutral:  'bg-gray-100 text-gray-700',
  info:     'bg-[#E0F4F3] text-[#00796B]',
  progress: 'bg-amber-50 text-amber-700',
  review:   'bg-[#EDE7F6] text-[#502C7C]',
  success:  'bg-[#F0F7E0] text-[#558B2F]',
  danger:   'bg-[#FDECEA] text-[#C0392B]',
  warning:  'bg-[#FAEEE8] text-[#C05728]',
  muted:    'bg-gray-50 text-gray-500',
};

// ─── Built-in status → tone maps ───────────────────────────────────

import type { ClaimStatus, ContractStatus, ChangeOrderStatus, PermissionRequestStatus } from '@/lib/types';
import type { ImportStatus } from '@/services/import-session';

const CLAIM_TONE: Record<ClaimStatus, StatusTone> = {
  draft:                     'muted',
  submitted:                 'info',
  under_supervisor_review:   'progress',
  returned_by_supervisor:    'warning',
  under_auditor_review:      'review',
  returned_by_auditor:       'warning',
  under_reviewer_check:      'progress',
  pending_director_approval: 'info',
  approved:                  'success',
  rejected:                  'danger',
  cancelled:                 'muted',
};

const CONTRACT_TONE: Record<ContractStatus, StatusTone> = {
  draft:     'muted',
  active:    'success',
  completed: 'info',
  suspended: 'warning',
  closed:    'neutral',
};

const CHANGE_ORDER_TONE: Record<ChangeOrderStatus, StatusTone> = {
  draft:                     'muted',
  submitted:                 'info',
  under_supervisor_review:   'progress',
  under_auditor_review:      'review',
  under_reviewer_check:      'progress',
  pending_director_approval: 'info',
  approved:                  'success',
  rejected:                  'danger',
};

const PERMISSION_TONE: Record<PermissionRequestStatus, StatusTone> = {
  pending:  'progress',
  approved: 'success',
  rejected: 'danger',
};

const IMPORT_TONE: Record<ImportStatus, StatusTone> = {
  pending:    'muted',
  validating: 'info',
  running:    'progress',
  completed:  'success',
  partial:    'warning',
  failed:     'danger',
};

export type EntityType = 'claim' | 'contract' | 'change_order' | 'permission' | 'import';

function resolveTone(entity: EntityType, status: string): StatusTone {
  switch (entity) {
    case 'claim':         return CLAIM_TONE[status as ClaimStatus]                   ?? 'neutral';
    case 'contract':      return CONTRACT_TONE[status as ContractStatus]             ?? 'neutral';
    case 'change_order':  return CHANGE_ORDER_TONE[status as ChangeOrderStatus]      ?? 'neutral';
    case 'permission':    return PERMISSION_TONE[status as PermissionRequestStatus]  ?? 'neutral';
    case 'import':        return IMPORT_TONE[status as ImportStatus]                 ?? 'neutral';
  }
}

// ─── Component ─────────────────────────────────────────────────────

export interface StatusBadgeProps {
  /** When set, status is auto-mapped to a tone via the entity's mapping */
  entity?: EntityType;
  /** Status string (only relevant when `entity` is set) */
  status?: string;
  /** Override tone manually (wins over entity/status mapping) */
  tone?: StatusTone;
  /** Display text — if omitted, uses the status string */
  children?: ReactNode;
  /** Compact mode — smaller padding/font */
  size?: 'sm' | 'md';
  className?: string;
}

export default function StatusBadge({
  entity,
  status,
  tone,
  children,
  size = 'md',
  className = '',
}: StatusBadgeProps) {
  const resolvedTone: StatusTone = tone
    ?? (entity && status ? resolveTone(entity, status) : 'neutral');

  const sizeClass = size === 'sm'
    ? 'px-2 py-0.5 text-[10px]'
    : 'px-2.5 py-0.5 text-xs';

  return (
    <span
      className={
        'inline-flex items-center rounded-full font-bold whitespace-nowrap ' +
        sizeClass + ' ' + TONE_STYLES[resolvedTone] + ' ' + className
      }
    >
      {children ?? status ?? ''}
    </span>
  );
}
