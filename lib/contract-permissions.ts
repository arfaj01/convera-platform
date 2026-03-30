/**
 * CONVERA — Contract-Scoped Permission Helpers (Sprint B)
 *
 * This module provides dual-read authorization: it checks the new
 * `user_contract_roles` table first, then falls back to the legacy
 * `user_contracts + profiles.role` model if no new-table entry exists.
 *
 * IMPORTANT:
 *   - This module does NOT modify any RLS policies
 *   - All queries use the admin (service-role) client to bypass RLS
 *   - Legacy fallback ensures backward compatibility even if
 *     user_contract_roles is empty or partially populated
 *
 * Sprint B scope:
 *   ✓ Dual-read helpers (new table → legacy fallback)
 *   ✓ Debug logging for role source tracing
 *   ✗ Does NOT replace existing permission checks yet
 *   ✗ Does NOT modify RLS
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ContractRole, UserRole } from './types';

// ─── Constants ──────────────────────────────────────────────────────

const LOG_PREFIX = '[contract-permissions]';

/**
 * Maps legacy UserRole → ContractRole for fallback resolution.
 * Director is omitted — global roles don't need contract-scoped checks.
 */
const LEGACY_ROLE_MAP: Partial<Record<UserRole, ContractRole>> = {
  contractor: 'contractor',
  consultant: 'supervisor',
  supervisor: 'supervisor',   // legacy alias
  admin:      'auditor',
  auditor:    'auditor',      // legacy alias
  reviewer:   'reviewer',
};

/**
 * Global roles that bypass contract scoping entirely.
 * These users have platform-wide access and do NOT appear in user_contract_roles.
 */
const GLOBAL_ROLES: UserRole[] = ['director'];

// ─── Role Source Tracking ───────────────────────────────────────────

export type RoleSource = 'new_table' | 'legacy_fallback' | 'global_role' | 'none';

export interface ContractRoleResult {
  /** The resolved contract role, or null if no access */
  role: ContractRole | null;
  /** Where the role was resolved from (for debug logging) */
  source: RoleSource;
}

// ─── Core Helpers ───────────────────────────────────────────────────

/**
 * Resolves the user's contract-scoped role using dual-read logic:
 *
 * 1. If user has a global role (director) → return null role with 'global_role' source
 *    (callers should treat global roles as having full access)
 * 2. Check user_contract_roles for an active assignment
 * 3. If not found → fall back to user_contracts + profiles.role mapping
 * 4. If still not found → return null with 'none' source (no access)
 *
 * @param admin    Service-role Supabase client (bypasses RLS)
 * @param userId   The user's profile ID
 * @param contractId  The target contract ID
 * @param globalRole  The user's profiles.role (for global-role bypass + legacy fallback)
 */
