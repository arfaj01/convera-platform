/**
 * CONVERA — Admin Users API (single user)
 * Route: /api/admin/users/[id]
 *
 * PATCH — update profile fields: full_name, full_name_ar, role,
 *         phone, organization, is_active
 *         AND sync linked contracts in user_contracts table.
 *
 * Director only. All changes are audit-logged.
 * user_contracts sync uses admin client (service role) to bypass RLS.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseFromRequest, createAdminSupabase } from '@/lib/supabase-server';
import type { UserRole } from '@/lib/types';

// Frontend role names accepted by this endpoint (5-stage workflow names)
const VALID_ROLES: UserRole[] = ['director', 'reviewer', 'auditor', 'supervisor', 'contractor'];

// ── Role mapping (DB ↔ frontend) ─────────────────────────────────
// The DB user_role enum may use legacy names ('admin', 'consultant').
// Map frontend → DB for writes; DB → frontend for reads.

function roleToDb(role: string): string {
  const map: Record<string, string> = {
    auditor: 'admin', supervisor: 'consultant',
    director: 'director', reviewer: 'reviewer', contractor: 'contractor',
    admin: 'admin', consultant: 'consultant',
  };
  return map[role] ?? role;
}

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

async function writeAudit(params: {
  actorId:    string;
  actorEmail: string;
  actorRole:  string;
  action:     'update';
  entityId:   string;
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
  } catch { /* audit failure must not break main op */ }
}

// ── PATCH /api/admin/users/[id] ───────────────────────────────────

interface ContractRoleInput {
  contract_id:   string;
  contract_role: string;
}

interface UpdateUserBody {
  full_name?:           string;
  full_name_ar?:        string;
  role?:                UserRole;
  phone?:               string | null;
  organization?:        string | null;
  is_active?:           boolean;
  /** Legacy: when present (including empty array), fully replaces the user's linked contracts. */
  linked_contract_ids?: string[];
  /** New: when present, fully replaces contract-role assignments in user_contract_roles. */
  contract_roles?:      ContractRoleInput[];
}

// ── Sync user_contracts (admin client bypasses RLS) ───────────────

/**
 * Replace ALL linked contracts for a user.
 * Uses service-role admin client so RLS never blocks the director from
 * deleting/inserting rows owned by OTHER users.
 * An empty array means "remove all contracts" — this is intentional.
 */
async function syncLinkedContracts(
  userId: string,
  contractIds: string[]
): Promise<void> {
  const admin = createAdminSupabase();

  // 1. Delete all existing links for this user
  const { error: deleteErr } = await admin
    .from('user_contracts')
    .delete()
    .eq('user_id', userId);

  if (deleteErr) {
    // If the table doesn't exist yet (migration not applied) ignore gracefully
    if (deleteErr.code === '42P01') return;
    throw deleteErr;
  }

  // 2. Insert new links (skip if empty — "remove all" is done by delete above)
  if (contractIds.length === 0) return;

  const rows = contractIds.map(contract_id => ({ user_id: userId, contract_id }));
  const { error: insertErr } = await admin.from('user_contracts').insert(rows);

  // Ignore duplicate key violations (idempotent safety)
  if (insertErr && insertErr.code !== '23505') throw insertErr;
}

// ── Sync user_contract_roles (migration 025+ table) ──────────────

/**
 * Replace ALL contract-role assignments for a user.
 * Uses service-role admin client to bypass RLS.
 * An empty array means "remove all assignments".
 */
async function syncContractRoles(
  userId: string,
  contractRoles: ContractRoleInput[],
  assignedBy: string,
): Promise<void> {
  const admin = createAdminSupabase();

  // 1. Soft-delete existing active assignments (set is_active = false)
  const { error: deactivateErr } = await admin
    .from('user_contract_roles')
    .update({ is_active: false })
    .eq('user_id', userId)
    .eq('is_active', true);

  if (deactivateErr) {
    if (deactivateErr.code === '42P01') return; // table doesn't exist
    throw deactivateErr;
  }

  if (contractRoles.length === 0) return;

  // 2. Upsert new assignments
  const rows = contractRoles.map(cr => ({
    user_id:       userId,
    contract_id:   cr.contract_id,
    contract_role: cr.contract_role,
    is_active:     true,
    assigned_by:   assignedBy,
    notes:         'تحديث من إدارة المستخدمين',
  }));

  const { error: upsertErr } = await admin
    .from('user_contract_roles')
    .upsert(rows, { onConflict: 'user_id,contract_id' });

  if (upsertErr && upsertErr.code !== '23505') throw upsertErr;
}

