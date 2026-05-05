/**
 * CONVERA — Admin Users API
 * Route: /api/admin/users
 *
 * GET  — list all profiles (director only)
 * POST — create new auth user + profile (director only)
 *
 * Auth check: session is validated server-side; caller must be a director.
 * Admin operations use createAdminSupabase() (service role — bypasses RLS).
 * Audit: every mutation is logged to audit_logs.
 *
 * REQUIREMENT: SUPABASE_SERVICE_ROLE_KEY must be set in .env.local
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseFromRequest, createAdminSupabase } from '@/lib/supabase-server';
import type { UserRole } from '@/lib/types';

// ── Auth guard ────────────────────────────────────────────────────

async function requireDirector(request: NextRequest) {
  const supabase = await createServerSupabaseFromRequest(request);
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, role, full_name_ar, full_name')
    .eq('id', user.id)
    .single();

  if (!profile || profile.role !== 'director') return null;
  return profile as {
    id: string; email: string; role: string;
    full_name_ar: string | null; full_name: string;
  };
}

// ── Role mapping (DB ↔ frontend) ──────────────────────────────────
//
// The DB user_role enum may use legacy names ('admin', 'consultant')
// from the initial migrations, while the frontend uses the 5-stage
// workflow names ('auditor', 'supervisor'). AuthProvider already maps
// DB → frontend at read time. These helpers keep the API layer consistent
// with whatever schema version is running on the Supabase instance.

/** Map a frontend role name to the DB enum value that will be stored */
function roleToDb(role: string): string {
  const map: Record<string, string> = {
    auditor:    'admin',       // 5-stage name → legacy DB enum
    supervisor: 'consultant',  // 5-stage name → legacy DB enum
    // New schema (010+) has these directly — pass-through:
    director:   'director',
    reviewer:   'reviewer',
    contractor: 'contractor',
    // Legacy names also pass through (idempotent):
    admin:      'admin',
    consultant: 'consultant',
  };
  return map[role] ?? role;
}

/** Map a DB role value to the canonical frontend role name */
function roleFromDb(dbRole: string): string {
  const map: Record<string, string> = {
    admin:      'auditor',     // legacy DB → 5-stage name
    consultant: 'supervisor',  // legacy DB → 5-stage name
    director:   'director',
    reviewer:   'reviewer',
    contractor: 'contractor',
    // New schema names pass through:
    auditor:    'auditor',
    supervisor: 'supervisor',
  };
  return map[dbRole] ?? dbRole;
}

// ── Helpers ────────────────────────────────────────────────────────

/**
 * IAM-3 (2026-05-05) — canonical ContractRole whitelist.
 *
 * Mirrors the ContractRole union in lib/types.ts. The admin routes
 * validate every incoming `contract_role` value against this list
 * BEFORE forwarding to the upsert, so a malformed or out-of-spec
 * value returns 400 with a clear Arabic message instead of a Postgres
 * enum error that the previous version silently swallowed.
 */
const VALID_CONTRACT_ROLES = [
  'contractor', 'supervisor', 'auditor', 'reviewer',
  'viewer',     'project_manager', 'quality', 'final_approver',
] as const;

/**
 * Validate a contract_roles payload array. Returns null on success or
 * an Arabic error message on the first invalid entry. Used by both
 * POST (create) and PATCH (update) to keep validation consistent.
 */
function validateContractRolesPayload(
  rows: Array<{ contract_id?: string; contract_role?: string }> | undefined,
): string | null {
  if (!rows || rows.length === 0) return null;
  for (const row of rows) {
    if (!row.contract_id || typeof row.contract_id !== 'string') {
      return 'تعذّر تعيين الأدوار: قيمة contract_id مفقودة أو غير صالحة';
    }
    if (!row.contract_role || typeof row.contract_role !== 'string') {
      return 'تعذّر تعيين الأدوار: قيمة contract_role مفقودة';
    }
    if (!(VALID_CONTRACT_ROLES as readonly string[]).includes(row.contract_role)) {
      return `تعذّر تعيين الأدوار: قيمة contract_role غير معروفة: ${row.contract_role}`;
    }
  }
  return null;
}

