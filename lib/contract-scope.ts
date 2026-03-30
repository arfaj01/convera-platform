/**
 * CONVERA — Contract Scope Enforcement
 *
 * This module is the single source of truth for determining whether a user
 * has operational access to a contract.  It is intentionally server-side only
 * (uses the admin/service-role Supabase client) so it cannot be bypassed by
 * client-side manipulation.
 *
 * RULE:  Operational access requires BOTH:
 *   1. A valid, non-inactive user role
 *   2. An active contract link in `user_contracts`  (for scoped roles)
 *
 * Global roles (director, admin) are intentionally exempt from the
 * `user_contracts` check — they have platform-wide visibility by design.
 * All external / scoped roles MUST have at least one active contract link
 * to perform any contract-related operation.
 *
 * Usage (in API route handlers):
 *
 *   import { assertContractScope, resolveUserContractIds } from '@/lib/contract-scope';
 *
 *   // Throws a ScopeError (returns 403 JSON) if user has no access:
 *   await assertContractScope(ctx.admin, ctx.user.id, ctx.profile.role, contractId);
 *
 *   // Returns null (= all contracts) for global roles, or a UUID[] for scoped roles:
 *   const ids = await resolveUserContractIds(ctx.admin, ctx.user.id, ctx.profile.role);
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserRole } from './types';

// ─── Role Classification ───────────────────────────────────────────────────────

/**
 * Roles that have platform-wide contract visibility and are NOT bound by
 * the `user_contracts` table.  These users intentionally see all contracts.
 */
const GLOBAL_ROLES: UserRole[] = ['director', 'admin'];

/**
 * Roles that MUST have an entry in `user_contracts` to see/act on a contract.
 * If a user of one of these roles has no linked contracts, they have zero
 * operational scope and MUST be shown an appropriate empty/blocked state.
 */
const SCOPED_ROLES: UserRole[] = ['reviewer', 'consultant', 'supervisor', 'contractor', 'auditor'];

export function isGlobalRole(role: UserRole): boolean {
  return GLOBAL_ROLES.includes(role);
}

export function isScopedRole(role: UserRole): boolean {
  return SCOPED_ROLES.includes(role);
}

// ─── Core Scope Queries ────────────────────────────────────────────────────────
//
// Sprint B: Dual-read pattern — check user_contract_roles first, fall back to
// user_contracts (legacy) if no entry found. This ensures backward compatibility
// while gradually migrating to the new model.
// ────────────────────────────────────────────────────────────────────────────────

/**
 * Returns the list of contract IDs the user is authorized to act on:
 *   - null  → global role; caller should NOT filter by contract_id
 *   - []    → scoped role with NO linked contracts (zero operational scope)
 *   - [ids] → scoped role with the listed contracts
 *
 * Uses the service-role admin client to bypass RLS — this is intentional:
 * we want to read the *true* DB state, not the RLS-filtered view.
 *
 * Sprint B: Dual-read — new table first, legacy fallback.
 */
export async function resolveUserContractIds(
  admin: SupabaseClient,
  userId: string,
  role: UserRole,
): Promise<string[] | null> {
  if (isGlobalRole(role)) return null; // no restriction

  // 1. Try new table: user_contract_roles
  try {
    const { data: newData, error: newErr } = await admin
      .from('user_contract_roles')
      .select('contract_id')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (!newErr && newData && newData.length > 0) {
      console.debug(`[contract-scope] resolveUserContractIds: user=${userId} → NEW_TABLE (${newData.length} contracts)`);
      return newData.map((row: { contract_id: string }) => row.contract_id);
    }
  } catch (e) {
    console.warn('[contract-scope] user_contract_roles query failed, falling back to legacy:', e);
  }

  // 2. Legacy fallback: user_contracts
  const { data, error } = await admin
    .from('user_contracts')
    .select('contract_id')
    .eq('user_id', userId);

  if (error) {
    console.error('[contract-scope] resolveUserContractIds legacy failed:', error);
    return []; // fail-safe: no access on DB error
  }

  const ids = (data ?? []).map((row: { contract_id: string }) => row.contract_id);
  if (ids.length > 0) {
    console.debug(`[contract-scope] resolveUserContractIds: user=${userId} → LEGACY (${ids.length} contracts)`);
  }
  return ids;
}

/**
 * Returns true if the user has at least one linked contract (or is global).
 * Use this for "does the user have any operational scope at all?" checks.
 *
 * Sprint B: Dual-read — new table first, legacy fallback.
 */
