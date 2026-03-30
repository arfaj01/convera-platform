/**
 * CONVERA — Admin Password Reset API
 * Route: /api/admin/users/reset-password
 *
 * POST — triggers a Supabase password-recovery email for any user.
 *        Director only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseFromRequest, createAdminSupabase } from '@/lib/supabase-server';

async function requireDirector(request: NextRequest) {
  const supabase = await createServerSupabaseFromRequest(request);
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, role')
    .eq('id', user.id)
    .single();

  if (!profile || profile.role !== 'director') return null;
  return profile as { id: string; email: string; role: string };
}

export async function POST(req: NextRequest) {
  const actor = await requireDirector(req);
  if (!actor) {
    return NextResponse.json({ error: 'غير مصرح — مدير الإدارة فقط' }, { status: 403 });
  }

  let body: { userId: string; email: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 });
  }

  if (!body.email) {
    return NextResponse.json({ error: 'البريد الإلكتروني مطلوب' }, { status: 400 });
  }

  const admin = createAdminSupabase();

  // Generate a password-reset link using the admin API
  const { error: linkErr } = await admin.auth.admin.generateLink({
    type:  'recovery',
    email: body.email.trim().toLowerCase(),
  });

  if (linkErr) {
    return NextResponse.json({ error: `فشل إرسال رابط إعادة التعيين: ${linkErr.message}` }, { status: 500 });
  }

  // Audit log the reset event
  try {
    await admin.from('audit_logs').insert({
      actor_id:     actor.id,
      actor_email:  actor.email,
      actor_role:   actor.role,
      action:       'update',
      entity_type:  'user',
      entity_id:    body.userId || null,
      entity_label: `إعادة تعيين كلمة المرور: ${body.email}`,
      new_values:   { action: 'password_reset_sent', target_email: body.email },
    });
  } catch { /* ignore audit failure */ }

  return NextResponse.json({
    success: true,
    message: `تم إرسال رابط إعادة تعيين كلمة المرور إلى ${body.email}`,
  });
}