/** Generate a cryptographically safe temporary password */
function genTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#$!';
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => chars[b % chars.length]).join('');
}

/** Write one audit_logs row (fire-and-forget — errors are swallowed) */
async function writeAudit(params: {
  actorId: string;
  actorEmail: string;
  actorRole: string;
  action: 'create' | 'update';
  entityId: string;
  entityLabel: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
}) {
  try {
    const admin = createAdminSupabase();
    await admin.from('audit_logs').insert({
      actor_id:     params.actorId,
      actor_email:  params.actorEmail,
      actor_role:   params.actorRole,
      action:       params.action,
      entity_type:  'user',
      entity_id:    params.entityId,
      entity_label: params.entityLabel,
      old_values:   params.oldValues ?? null,
      new_values:   params.newValues ?? null,
    });
  } catch {
    // Audit failure must never break the main operation
  }
}

// ── GET /api/admin/users ──────────────────────────────────────────

export async function GET(_req: NextRequest) {
  const actor = await requireDirector(_req);
  if (!actor) {
    return NextResponse.json({ error: 'غير مصرح — مدير الإدارة فقط' }, { status: 403 });
  }

  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from('profiles')
    .select('id, email, full_name, full_name_ar, role, phone, organization, is_active, created_at, updated_at')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Normalize DB role names to frontend canonical names before returning
  const normalizedUsers = (data ?? []).map((u: Record<string, unknown>) => ({
    ...u,
    role: roleFromDb(u.role as string),
  }));

  return NextResponse.json({ users: normalizedUsers });
}

// ── POST /api/admin/users — create new user ───────────────────────

interface ContractRoleInput {
  contract_id:   string;
  contract_role: string;  // 'contractor' | 'supervisor' | 'auditor' | 'reviewer' | 'viewer'
}

interface CreateUserBody {
  email:               string;
  full_name:           string;
  full_name_ar:        string;
  role:                UserRole;
  phone?:              string;
  organization?:       string;
  /** Legacy: contract IDs to link via user_contracts table */
  linked_contract_ids?: string[];
  /** New: per-contract role assignments via user_contract_roles table */
  contract_roles?:      ContractRoleInput[];
}

