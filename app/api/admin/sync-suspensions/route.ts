/**
 * POST /api/admin/sync-suspensions
 *
 * ONE-TIME UTILITY — Run once after deploying the is_active enforcement fix.
 *
 * Problem: Before the fix, setting profiles.is_active = false did NOT ban
 * the user in Supabase Auth (GoTrue). Users marked as suspended could still
 * sign in because GoTrue is independent from the profiles table.
 *
 * This endpoint reads ALL profiles where is_active = false and applies
 * ban_duration = '87600h' (10 years) to each one via the Supabase Admin API.
 *
 * It also ensures all active users (is_active = true) have ban_duration = 'none'
 * to undo any accidental bans.
 *
 * Director only. Idempotent — safe to run multiple times.
 *
 * Usage:
 *   POST /api/admin/sync-suspensions
 *   Authorization: Bearer <director_jwt>
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseFromRequest, createAdminSupabase } from '@/lib/supabase-server';

async function requireDirector(request: NextRequest) {
  const supabase = await createServerSupabaseFromRequest(request);
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;

  const admin = createAdminSupabase();
  const { data: profile } = await admin
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile || profile.role !== 'director') return null;
  return profile;
}

export async function POST(req: NextRequest) {
  const director = await requireDirector(req);
  if (!director) {
    return NextResponse.json({ error: 'غير مصرح — مدير الإدارة فقط' }, { status: 403 });
  }

  const admin = createAdminSupabase();

  // Fetch all profiles with their active status
  const { data: profiles, error: fetchErr } = await admin
    .from('profiles')
    .select('id, email, full_name_ar, is_active');

  if (fetchErr || !profiles) {
    return NextResponse.json({ error: 'فشل جلب قائمة المستخدمين' }, { status: 500 });
  }

  const results: Array<{
    id: string;
    email: string;
    is_active: boolean;
    action: string;
    success: boolean;
    error?: string;
  }> = [];

  for (const profile of profiles) {
    // Skip the director making this request (never ban yourself)
    if (profile.id === director.id) continue;

    const banDuration = profile.is_active ? 'none' : '87600h';
    const action      = profile.is_active ? 'unban' : 'ban';

    const { error: banErr } = await admin.auth.admin.updateUserById(
      profile.id,
      { ban_duration: banDuration },
    );

    results.push({
      id:        profile.id,
      email:     profile.email ?? '(no email)',
      is_active: profile.is_active,
      action,
      success:   !banErr,
      error:     banErr?.message,
    });

    if (banErr) {
      console.error(
        `[sync-suspensions] Failed to ${action} user ${profile.id}:`, banErr,
      );
    }
  }

  const banned   = results.filter(r => r.action === 'ban'   && r.success).length;
  const unbanned = results.filter(r => r.action === 'unban' && r.success).length;
  const failed   = results.filter(r => !r.success).length;

  console.info(
    `[sync-suspensions] Complete — banned: ${banned}, unbanned: ${unbanned}, failed: ${failed}`,
  );

  return NextResponse.json({
    message: `تمت المزامنة: تم إيقاف ${banned} مستخدم، تفعيل ${unbanned} مستخدم، فشل ${failed}`,
    summary: { banned, unbanned, failed },
    results,
  });
}
