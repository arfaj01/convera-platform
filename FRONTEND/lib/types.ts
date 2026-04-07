// ─── Database Enums ──────────────────────────────────────────────
/**
 * User roles in CONVERA platform
 * - director: Platform owner — Mohammed Al-Arfaj only (مدير الإدارة)
 * - final_approver: Designated final approver per contract (المعتمد النهائي)
 * - admin: Internal auditor/system administrator (مدقق / مشرف النظام)
 * - reviewer: Governance/alignment reviewer (مراجع)
 * - consultant: External consulting firm representative (جهة الإشراف)
 * - contractor: Project contractor/vendor (مقاول)
 * Legacy aliases kept for backward compatibility:
 * - auditor → admin, supervisor → consultant
 */
export type UserRole = 'director' | 'admin' | 'reviewer' | 'consultant' | 'contractor' | 'auditor' | 'supervisor' | 'final_approver';

/**
 * Contract-scoped roles (from user_contract_roles table — migration 025).
 * Maps to the contract_role PostgreSQL enum.
 *
 * Mapping from legacy UserRole → ContractRole:
 *   contractor  → contractor
 *   consultant  → supervisor  (renamed for clarity)
 *   admin       → auditor     (renamed for clarity)
 *   reviewer    → reviewer
 *   director    → N/A (global, not contract-scoped)
 */
export type ContractRole = 'contractor' | 'supervisor' | 'auditor' | 'reviewer' | 'viewer' | 'final_approver';

/**
 * A user's role assignment on a specific contract.
 * Represents a row from the user_contract_roles table.
 */
export interface UserContractRole {
  id: string;
  user_id: string;
  contract_id: string;
  contract_role: ContractRole;
  is_active: boolean;
  assigned_by: string | null;
  assigned_at: string;
  notes: string | null;
}

export type ContractStatus = 'draft' | 'active' | 'completed' | 'suspended' | 'closed';
export type ContractType = 'consultancy' | 'supervision' | 'construction' | 'supply' | 'design' | 'design_supervision' | 'maintenance';

/**
 * 5-stage claim workflow: contractor → supervisor → auditor → reviewer → director
 * - draft: Unsaved draft on contractor's device
 * - submitted: Contractor has submitted for approval
 * - under_supervisor_review: Supervisor reviewing (SLA: 3 working days)
 * - returned_by_supervisor: Supervisor returned to contractor
 * - under_auditor_review: Auditor technical review
 * - returned_by_auditor: Auditor returned to contractor
 * - under_reviewer_check: Reviewer checking governance/اعتماد alignment
 * - pending_director_approval: Awaiting director final decision
 * - approved: Director approved, claim is finalized
 * - rejected: Director rejected, claim is closed
 * - cancelled: Contractor cancelled before supervisor action (terminal)
 */
export type ClaimStatus =
  | 'draft'
  | 'submitted'
  | 'under_supervisor_review'
  | 'returned_by_supervisor'
  | 'under_auditor_review'
  | 'returned_by_auditor'
  | 'under_reviewer_check'
  | 'pending_director_approval'
  | 'approved'
  | 'rejected'
  | 'cancelled';
export type ClaimType = 'boq_only' | 'staff_only' | 'mixed' | 'supervision';
export type BoqProgressModel = 'count' | 'percentage' | 'monthly_lump_sum';

