/**
 * PATCH /api/notifications/[id]  — Mark a single notification as read
 * DELETE /api/notifications/[id] — Delete a notification (own only)
 */

import { NextRequest } from 'next/server';
import { withAuth, apiOk, apiError } from '@/lib/api-guard';

// ─── PATCH: mark as read ─────────────────────────────────────────

export const PATCH = withAuth(async (req: NextRequest, ctx) => {
  const id = req.nextUrl.pathname.split('/').pop();
  if (!id) return apiError('معرف الإشعار مطلوب');

  const { admin, user } = ctx;

  // Ensure ownership (RLS-level safety net)
  const { data: existing } = await admin
    .from('notifications')
    .select('id, user_id')
    .eq('id', id)
    .maybeSingle();

  if (!existing || existing.user_id !== user.id) {
    return apiError('الإشعار غير موجود', 404);
  }

  const { error } = await admin
    .from('notifications')
    .update({ is_read: true })
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) {
    console.error('[PATCH /api/notifications/[id]]', error);
    return apiError('فشل تحديث الإشعار', 500);
  }

  return apiOk({ id, is_read: true });
});

// ─── POST /read-all (alternative path, same logic) ────────────────

export const DELETE = withAuth(async (req: NextRequest, ctx) => {
  const id = req.nextUrl.pathname.split('/').pop();
  if (!id) return apiError('معرف الإشعار مطلوب');

  const { admin, user } = ctx;

  const { error } = await admin
    .from('notifications')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id); // ownership enforced

  if (error) {
    console.error('[DELETE /api/notifications/[id]]', error);
    return apiError('فشل حذف الإشعار', 500);
  }

  return apiOk({ deleted: true });
});
