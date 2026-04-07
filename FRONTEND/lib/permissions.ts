import type { UserRole } from './types';
import { isGlobalRole, isScopedRole } from './contract-scope';

// ─── Role Classification ────────────────────────────────────────
// 5-stage workflow: contractor → supervisor → auditor → reviewer → director
//
// DB role name mapping (DB value → UI label):
//   director   → مدير الإدارة         (global, no scope check needed)
//   admin      → مدقق (auditor)       (global; legacy alias: 'auditor')
//   reviewer   → مراجع               (scoped via user_contracts)
//   consultant → جهة الإشراف (supervisor) (scoped; legacy alias: 'supervisor')
//   contractor → مقاول               (scoped)
//
// NOTE: 'auditor' and 'supervisor' are legacy frontend labels for 'admin' and
// 'consultant' respectively.  Both old and new names are handled here.

const INTERNAL_ROLES: UserRole[] = ['director', 'final_approver', 'admin', 'auditor', 'reviewer'];
const EXTERNAL_ROLES: UserRole[] = ['consultant', 'supervisor', 'contractor'];

export function isInternal(role: UserRole): boolean {
  return INTERNAL_ROLES.includes(role);
}

export function isExternal(role: UserRole): boolean {
  return EXTERNAL_ROLES.includes(role);
}

/**
 * True if the user's role requires active contract links to have any
 * operational scope.  Global roles (director, admin) do NOT require this.
 * Identical to isScopedRole() from contract-scope — re-exported here for
 * convenience in frontend component code.
 */
export { isGlobalRole, isScopedRole };

// ─── Page Access ─────────────────────────────────────────────────

const PAGE_ACCESS: Record<string, UserRole[] | 'all'> = {
  '/dashboard':    'all',
  '/contracts':    'all',
  '/claims':       'all',
  '/claims/new':   ['consultant', 'supervisor', 'contractor'],
  '/workflow':     ['director', 'final_approver', 'admin', 'auditor', 'reviewer'],
  '/permissions':  ['director', 'admin', 'auditor', 'reviewer'],
  '/import':       ['director', 'admin'],
  '/users':        ['director', 'admin'],
  '/settings':     'all',
};

export function canAccessPage(role: UserRole, path: string): boolean {
  const access = PAGE_ACCESS[path];
  if (!access) return true;
  if (access === 'all') return true;
  return access.includes(role);
}

// ─── Action Permissions ──────────────────────────────────────────

export function canSubmitClaim(role: UserRole): boolean {
  return EXTERNAL_ROLES.includes(role);
}

/**
 * Can this role approve a claim at the final stage?
 * Director and final_approver can; final_approver requires contract_approvers check (done at API level).
 * This is a quick client-side check — the API does the authoritative validation.
 */
export function canApproveClaim(role: UserRole): boolean {
  return role === 'director' || role === 'final_approver';
}

/**
 * Checks if a user can final-approve claims on a specific contract.
 * This is async because it queries contract_approvers table.
 * Used in UI to show/hide approve button for non-director users.
 */
export async function canFinalApproveOnContract(
  userId: string,
  contractId: string,
  supabase: any,
): Promise<boolean> {
  // Director always can
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();
  if (profile?.role === 'director') return true;

  // Check contract_approvers
  const { count } = await supabase
    .from('contract_approvers')
    .select('id', { count: 'exact', head: true })
    .eq('contract_id', contractId)
    .eq('user_id', userId)
    .eq('approval_scope', 'final_approver')
    .eq('is_active', true);

  return (count ?? 0) > 0;
}

export function canReviewClaim(role: UserRole): boolean {
  return INTERNAL_ROLES.includes(role);
}

export function canReturnClaim(role: UserRole): boolean {
  return (
    role === 'director' || role === 'final_approver' ||
    role === 'admin'    || role === 'auditor'    ||
    role === 'consultant' || role === 'supervisor'
  );
}

/**
 * Can this role reject a claim? Director and final_approver can.
 * Final approvers per contract — checked at API level via contract_approvers.
 */
export function canRejectClaim(role: UserRole): boolean {
  return role === 'director' || role === 'final_approver';
}

/**
 * Can this role manage users/permissions?
 * Director: full user management
 * Admin: can submit permission requests to Director
 * Reviewer: legacy — limited user management
 */
/**
 * Can this role manage users/permissions?
 * Director: full user management (create, edit, delete)
 * Admin: can create users and submit permission requests to Director
 */
export function canManageUsers(role: UserRole): boolean {
  return role === 'director' || role === 'admin';
}

/**
 * Can this role submit permission requests (for admin role)?
 */
export function canSubmitPermissionRequests(role: UserRole): boolean {
  return role === 'admin' || role === 'auditor';
}

/**
 * Can this role approve/reject permission requests?
 */
export function canApprovePermissionRequests(role: UserRole): boolean {
  return role === 'director';
}

export function canCreateAmendment(role: UserRole): boolean {
  return role === 'contractor';
}

export function canApproveAmendment(role: UserRole): boolean {
  return role === 'director' || role === 'final_approver';
}
