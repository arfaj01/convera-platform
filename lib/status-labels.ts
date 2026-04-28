/**
 * Single source of truth for status → Arabic label mapping across all
 * CONVERA entities. Page-level STATUS_LABELS / STATUS_META maps should
 * import from here instead of redefining their own.
 *
 * For visual tone (badge colour) use components/ui/StatusBadge.tsx —
 * which keys off the same status strings via its built-in tone tables.
 */

import type {
  ClaimStatus,
  ContractStatus,
  ChangeOrderStatus,
  PermissionRequestStatus,
} from '@/lib/types';
import type { ImportStatus } from '@/services/import-session';

// ─── Claim ─────────────────────────────────────────────────────────

export const CLAIM_STATUS_LABEL_AR: Record<ClaimStatus, string> = {
  draft:                     'مسودة',
  submitted:                 'مُقدَّمة',
  under_supervisor_review:   'مراجعة جهة الإشراف',
  returned_by_supervisor:    'مُرجَعة من جهة الإشراف',
  under_auditor_review:      'مراجعة المدقق',
  returned_by_auditor:       'مُرجَعة من المدقق',
  under_reviewer_check:      'فحص المراجع',
  pending_director_approval: 'بانتظار اعتماد المدير',
  approved:                  'معتمدة',
  rejected:                  'مرفوضة',
  cancelled:                 'ملغاة',
};

// ─── Contract ──────────────────────────────────────────────────────

export const CONTRACT_STATUS_LABEL_AR: Record<ContractStatus, string> = {
  draft:     'مسودة',
  active:    'نشط',
  completed: 'مكتمل',
  suspended: 'موقوف',
  closed:    'مُغلق',
};

// ─── Change Order ──────────────────────────────────────────────────

export const CHANGE_ORDER_STATUS_LABEL_AR: Record<ChangeOrderStatus, string> = {
  draft:                     'مسودة',
  submitted:                 'مُقدَّم',
  under_supervisor_review:   'مراجعة جهة الإشراف',
  under_auditor_review:      'مراجعة المدقق',
  under_reviewer_check:      'فحص المراجع',
  pending_director_approval: 'بانتظار اعتماد المدير',
  approved:                  'مُعتمد',
  rejected:                  'مرفوض',
};

// ─── Permission Request ────────────────────────────────────────────

export const PERMISSION_REQUEST_LABEL_AR: Record<PermissionRequestStatus, string> = {
  pending:  'قيد الانتظار',
  approved: 'مُعتمد',
  rejected: 'مرفوض',
};

// ─── Import session ────────────────────────────────────────────────

export const IMPORT_STATUS_LABEL_AR: Record<ImportStatus, string> = {
  pending:    'قيد التهيئة',
  validating: 'جاري التحقق',
  running:    'جاري الاستيراد',
  completed:  'مكتمل بنجاح',
  partial:    'مكتمل جزئياً',
  failed:     'فشل',
};

// ─── Generic helpers ───────────────────────────────────────────────

export type EntityStatusKey = 'claim' | 'contract' | 'change_order' | 'permission' | 'import';

export function getStatusLabelAr(entity: EntityStatusKey, status: string): string {
  switch (entity) {
    case 'claim':         return CLAIM_STATUS_LABEL_AR[status as ClaimStatus]              ?? status;
    case 'contract':      return CONTRACT_STATUS_LABEL_AR[status as ContractStatus]        ?? status;
    case 'change_order':  return CHANGE_ORDER_STATUS_LABEL_AR[status as ChangeOrderStatus] ?? status;
    case 'permission':    return PERMISSION_REQUEST_LABEL_AR[status as PermissionRequestStatus] ?? status;
    case 'import':        return IMPORT_STATUS_LABEL_AR[status as ImportStatus]            ?? status;
  }
}

// ─── Stage descriptors (5-stage claim workflow) ───────────────────

export type WorkflowStage = 'contractor' | 'supervisor' | 'auditor' | 'reviewer' | 'director';

export const STAGE_LABEL_AR: Record<WorkflowStage, string> = {
  contractor: 'المقاول',
  supervisor: 'جهة الإشراف',
  auditor:    'المدقق',
  reviewer:   'المراجع',
  director:   'مدير الإدارة',
};

/**
 * Map a ClaimStatus to the workflow stage that currently owns it.
 * Returned value matches WorkflowStepper bullet ordering.
 */
export function ownerStageOf(status: ClaimStatus): WorkflowStage | null {
  switch (status) {
    case 'draft':
    case 'returned_by_supervisor':
    case 'returned_by_auditor':
      return 'contractor';
    case 'submitted':                  // transient — auto-routed
    case 'under_supervisor_review':
      return 'supervisor';
    case 'under_auditor_review':
      return 'auditor';
    case 'under_reviewer_check':
      return 'reviewer';
    case 'pending_director_approval':
      return 'director';
    case 'approved':
    case 'rejected':
    case 'cancelled':
      return null;
  }
}