// ─── Database Row Types ─────────────────────────────────────────

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  full_name_ar: string | null;
  role: UserRole;
  phone: string | null;
  organization: string | null;
  avatar_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Contract {
  id: string;
  contract_no: string;
  title: string;
  title_ar: string | null;
  type: ContractType;
  status: ContractStatus;
  party_name: string;
  party_name_ar: string | null;
  party_tax_no: string | null;
  base_value: number;
  vat_value: number;    // generated
  total_value: number;  // generated
  retention_pct: number;
  boq_progress_model: BoqProgressModel;
  start_date: string;
  end_date: string;
  duration_months: number;
  region: string | null;
  director_id: string | null;
  admin_id: string | null;
  external_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Claim {
  id: string;
  claim_no: number;
  contract_id: string;
  reference_no: string | null;
  status: ClaimStatus;
  claim_type: ClaimType;
  period_from: string | null;
  period_to: string | null;
  invoice_date: string | null;
  boq_amount: number;
  staff_amount: number;
  gross_amount: number;   // generated
  retention_amount: number;
  net_amount: number;     // generated
  vat_amount: number;
  total_amount: number;   // generated
  submitted_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  return_reason: string | null;
  rejection_reason: string | null;
  has_completion_certificate: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClaimBOQItem {
  id: string;
  claim_id: string;
  item_no: number;
  description: string;
  description_ar: string | null;
  unit: string;
  unit_price: number;
  contractual_qty: number;
  prev_progress: number;
  curr_progress: number;
  period_amount: number;
  performance_pct: number;
  after_perf: number;
  cumulative: number;
  progress_model: BoqProgressModel | null;
  requires_variation: boolean;
  change_order_id: string | null;
}

export interface ClaimStaffItem {
  id: string;
  claim_id: string;
  item_no: number;
  position: string;
  position_ar: string | null;
  monthly_rate: number;
  contract_months: number;
  working_days: number;
  overtime_hours: number;
  basic_amount: number;
  extra_amount: number;
  total_amount: number;
  performance_pct: number;
  after_perf: number;
  cumulative: number;
  change_order_id: string | null;
}

export interface ClaimWorkflow {
  id: string;
  claim_id: string;
  action: string;
  from_status: ClaimStatus;
  to_status: ClaimStatus;
  actor_id: string;
  notes: string | null;
  created_at: string;
  profiles?: { full_name_ar: string | null; full_name: string };
}

export interface SupervisorReviewMetadata {
  started_at: string | null;
  day_2_warning_sent_at: string | null;
  day_3_escalation_sent_at: string | null;
  is_sla_breached: boolean;
}

export interface BOQTemplate {
  id: string;
  contract_id: string;
  item_no: number;
  description: string;
  description_ar: string | null;
  unit: string;
  unit_price: number;
  contractual_qty: number;
  progress_model: BoqProgressModel | null;
  sort_order: number;
}

export interface StaffTemplate {
  id: string;
  contract_id: string;
  item_no: number;
  position: string;
  position_ar: string | null;
  monthly_rate: number;
  contract_months: number;
  sort_order: number;
}

// ─── Change Order Types ──────────────────────────────────────────

export type ChangeOrderType = 'addition' | 'quantity_modification' | 'deletion' | 'duration_extension';
export type ChangeOrderStatus = 'draft' | 'submitted' | 'under_supervisor_review' | 'under_auditor_review' | 'under_reviewer_check' | 'pending_director_approval' | 'approved' | 'rejected';

export interface ChangeOrder {
  id: string;
  contract_id: string;
  order_no: string;
  type: ChangeOrderType;
  title: string;
  description: string | null;
  status: ChangeOrderStatus;
  total_value_change: number;
  duration_change_days: number;
  is_financial_impact: boolean;
  rejection_reason: string | null;
  created_by: string;
  submitted_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChangeOrderBoqItem {
  id: string;
  change_order_id: string;
  original_item_id: string | null;
  item_no: number;
  description: string;
  description_ar: string | null;
  unit: string;
  new_qty: number | null;
  new_unit_price: number | null;
  value_impact: number;
}

export interface ChangeOrderStaffItem {
  id: string;
  change_order_id: string;
  original_item_id: string | null;
  position: string;
  position_ar: string | null;
  new_rate: number | null;
  value_impact: number;
}

export interface ContractCeiling {
  baseValue: number;
  amendmentCount: number;
  amendmentsTotal: number;
  ceiling: number;
  hasAmendments: boolean;
  totalSpent: number;
  remaining: number;
}

// ─── UI Types ────────────────────────────────────────────────────

export interface ContractView {
  no: string;
  id: string;
  title: string;
  party: string;
  value: number;
  vatValue: number;
  duration: number;
  start: string;
  end: string;
  type: string;
  status: ContractStatus;
  retentionPct: number;
  boqModel: BoqProgressModel;
  externalId: string | null;
  externalName: string | null;
}

export interface ClaimView {
  no: number;
  id: string;
  contractId: string;
  contractNo: string;
  ref: string;
  date: string;
  from: string;
  to: string;
  total: number;
  gross: number;
  retention: number;
  vat: number;
  boq: number;
  staff: number;
  status: ClaimStatus;
}

export interface BOQFormItem {
  id: number;
  name: string;
  price: number;
  unit: string;
  contractualQty: number;
  model: BoqProgressModel | null;
}

export interface StaffFormItem {
  id: number;
  name: string;
  role: string;
  price: number;
  months: number;
  color: string;
}

// ─── Document Types ──────────────────────────────────────────────

export type DocumentType = 'invoice' | 'technical_report' | 'completion_certificate' | 'audit_review_form' | 'other';

export interface Document {
  id: string;
  entity_type: 'claim' | 'change_order' | 'contract';
  entity_id: string;
  document_type: DocumentType;
  file_name: string;
  file_size: number;
  storage_path: string;
  uploaded_by: string;
  created_at: string;
  is_generated: boolean;
  is_immutable: boolean;
}

export interface GeneratedCertificate {
  id: string;
  claim_id: string;
  certificate_type: 'completion' | 'audit_review_form';
  file_path: string;
  generated_at: string;
  generated_by: string;
  is_immutable: boolean;
}

// ─── Notification Types ──────────────────────────────────────────

export type NotificationType =
  | 'claim_submitted'
  | 'claim_approved'
  | 'claim_rejected'
  | 'claim_returned'
  | 'supervisor_sla_warning'
  | 'supervisor_sla_escalation'
  | 'change_order_submitted'
  | 'change_order_approved'
  | 'change_order_rejected'
  | 'change_order_approaching_limit';

export interface Notification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  entity_type: 'claim' | 'change_order' | 'contract';
  entity_id: string;
  is_read: boolean;
  created_at: string;
}

// ─── Audit Log Types ────────────────────────────────────────────

export interface AuditLog {
  id: string;
  table_name: string;
  record_id: string;
  action: 'insert' | 'update' | 'delete';
  actor_id: string;
  actor_role: UserRole;
  from_status: string | null;
  to_status: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

// ─── Derived/Computed Types ────────────────────────────────────

export interface ClaimSummary {
  boqAmount: number;
  staffAmount: number;
  grossAmount: number;
  retentionAmount: number;
  netAmount: number;
  vatAmount: number;
  totalAmount: number;
}

export interface ContractFinancialSummary {
  baseValue: number;
  vatValue: number;
  totalValue: number;
  approvedClaimsTotal: number;
  changeOrdersTotal: number;
  maxAllowedValue: number;
  remaining: number;
  percentageUtilized: number;
  retentionHeld: number;
}

export interface WorkflowTransition {
  action: string;
  fromStatus: ClaimStatus;
  toStatus: ClaimStatus;
  allowedRoles: UserRole[];
  requiresNote: boolean;
  minNoteLength?: number;
  description: string;
}

export interface WorkflowState {
  currentStatus: ClaimStatus;
  availableActions: WorkflowTransition[];
  canReturn: boolean;
  canResubmit: boolean;
  isApproved: boolean;
  isRejected: boolean;
  isBlocked: boolean;
}

export interface DashboardKPI {
  totalActiveContracts: number;
  totalContractValue: number;
  pendingClaimsForCurrentUser: number;
  approvedThisMonth: number;
  totalRemainingBudget: number;
  contractsApproachingLimit: number;
}

export interface SLAStatus {
  daysElapsed: number;
  hoursUntilBreach: number;
  hoursUntilEscalation: number;
  isWarningTriggered: boolean;
  isBreached: boolean;
  breachDate: string | null;
}

// ─── Contract Approver Types (Migration 040) ───────────────────

export type ApprovalScope = 'final_approver' | 'reviewer' | 'auditor';
export type PermissionRequestStatus = 'pending' | 'approved' | 'rejected';

/**
 * A dynamic approver assignment on a specific contract.
 * Represents a row from the contract_approvers table.
 */
export interface ContractApprover {
  id: string;
  contract_id: string;
  user_id: string;
  approval_scope: ApprovalScope;
  granted_by: string | null;
  granted_at: string;
  revoked_at: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  profiles?: { full_name_ar: string | null; full_name: string; email: string };
}

/**
 * A permission request submitted by ADMIN for Director approval.
 * Represents a row from the permission_requests table.
 */
export interface PermissionRequest {
  id: string;
  requested_by: string;
  target_user_id: string;
  contract_id: string;
  requested_scope: ApprovalScope;
  status: PermissionRequestStatus;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  requester?: { full_name_ar: string | null; full_name: string };
  target_user?: { full_name_ar: string | null; full_name: string; email: string };
  contract?: { contract_no: string; title_ar: string | null };
}

// ─── Legacy / Amendment Types (for services/amendments.ts) ──────

/**
 * Amendment type — maps to contract_amendments table.
 * Used for legacy amendment tracking (pre-change-order system).
 */
export interface Amendment {
  id: string;
  contract_id: string;
  amendment_no: string;
  title: string;
  description: string | null;
  value_change: number;
  duration_change: number;
  document_path: string | null;
  document_name: string | null;
  status: 'pending' | 'approved' | 'rejected';
  rejection_reason: string | null;
  submitted_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}