// ── PATCH /api/admin/users/[id] ───────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const actor = await requireDirector(req);
  if (!actor) {
    return NextResponse.json({ error: 'غير مصرح — مدير الإدارة فقط' }, { status: 403 });
  }

  const { id: targetId } = await params;
  if (!targetId) {
    return NextResponse.json({ error: 'معرّف المستخدم مطلوب' }, { status: 400 });
  }

  let body: UpdateUserBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 });
  }

  // Validate role if provided
  if (body.role && !VALID_ROLES.includes(body.role)) {
    return NextResponse.json({ error: `دور غير صالح: ${body.role}` }, { status: 400 });
  }

  const admin = createAdminSupabase();

  // Fetch current state for audit diff
  const { data: currentProfile, error: fetchErr } = await admin
    .from('profiles')
    .select('id, email, full_name, full_name_ar, role, phone, organization, is_active')
    .eq('id', targetId)
    .single();

  if (fetchErr || !currentProfile) {
    return NextResponse.json({ error: 'المستخدم غير موجود' }, { status: 404 });
  }

  // Build update payload (only provided fields)
  const updates: Record<string, unknown> = {};
  if (body.full_name    !== undefined) updates.full_name    = body.full_name.trim();
  if (body.full_name_ar !== undefined) updates.full_name_ar = body.full_name_ar.trim();
  if (body.role         !== undefined) updates.role         = roleToDb(body.role); // map to DB enum
  if (body.phone        !== undefined) updates.phone        = body.phone?.trim() || null;
  if (body.organization !== undefined) updates.organization = body.organization?.trim() || null;
  if (body.is_active    !== undefined) updates.is_active    = body.is_active;
  updates.updated_at = new Date().toISOString();

  const hasProfileChanges = Object.keys(updates).length > 1; // more than just updated_at
  const hasContractChanges = body.linked_contract_ids !== undefined;

  if (!hasProfileChanges && !hasContractChanges) {
    return NextResponse.json({ error: 'لا توجد تغييرات للحفظ' }, { status: 400 });
  }

  if (hasProfileChanges) {
    const { error: updateErr } = await admin
      .from('profiles')
      .update(updates)
      .eq('id', targetId);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    // ── Sync Supabase Auth ban_duration when is_active changes ────
    // Supabase Auth (GoTrue) is independent from the profiles table.
    // Setting is_active = false in profiles does NOT block the user
    // from authenticating via GoTrue. We must also update the Auth
    // user's ban_duration so that GoTrue itself refuses the login.
    //
    // ban_duration = '87600h' (10 years) → user is effectively banned
    // ban_duration = 'none'               → user is unbanned
    if (body.is_active !== undefined) {
      const banDuration = body.is_active ? 'none' : '87600h';
      const { error: banErr } = await admin.auth.admin.updateUserById(
        targetId,
        { ban_duration: banDuration },
      );
      if (banErr) {
        // Log but don't fail the whole update — profile is already saved.
        // The withAuth guard provides a second layer of protection.
        console.error(
          `[user-suspend] failed to ${body.is_active ? 'unban' : 'ban'} ` +
          `user ${targetId} in Supabase Auth:`, banErr,
        );
      } else {
        console.info(
          `[user-suspend] ${body.is_active ? 'unbanned' : 'banned'} ` +
          `user ${targetId} in Supabase Auth (ban_duration=${banDuration})`,
        );
      }
    }
  }

  // ── Sync linked contracts (when field is explicitly provided) ────
  if (body.linked_contract_ids !== undefined) {
    try {
      await syncLinkedContracts(targetId, body.linked_contract_ids);
    } catch (syncErr) {
      // Non-fatal: log but don't fail the whole update
      console.error('[user-contracts] sync error:', syncErr);
    }
  }

  // ── Sync contract_roles (user_contract_roles table — migration 025+) ────
  if (body.contract_roles !== undefined) {
    try {
      await syncContractRoles(targetId, body.contract_roles, actor.id);
    } catch (syncErr) {
      console.error('[user_contract_roles] sync error:', syncErr);
    }
  }

  // Compose audit label
  const changedFields: string[] = [];
  if ('role'      in body) changedFields.push(`الدور: ${currentProfile.role} → ${body.role}`);
  if ('is_active' in body) changedFields.push(body.is_active ? 'تفعيل المستخدم' : 'تعطيل المستخدم');
  if ('full_name_ar' in body) changedFields.push('تعديل الاسم');
  if ('linked_contract_ids' in body) {
    const cnt = (body.linked_contract_ids ?? []).length;
    changedFields.push(cnt === 0 ? 'إزالة جميع العقود المرتبطة' : `ربط ${cnt} عقد`);
  }
  if ('contract_roles' in body) {
    const cnt = (body.contract_roles ?? []).length;
    changedFields.push(cnt === 0 ? 'إزالة جميع أدوار العقود' : `تعيين ${cnt} دور عقدي`);
  }

  await writeAudit({
    actorId:    actor.id,
    actorEmail: actor.email,
    actorRole:  actor.role,
    action:     'update',
    entityId:   targetId,
    entityLabel: `تعديل مستخدم: ${currentProfile.full_name_ar || currentProfile.full_name} — ${changedFields.join('، ')}`,
    oldValues:  {
      role:      currentProfile.role,
      is_active: currentProfile.is_active,
      full_name: currentProfile.full_name,
      full_name_ar: currentProfile.full_name_ar,
    },
    newValues: {
      ...updates,
      ...(body.linked_contract_ids !== undefined
        ? { linked_contract_ids: body.linked_contract_ids }
        : {}),
    },
  });

  return NextResponse.json({ success: true, message: 'تم تحديث المستخدم' });
}