export async function POST(req: NextRequest) {
  const actor = await requireDirector(req);
  if (!actor) {
    return NextResponse.json({ error: 'غير مصرح — مدير الإدارة فقط' }, { status: 403 });
  }

  let body: CreateUserBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 });
  }

  const { email, full_name, full_name_ar, role, phone, organization, linked_contract_ids, contract_roles } = body;

  // Validate required fields
  const missing = ['email', 'full_name', 'full_name_ar', 'role'].filter(f => !body[f as keyof CreateUserBody]);
  if (missing.length) {
    return NextResponse.json({ error: `حقول مطلوبة: ${missing.join(', ')}` }, { status: 400 });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const tempPassword    = genTempPassword();
  const admin           = createAdminSupabase();
  const dbRole          = roleToDb(role);  // translate auditor→admin, supervisor→consultant

  // 1. Create auth.users row
  const { data: authData, error: authErr } = await admin.auth.admin.createUser({
    email:            normalizedEmail,
    password:         tempPassword,
    email_confirm:    true,   // mark confirmed so user can log in after reset
    user_metadata:    { full_name, full_name_ar, role: dbRole },
  });

  if (authErr || !authData.user) {
    const msg = authErr?.message || 'فشل إنشاء حساب المستخدم';
    return NextResponse.json({ error: msg }, { status: 422 });
  }

  const newUserId = authData.user.id;

  // 2. Upsert profile (trigger may have created a stub — override it)
  const { error: profileErr } = await admin
    .from('profiles')
    .upsert({
      id:           newUserId,
      email:        normalizedEmail,
      full_name:    full_name.trim(),
      full_name_ar: full_name_ar.trim(),
      role:         dbRole,  // use DB-compatible enum value
      phone:        phone?.trim() || null,
      organization: organization?.trim() || null,
      is_active:    true,
    }, { onConflict: 'id' });

  if (profileErr) {
    // Auth user was created but profile failed — attempt cleanup
    await admin.auth.admin.deleteUser(newUserId);
    return NextResponse.json({ error: `فشل إنشاء الملف الشخصي: ${profileErr.message}` }, { status: 500 });
  }

  // 3. Insert linked contracts if provided (admin client — bypasses RLS)
  if (linked_contract_ids && linked_contract_ids.length > 0) {
    const rows = linked_contract_ids.map((contract_id: string) => ({ user_id: newUserId, contract_id }));
    await admin
      .from('user_contracts')
      .insert(rows)
      .then(({ error }) => {
        // Table may not exist yet — ignore gracefully
        if (error && error.code !== '42P01' && error.code !== '23505') {
          console.error('[user-contracts] POST insert error:', error);
        }
      });
  }

  // 3b. Insert contract_roles if provided (user_contract_roles table — migration 025+)
  // IAM-3 (2026-05-05) — fixes:
  //   (a) Validate every contract_role against the canonical whitelist
  //       BEFORE issuing the upsert. Previously bad values reached the
  //       DB and Postgres returned a constraint violation that was
  //       silently swallowed (see logs/IAM_RBAC_STABILIZATION_AUDIT.md §5.3).
  //   (b) onConflict target is now the 3-tuple
  //       (user_id, contract_id, contract_role) — matches the unique
  //       index added by Migration 045. The previous 2-tuple target
  //       triggered Postgres 42P10 ('no unique or exclusion constraint
  //       matching the ON CONFLICT specification') which the previous
  //       .then(({error}) => console.error(...)) path silently swallowed,
  //       dropping every contract role at creation time.
  //   (c) Errors are now returned to the caller as 422 instead of being
  //       logged-and-forgotten, so the modal (post IAM-2) can show a
  //       clear Arabic toast and the operator can correct the data.
  if (contract_roles && contract_roles.length > 0) {
    const validationErr = validateContractRolesPayload(contract_roles);
    if (validationErr) {
      // The auth user + profile have already been created by this point;
      // returning here leaves the user in a half-provisioned state. Roll
      // back the auth user to keep the failure atomic from the caller's
      // perspective. Profile rows cascade-delete from auth.users.
      await admin.auth.admin.deleteUser(newUserId);
      return NextResponse.json({ error: validationErr }, { status: 400 });
    }

    const crRows = contract_roles.map((cr: ContractRoleInput) => ({
      user_id:       newUserId,
      contract_id:   cr.contract_id,
      contract_role: cr.contract_role,
      is_active:     true,
      assigned_by:   actor.id,
      notes:         `تعيين أولي عند إنشاء المستخدم`,
    }));
    const { error: crErr } = await admin
      .from('user_contract_roles')
      .upsert(crRows, { onConflict: 'user_id,contract_id,contract_role' });

    if (crErr && crErr.code !== '42P01' && crErr.code !== '23505') {
      console.error('[user_contract_roles] POST insert error:', crErr);
      // Roll back the auth user to keep the operation atomic from the
      // caller's perspective. Without this rollback the modal would
      // succeed-then-fail and leave a user with no roles in the DB.
      await admin.auth.admin.deleteUser(newUserId);
      return NextResponse.json(
        { error: `فشل تعيين أدوار العقود للمستخدم: ${crErr.message}` },
        { status: 422 },
      );
    }
  }

  // 4. Send password reset email so user sets their own password
  await admin.auth.admin.generateLink({
    type:  'recovery',
    email: normalizedEmail,
  });

  // 5. Audit log — creation event
  await writeAudit({
    actorId:    actor.id,
    actorEmail: actor.email,
    actorRole:  actor.role,
    action:     'create',
    entityId:   newUserId,
    entityLabel: `مستخدم جديد: ${full_name_ar} (${normalizedEmail})`,
    newValues:  { email: normalizedEmail, full_name, full_name_ar, role, organization },
  });

  return NextResponse.json({
    user: { id: newUserId, email: normalizedEmail, full_name, full_name_ar, role },
    message: 'تم إنشاء المستخدم — سيصله بريد لتعيين كلمة المرور',
  }, { status: 201 });
}
