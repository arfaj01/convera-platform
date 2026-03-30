/**
 * CONVERA Security Utilities
 *
 * Centralizes security-sensitive operations:
 *  - ID enumeration prevention (uniform "not found" responses)
 *  - Input sanitization (trim, strip control chars)
 *  - Safe integer parsing
 *  - Contract-based access scope enforcement
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserRole } from '@/lib/types';
import { NextResponse } from 'next/server';

// ─── ID Enumeration Prevention ────────────────────────────────────

/**
 * Returns a 404 response that looks identical whether:
 *   (a) the record doesn't exist, OR
 *   (b) the user lacks permission to view it.
 *
 * This prevents attackers from probing valid record IDs by
 * comparing "not found" vs "forbidden" responses.
 */
export function notFound(resource = 'السجل'): NextResponse {
  return NextResponse.json(
    { error: `${resource} غير موجود أو لا تملك صلاحية الوصول إليه` },
    { status: 404 },
  );
}

// ─── Contract Access Scope ────────────────────────────────────────

/**
 * Checks whether a user has access to a specific contract.
 *
 * Internal roles (director, admin, reviewer): see all contracts
 * External roles (consultant, contractor): see only their contracts
 *
 * Returns the contract record if accessible, null otherwise.
 * Caller should return notFound() if null is returned.
 */
export async function resolveContractAccess(
  admin: SupabaseClient,
  contractId: string,
  userId: string,
  userRole: UserRole,
): Promise<Record<string, unknown> | null> {
  const INTERNAL_ROLES: UserRole[] = ['director', 'admin', 'reviewer', 'auditor'];

  if (INTERNAL_ROLES.includes(userRole)) {
    // Internal users: load by ID only
    const { data } = await admin
      .from('contracts')
      .select('*')
      .eq('id', contractId)
      .maybeSingle();
    return data ?? null;
  }

  // External users: must be linked to this contract
  const { data: link } = await admin
    .from('user_contracts')
    .select('contract_id')
    .eq('contract_id', contractId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!link) return null;

  const { data } = await admin
    .from('contracts')
    .select('*')
    .eq('id', contractId)
    .maybeSingle();

  return data ?? null;
}

/**
 * Checks whether a user has access to a specific claim.
 * Internal users: any claim on their contracts.
 * External users: only claims they submitted.
 */
export async function resolveClaimAccess(
  admin: SupabaseClient,
  claimId: string,
  userId: string,
  userRole: UserRole,
): Promise<Record<string, unknown> | null> {
  const INTERNAL_ROLES: UserRole[] = ['director', 'admin', 'reviewer', 'auditor'];

  const { data: claim } = await admin
    .from('claims')
    .select('*, contracts!inner(id)')
    .eq('id', claimId)
    .maybeSingle();

  if (!claim) return null;

  if (INTERNAL_ROLES.includes(userRole)) return claim;

  // External: must own the claim
  if (claim.submitted_by !== userId) return null;

  return claim;
}

// ─── Input Sanitization ───────────────────────────────────────────

/** Trim whitespace and strip control characters from a string */
export function sanitizeText(input: unknown, maxLength = 2000): string {
  if (typeof input !== 'string') return '';
  return input
    .trim()
    .replace(/[\x00-\x1F\x7F]/g, '') // strip control chars
    .slice(0, maxLength);
}

/** Parse a positive integer safely — returns null if invalid */
export function safeParseInt(value: unknown): number | null {
  const n = parseInt(String(value), 10);
  if (isNaN(n) || n < 0) return null;
  return n;
}

/** Parse a positive float safely — returns null if invalid */
export function safeParseFloat(value: unknown): number | null {
  const n = parseFloat(String(value));
  if (isNaN(n) || n < 0) return null;
  return n;
}

/**
 * Validates that a string looks like a UUID (v4).
 * Prevents SQL injection via record ID params.
 */
export function isValidUUID(str: unknown): str is string {
  if (typeof str !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);
}

/**
 * Extract and validate a UUID from a URL path segment.
 * Returns null if missing or invalid (caller should return 404/400).
 */
export function extractId(pathname: string, position = -1): string | null {
  const parts = pathname.split('/').filter(Boolean);
  const id = position < 0 ? parts[parts.length + position] : parts[position];
  return isValidUUID(id) ? id : null;
}
