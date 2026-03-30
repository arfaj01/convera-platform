/** ─── Types ───*/

export type UserRole = 'director' | 'admin' | 'reviewer' | 'consultant' | 'contractor';
export type ContractRole = 'supervisor' | 'auditor' | 'reviewer' | 'contractor';

export type ContractStatus = 'draft' | 'active' | 'completed' | 'suspended' | 'closed';
export type ContractType = 'design' | 'supervision' | 'design_supervision' | 'construction' | 'consultancy';

export type ClaimStatus = 'draft' | 'submitted' | 'under_supervisor_reviev' | 'returned_by_supervisor' | 'under_auditor_review' | 'returned_by_auditor' | 'under_reviewer_check' | 'pending_director_approval' | 'approved' | 'rejected' | 'closed';

export type ClaimType = 'boq_only' | 'staff_only' | 'mixed' | 'supervision';

export type BoQProgressModel = 'count' | 'percentage' | 'monthly_lump_sum';

export interface Profile {
  id: string;
  email: string;
  role: UserRole;
  full_name: string | null;
  full_name_ar: string | null;
  avatar_url?: string;
  organization: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface Contract {
  id: string;
  contract_no: string;
  title: string;
  title_ar: string;
  type: ContractType;
  status: ContractStatus;
  base_value: number;
  duration_months: number;
  start_date: Date;
  end_date?: Date;
  retention_pct: number;
  vat_rate: number;
  created_at: Date;
  updated_at: Date;
}

export interface Claim {
  id: string;
  claim_no: number;
  status: ClaimStatus;
  contract_id: string;
  contract?: Contract;
  boq_amount: number;
  staff_amount: number;
  gross_amount: number;
  retention_amount: number;
  net_amount: number;
  vat_amount: number;
  total_amount: number;
  created_at: Date;
  updated_at: Date;
  return_reason?: string;
}

export interface ClaimBoQItem {
  id: string;
  item_no: number;
  unit_price: number;
  contractual_qty: number;
  curr_progress: number;
  period_amount: number;
}

export interface ClaimStaffItem {
  id: string;
  position: string;
  monthly_rate: number;
  working_days: number;
  basic_amount: number;
}

