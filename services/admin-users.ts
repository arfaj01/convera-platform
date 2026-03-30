/**
 * CONVERA — Admin Users Client Service
 *
 * All functions call the /api/admin/users/* Next.js API routes.
 * These routes are protected server-side — director only.
 *
 * Auth: uses getAuthHeaders() to include the JWT bearer token in every
 * fetch() call — fixes the re-login bug caused by localStorage vs cookie
 * session mismatch.
 */

import { getAuthHeaders } from '@/lib/supabase';
import type { UserRole, ContractRole } from '@/lib/types';

// ── Types ──────────────────────────────────────────────────────────

/**
 * A contract-role assignment: which role a user holds on a specific contract.
 * Maps to user_contract_roles table (migration 025).
 */
export interface ContractRoleAssignment {
  contract_id:   string;
  contract_role: ContractRole;
}

export interface AdminUser {
  id:                  string;
  email:               string;
  full_name:           string;
  full_name_ar:        string | null;
  role:                UserRole;
  phone:               string | null;
  organization:        string | null;
  is_active:           boolean;
  created_at:          string;
  updated_at:          string;
  /** Legacy: plain contract IDs from user_contracts table */
  linked_contract_ids?: string[];
  /** New: per-contract role assignments from user_contract_roles table */
  contract_roles?:      ContractRoleAssignment[];
}

export interface CreateUserInput {
  email:               string;
  full_name:           string;
  full_name_ar:        string;
  role:                UserRole;
  phone?:              string;
  organization?:       string;
  linked_contract_ids?: string[];
  /** New: per-contract role assignments */
  contract_roles?:      ContractRoleAssignment[];
}

export interface UpdateUserInput {
  full_name?:          string;
  full_name_ar?:       string;
  role?:               UserRole;
  phone?:              string | null;
  organization?:       string | null;
  is_active?:          boolean;
  linked_contract_ids?: string[];
  /** New: when present, fully replaces user's contract-role assignments */
  contract_roles?:      ContractRoleAssignment[];
}

// ── Helpers ────────────────────────────────────────────────────────

// (apiCall not used directly — each function builds its own auth-aware fetch)

// ── Public functions ───────────────────────────────────────────────

/** Fetch all users — director only */
export async function adminFetchUsers(): Promise<AdminUser[]> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch('/api/admin/users', { headers: authHeaders });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return (json as { users: AdminUser[] }).users;
}

/** Create a new user — director only.
 *  Passing `linked_contract_ids` will immediately link those contracts
 *  server-side via the admin client (bypasses RLS).
 */
export async function adminCreateUser(
  input: CreateUserInput
): Promise<{ id: string; message: string }> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch('/api/admin/users', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(input),
  });
  const json = await res.json() as { user: { id: string }; message: string };
  if (!res.ok) throw new Error((json as any).error || `HTTP ${res.status}`);
  return { id: json.user.id, message: json.message };
}

/** Update a user's profile / role / active status — director only.
 *  Optionally syncs linked contracts on the server (bypasses RLS via admin client).
 *  Pass `linked_contract_ids: []` to remove ALL contracts.
 *  Omit the field to leave existing contracts unchanged.
 */
export async function adminUpdateUser(
  userId: string,
  input: UpdateUserInput
): Promise<void> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(`/api/admin/users/${userId}`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const json = await res.json();
    throw new Error(json.error || `HTTP ${res.status}`);
  }
}

/** Activate a user */
export async function adminActivateUser(userId: string): Promise<void> {
  await adminUpdateUser(userId, { is_active: true });
}

/** Deactivate a user */
export async function adminDeactivateUser(userId: string): Promise<void> {
  await adminUpdateUser(userId, { is_active: false });
}

/** Change a user's role */
export async function adminChangeRole(userId: string, role: UserRole): Promise<void> {
  await adminUpdateUser(userId, { role });
}

/** Send password reset email — director only */
export async function adminResetPassword(userId: string, email: string): Promise<string> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch('/api/admin/users/reset-password', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ userId, email }),
  });
  const json = await res.json() as { message: string };
  if (!res.ok) throw new Error((json as any).error || `HTTP ${res.status}`);
  return json.message;
}