export async function hasAnyContractScope(
  admin: SupabaseClient,
  userId: string,
  role: UserRole,
): Promise<boolean> {
  if (isGlobalRole(role)) return true;

  // 1. Try new table
  try {
    const { count: newCount, error: newErr } = await admin
      .from('user_contract_roles')
      .select('contract_id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_active', true);

    if (!newErr && (newCount ?? 0) > 0) {
      return true;
    }
  } catch (e) {
    console.warn('[contract-scope] hasAnyContractScope new table failed:', e);
  }

  // 2. Legacy fallback
  const { count, error } = await admin
    .from('user_contracts')
    .select('contract_id', { count: 'exact', head: true })
    .eq('user_id', userId);

  if (error) {
    console.error('[contract-scope] hasAnyContractScope legacy failed:', error);
    return false; // fail-safe
  }

  return (count ?? 0) > 0;
}

/**
 * Returns true if the user is authorized to act on a specific contract.
 *   - Global roles → always true
 *   - Scoped roles → must have a row in user_contract_roles (or user_contracts fallback)
 *
 * Sprint B: Dual-read — new table first, legacy fallback.
 */
export async function canAccessContract(
  admin: SupabaseClient,
  userId: string,
  role: UserRole,
  contractId: string,
): Promise<boolean> {
  if (isGlobalRole(role)) return true;

  // 1. Try new table
  try {
    const { count: newCount, error: newErr } = await admin
      .from('user_contract_roles')
      .select('contract_id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('contract_id', contractId)
      .eq('is_active', true);

    if (!newErr && (newCount ?? 0) > 0) {
      return true;
    }
  } catch (e) {
    console.warn('[contract-scope] canAccessContract new table failed:', e);
  }

  // 2. Legacy fallback
  const { count, error } = await admin
    .from('user_contracts')
    .select('contract_id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('contract_id', contractId);

  if (error) {
    console.error('[contract-scope] canAccessContract legacy failed:', error);
    return false; // fail-safe
  }

  return (count ?? 0) > 0;
}

// ─── Assertion Helper ──────────────────────────────────────────────────────────

/**
 * Asserts that the user has operational access to the given contract.
 *
 * Throws a `ScopeError` when access is denied.  API route handlers should
 * catch `ScopeError` and return the 403 JSON payload it carries.
 *
 * Example:
 *
 *   try {
 *     await assertContractScope(ctx.admin, ctx.user.id, ctx.profile.role, contractId);
 *   } catch (e) {
 *     if (e instanceof ScopeError) return NextResponse.json(e.payload, { status: 403 });
 *     throw e;
 *   }
 */
export class ScopeError extends Error {
  payload: { error: string };
  status: 403;

  constructor(message: string) {
    super(message);
    this.name = 'ScopeError';
    this.status = 403;
    this.payload = { error: message };
  }
}

export async function assertContractScope(
  admin: SupabaseClient,
  userId: string,
  role: UserRole,
  contractId: string,
): Promise<void> {
  const allowed = await canAccessContract(admin, userId, role, contractId);
  if (!allowed) {
    throw new ScopeError(
      'ليس لديك صلاحية للوصول إلى هذا العقد — تواصل مع مدير الإدارة لربط حسابك بالعقود المطلوبة',
    );
  }
}

/**
 * Asserts that the user has at least one linked contract (any operational scope).
 * Use at the top of handlers that require a contract context to be meaningful.
 */
export async function assertAnyContractScope(
  admin: SupabaseClient,
  userId: string,
  role: UserRole,
): Promise<void> {
  const hasScope = await hasAnyContractScope(admin, userId, role);
  if (!hasScope) {
    throw new ScopeError(
      'لا توجد عقود مرتبطة بحسابك حالياً — تواصل مع مدير الإدارة لتفعيل الصلاحيات التشغيلية',
    );
  }
}

// ─── Claim-Level Scope Resolver ────────────────────────────────────────────────

/**
 * Given a claim ID, resolves the contract_id and then asserts the user has
 * access to that contract.  This is the most common pattern for claim-level
 * scope enforcement.
 *
 * Returns the claim's contract_id on success so callers can use it.
 * Throws ScopeError on denial, or Error on DB failure.
 */
export async function assertClaimContractScope(
  admin: SupabaseClient,
  userId: string,
  role: UserRole,
  claimId: string,
): Promise<string> {
  // Fetch contract_id for this claim
  const { data: claim, error } = await admin
    .from('claims')
    .select('contract_id')
    .eq('id', claimId)
    .maybeSingle();

  if (error || !claim) {
    throw new Error('لم يتم العثور على المطالبة');
  }

  await assertContractScope(admin, userId, role, claim.contract_id);
  return claim.contract_id;
}