export async function resolveContractRole(
  admin: SupabaseClient,
  userId: string,
  contractId: string,
  globalRole: UserRole,
): Promise<ContractRoleResult> {
  // 1. Global roles bypass contract scoping
  if (GLOBAL_ROLES.includes(globalRole)) {
    console.debug(
      `${LOG_PREFIX} resolveContractRole: user=${userId} contract=${contractId} → GLOBAL (${globalRole})`,
    );
    return { role: null, source: 'global_role' };
  }

  // 2. Check new table: user_contract_roles
  try {
    const { data: ucr, error: ucrErr } = await admin
      .from('user_contract_roles')
      .select('contract_role')
      .eq('user_id', userId)
      .eq('contract_id', contractId)
      .eq('is_active', true)
      .maybeSingle();

    if (!ucrErr && ucr?.contract_role) {
      console.debug(
        `${LOG_PREFIX} resolveContractRole: user=${userId} contract=${contractId} → NEW_TABLE: ${ucr.contract_role}`,
      );
      return { role: ucr.contract_role as ContractRole, source: 'new_table' };
    }

    if (ucrErr) {
      console.warn(`${LOG_PREFIX} user_contract_roles query failed:`, ucrErr.message);
      // Fall through to legacy
    }
  } catch (e) {
    console.warn(`${LOG_PREFIX} user_contract_roles query exception:`, e);
    // Fall through to legacy
  }

  // 3. Legacy fallback: user_contracts + profiles.role
  try {
    const { count, error: ucErr } = await admin
      .from('user_contracts')
      .select('contract_id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('contract_id', contractId);

    if (!ucErr && (count ?? 0) > 0) {
      const mappedRole = LEGACY_ROLE_MAP[globalRole] ?? null;
      console.debug(
        `${LOG_PREFIX} resolveContractRole: user=${userId} contract=${contractId} → LEGACY: ${mappedRole} (from profiles.role=${globalRole})`,
      );
      return { role: mappedRole, source: 'legacy_fallback' };
    }

    if (ucErr) {
      console.warn(`${LOG_PREFIX} user_contracts fallback query failed:`, ucErr.message);
    }
  } catch (e) {
    console.warn(`${LOG_PREFIX} user_contracts fallback exception:`, e);
  }

  // 4. No access
  console.debug(
    `${LOG_PREFIX} resolveContractRole: user=${userId} contract=${contractId} → NO ACCESS`,
  );
  return { role: null, source: 'none' };
}

/**
 * Returns all contract IDs the user has access to (from user_contract_roles),
 * with legacy fallback to user_contracts.
 *
 * - Global roles → returns null (= unrestricted, all contracts)
 * - Scoped roles → returns array of contract IDs (may be empty)
 */
export async function resolveUserContractIdsV2(
  admin: SupabaseClient,
  userId: string,
  globalRole: UserRole,
): Promise<{ contractIds: string[] | null; source: RoleSource }> {
  // Global roles = unrestricted
  if (GLOBAL_ROLES.includes(globalRole)) {
    return { contractIds: null, source: 'global_role' };
  }

  // Try new table first
  try {
    const { data: newRows, error: newErr } = await admin
      .from('user_contract_roles')
      .select('contract_id')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (!newErr && newRows && newRows.length > 0) {
      const ids = newRows.map((r: { contract_id: string }) => r.contract_id);
      console.debug(
        `${LOG_PREFIX} resolveUserContractIdsV2: user=${userId} → NEW_TABLE: ${ids.length} contracts`,
      );
      return { contractIds: ids, source: 'new_table' };
    }
  } catch (e) {
    console.warn(`${LOG_PREFIX} resolveUserContractIdsV2 new table error:`, e);
  }

  // Legacy fallback
  try {
    const { data: legacyRows, error: legacyErr } = await admin
      .from('user_contracts')
      .select('contract_id')
      .eq('user_id', userId);

    if (!legacyErr && legacyRows) {
      const ids = legacyRows.map((r: { contract_id: string }) => r.contract_id);
      console.debug(
        `${LOG_PREFIX} resolveUserContractIdsV2: user=${userId} → LEGACY: ${ids.length} contracts`,
      );
      return { contractIds: ids, source: 'legacy_fallback' };
    }
  } catch (e) {
    console.warn(`${LOG_PREFIX} resolveUserContractIdsV2 legacy error:`, e);
  }

  return { contractIds: [], source: 'none' };
}

/**
 * Checks if user has a specific contract role on a specific contract.
 * Dual-read: new table → legacy fallback.
 */
export async function hasContractRole(
  admin: SupabaseClient,
  userId: string,
  contractId: string,
  requiredRole: ContractRole,
  globalRole: UserRole,
): Promise<boolean> {
  const { role, source } = await resolveContractRole(admin, userId, contractId, globalRole);

  // Global roles have implicit access to all contract actions
  if (source === 'global_role') return true;

  return role === requiredRole;
}

/**
 * Checks if user has ANY active role on a specific contract.
 * Dual-read: new table → legacy fallback.
 */
export async function hasContractAccess(
  admin: SupabaseClient,
  userId: string,
  contractId: string,
  globalRole: UserRole,
): Promise<boolean> {
  const { role, source } = await resolveContractRole(admin, userId, contractId, globalRole);
  return source === 'global_role' || role !== null;
}

// ─── Action-Level Permission Checks ─────────────────────────────────

/**
 * Can the user create a new claim on this contract?
 * Requires: contractor role on the contract (or global role).
 */
export async function canCreateClaim(
  admin: SupabaseClient,
  userId: string,
  contractId: string,
  globalRole: UserRole,
): Promise<boolean> {
  return hasContractRole(admin, userId, contractId, 'contractor', globalRole);
}

/**
 * Can the user perform the given workflow action on a claim in the given status?
 * Uses the CLAIM_TRANSITIONS state machine to determine the required contract role.
 *
 * Mapping: workflow allowedRoles (UserRole) → required ContractRole
 *   contractor  → contractor
 *   supervisor  → supervisor
 *   auditor     → auditor
 *   reviewer    → reviewer
 *   director    → (global, always allowed)
 */
export function getRequiredContractRole(
  allowedRoles: UserRole[],
): ContractRole | 'director' | null {
  // If director is in allowed roles, this is a director-only action
  if (allowedRoles.includes('director')) return 'director';
  // Map the first non-director role
  for (const role of allowedRoles) {
    const mapped = LEGACY_ROLE_MAP[role];
    if (mapped) return mapped;
  }
  return null;
}

/**
 * Can the user act on a workflow transition?
 * Resolves the user's contract role, then checks against the transition's required roles.
 */
export async function canActOnWorkflow(
  admin: SupabaseClient,
  userId: string,
  contractId: string,
  globalRole: UserRole,
  allowedRoles: UserRole[],
): Promise<{ allowed: boolean; contractRole: ContractRole | null; source: RoleSource }> {
  // Director is always allowed for director-stage actions
  if (GLOBAL_ROLES.includes(globalRole) && allowedRoles.includes('director')) {
    return { allowed: true, contractRole: null, source: 'global_role' };
  }

  const { role, source } = await resolveContractRole(admin, userId, contractId, globalRole);

  // Global roles with non-director stage — they can still act (backward compat)
  if (source === 'global_role') {
    return { allowed: true, contractRole: null, source: 'global_role' };
  }

  if (!role) {
    return { allowed: false, contractRole: null, source };
  }

  // Check if the resolved contract role matches any of the allowed roles
  const requiredContractRole = getRequiredContractRole(allowedRoles);
  const allowed = requiredContractRole === role;

  return { allowed, contractRole: role, source };
}

// ─── All Roles for a User ───────────────────────────────────────────

/**
 * Returns all active contract role assignments for a user.
 * Used for UI display (sidebar, role badges) and bulk access checks.
 */
export async function getUserContractRoles(
  admin: SupabaseClient,
  userId: string,
): Promise<{ contractId: string; contractRole: ContractRole }[]> {
  try {
    const { data, error } = await admin
      .from('user_contract_roles')
      .select('contract_id, contract_role')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (error) {
      console.warn(`${LOG_PREFIX} getUserContractRoles error:`, error.message);
      return [];
    }

    return (data ?? []).map((r: { contract_id: string; contract_role: string }) => ({
      contractId: r.contract_id,
      contractRole: r.contract_role as ContractRole,
    }));
  } catch (e) {
    console.warn(`${LOG_PREFIX} getUserContractRoles exception:`, e);
    return [];
  }
}
