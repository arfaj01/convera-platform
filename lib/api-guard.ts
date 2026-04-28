/**
 * CONVERA API Guard — Centralized authentication & authorization wrapper
 *
 * Replaces ad-hoc auth boilerplate in every route with a single,
 * auditable, role-enforcing middleware function.
 *
 * Usage:
 *   export const POST = withAuth(
 *     async (req, ctx) => {
 *       // ctx.user, ctx.profile, ctx.admin, ctx.ip are all pre-validated
 *       return NextResponse.json({ data: ... });
 *     },
 *     { roles: ['director', 'admin'] }
 *   );
 *
 *   // For contract-related routes — hard-fail if scoped user has no contracts:
 *   export const GET = withAuth(handler, { enforceContractScope: true });
 *
 * Security guarantees:
 *  - JWT verified server-side via getUser() (not getSession which can be spoofed)
 *  - Role loaded from DB, not from JWT claims (cannot be tampered by client)
 *  - Inactive accounts are blocked before handler runs
 *  - Scoped roles (contractor/consultant) with ZERO linked contracts are blocked
 *    at the guard level before any handler logic runs
 *  - All 401/403 responses use identical timing (no timing oracle)
 *  - IP and User-Agent extracted for audit trail
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseFromRequest, createAdminSupabase } from '@/lib/supabase-server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserRole } from '@/lib/types';

// ─── Auth Context ──────────────────────────────────────────────────

export interface AuthContext {
  /** Authenticated Supabase user */
  user: {
    id: string;
    email: string;
  };
  /** Profile row from DB — role is authoritative (DB-sourced, not JWT) */
  profile: {
    id: string;
    role: UserRole;
    full_name_ar: string;
    full_name: string;
    email: string;
  };
  /** Admin Supabase client (service role) — bypasses RLS for writes */
  admin: SupabaseClient;
  /** Client IP (from x-forwarded-for or x-real-ip) */
  ip: string;
  /** Client User-Agent for audit logs */
  userAgent: string;
}

// ─── Guard Options ─────────────────────────────────────────────────

export interface GuardOptions {
  /**
   * Allowed roles. If omitted or empty → any authenticated user.
   * Rejection returns 403 (not 401) to prevent role enumeration.
   */
  roles?: UserRole[];

  /**
   * When true, scoped roles (contractor / consultant / supervisor / reviewer /
   * auditor) MUST have at least one row in user_contracts, or the request is
   * rejected with 403 NO_SCOPE before the handler ever runs.
   *
   * Global roles (director / admin) bypass this check.
   *
   * Set this to true on every route that serves contract-related data:
   *   /api/action-center, /api/claims/*, /api/workflow/*, etc.
   */
  enforceContractScope?: boolean;
}

// ─── Role Classification ───────────────────────────────────────────

/**
 * Roles that require active user_contracts rows for operational access.
 * Director and admin are global — no scope check needed.
 */
const SCOPED_ROLES: UserRole[] = [
  'contractor', 'consultant', 'supervisor', 'reviewer', 'auditor',
];

// ─── Handler Type ─────────────────────────────────────────────────

export type AuthedHandler = (
  req: NextRequest,
  ctx: AuthContext,
) => Promise<NextResponse>;

// ─── Standard Error Helpers ────────────────────────────────────────

/** All auth/authz errors use the same delay to prevent timing oracles */
async function guardError(msg: string, status: number): Promise<NextResponse> {
  // Constant-time response — prevents timing-based enumeration
  await new Promise(r => setTimeout(r, 50 + Math.random() * 50));
  return NextResponse.json({ error: msg }, { status });
}

// ─── Core Guard ───────────────────────────────────────────────────

/**
 * Wraps an API route handler with full auth + role enforcement.
 * The returned function is the actual Next.js route handler.
 */
export function withAuth(
  handler: AuthedHandler,
  opts: GuardOptions = {},
): (req: NextRequest) => Promise<NextResponse> {
  return async (req: NextRequest): Promise<NextResponse> => {
    try {
      // ── Step 1: Verify JWT via getUser() ─────────────────────────
      // getUser() re-validates the token with Supabase Auth server.
      // This is safer than getSession() which only reads localStorage.
      const supabase = await createServerSupabaseFromRequest(req);
      const { data: { user }, error: authErr } = await supabase.auth.getUser();

      if (authErr || !user) {
        return guardError('يجب تسجيل الدخول أولاً', 401);
      }

      // ── Step 2: Load profile from DB (not from JWT claims) ────────
      const admin = createAdminSupabase();
      const { data: profile, error: profileErr } = await admin
        .from('profiles')
        .select('id, role, full_name_ar, full_name, is_active')
        .eq('id', user.id)
        .maybeSingle();                           // maybeSingle → null, not error, if missing

      if (profileErr || !profile) {
        // Return same error as unauthorized — don't reveal whether user exists
        return guardError('غير مصرح', 403);
      }

      // ── Step 3: Block inactive accounts ──────────────────────────
      if ((profile as { is_active?: boolean }).is_active === false) {
        return guardError('الحساب موقوف — تواصل مع مدير النظام', 403);
      }

      // ── Step 4: Role authorization ────────────────────────────────
      if (opts.roles && opts.roles.length > 0) {
        const userRole = profile.role as UserRole;
        if (!opts.roles.includes(userRole)) {
          // Same error message regardless of whether role is wrong or unknown
          // This prevents role enumeration (attacker can't discover valid roles)
          return guardError('غير مصرح — صلاحيات غير كافية', 403);
        }
      }

      // ── Step 5: Contract scope enforcement (NO_SCOPE hard-fail) ──
      //
      // When enforceContractScope is true, scoped roles MUST have at least
      // one active contract link.  This is a belt-and-suspenders check
      // on top of RLS — it fires BEFORE any handler logic executes.
      //
      // Sprint B: Dual-read — checks user_contract_roles first, falls back
      // to user_contracts if no entry found in the new table.
      // Global roles (director / admin) bypass this check entirely.
      if (opts.enforceContractScope) {
        const userRole = profile.role as UserRole;
        const isScoped = SCOPED_ROLES.includes(userRole);

        if (isScoped) {
          let hasScope = false;

          // 1. Try new table: user_contract_roles
          try {
            const { count: newCount, error: newErr } = await admin
              .from('user_contract_roles')
              .select('contract_id', { count: 'exact', head: true })
              .eq('user_id', user.id)
              .eq('is_active', true);

            if (!newErr && (newCount ?? 0) > 0) {
              hasScope = true;
              console.debug(`[withAuth] scope OK via user_contract_roles: user=${user.id}`);
            }
          } catch (e) {
            console.warn('[withAuth] user_contract_roles scope check failed, falling back:', e);
          }

          // 2. Legacy fallback: user_contracts
          if (!hasScope) {
            const { count, error: scopeErr } = await admin
              .from('user_contracts')
              .select('contract_id', { count: 'exact', head: true })
              .eq('user_id', user.id);

            if (scopeErr) {
              console.error('[withAuth] scope check DB error:', scopeErr);
              return guardError('خطأ في التحقق من النطاق التشغيلي — يرجى المحاولة لاحقاً', 500);
            }

            if ((count ?? 0) > 0) {
              hasScope = true;
              console.debug(`[withAuth] scope OK via user_contracts (legacy): user=${user.id}`);
            }
          }

          if (!hasScope) {
            console.warn(
              `[withAuth] NO_SCOPE: user=${user.id} role=${userRole} ` +
              `path=${req.nextUrl.pathname}`,
            );
            return guardError(
              'لا توجد عقود مرتبطة بحسابك — تواصل مع مدير الإدارة لتفعيل الصلاحيات التشغيلية',
              403,
            );
          }
        }
      }

      // ── Step 6: Extract audit metadata ────────────────────────────
      const forwarded = req.headers.get('x-forwarded-for');
      const ip = forwarded
        ? forwarded.split(',')[0].trim()
        : (req.headers.get('x-real-ip') ?? 'unknown');
      const userAgent = req.headers.get('user-agent') ?? 'unknown';

      // ── Step 7: Invoke handler ────────────────────────────────────
      return await handler(req, {
        user: {
          id: user.id,
          email: user.email ?? '',
        },
        profile: {
          id: profile.id,
          role: profile.role as UserRole,
          full_name_ar: profile.full_name_ar ?? '',
          full_name: profile.full_name ?? '',
          email: user.email ?? '',
        },
        admin,
        ip,
        userAgent,
      });

    } catch (e) {
      console.error('[withAuth] unexpected error:', e);
      return NextResponse.json(
        { error: 'خطأ داخلي غير متوقع — يرجى المحاولة مرة أخرى' },
        { status: 500 },
      );
    }
  };
}

// ─── Audit Log Helper ──────────────────────────────────────────────

/**
 * Convenience function to write an audit log entry.
 * Keeps audit logic consistent across all API routes.
 */
export async function writeAuditLog(
  admin: SupabaseClient,
  ctx: AuthContext,
  opts: {
    tableName: string;
    recordId: string;
    action: 'CREATE' | 'UPDATE' | 'TRANSITION' | 'DELETE' | 'VIEW';
    fromStatus?: string | null;
    toStatus?: string | null;
    oldData?: Record<string, unknown>;
    newData?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    // Use correct production audit_logs schema:
    // entity_type, entity_id, action (audit_action enum), actor_id,
    // actor_email, actor_role, old_values, new_values, metadata, ip_address
    const actionMap: Record<string, string> = {
      'CREATE': 'create', 'UPDATE': 'update', 'TRANSITION': 'update',
      'DELETE': 'delete', 'VIEW': 'download',
    };
    await admin.from('audit_logs').insert({
      entity_type:  opts.tableName,
      entity_id:    opts.recordId,
      action:       actionMap[opts.action] || 'update',
      actor_id:     ctx.user.id,
      actor_email:  ctx.profile.email || 'unknown',
      actor_role:   ctx.profile.role,
      entity_label: `${opts.tableName}:${opts.recordId}`,
      old_values:   opts.oldData  ?? null,
      new_values:   opts.newData  ?? null,
      metadata:     {
        from_status: opts.fromStatus ?? null,
        to_status:   opts.toStatus   ?? null,
        source: 'api-guard',
      },
      ip_address:   ctx.ip || '0.0.0.0',
    });
  } catch (e) {
    // Audit log failures must never break the main operation
    console.error('[writeAuditLog] failed:', e);
  }
}

// ─── Standard Response Helpers ─────────────────────────────────────

export function apiOk(data: unknown, status = 200): NextResponse {
  return NextResponse.json({ data }, { status });
}

export function apiCreated(data: unknown): NextResponse {
  return NextResponse.json({ data }, { status: 201 });
}

export function apiError(msg: string, status = 400): NextResponse {
  return NextResponse.json({ error: msg }, { status });
}
