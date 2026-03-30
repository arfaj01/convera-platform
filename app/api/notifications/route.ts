/**
 * GET  /api/notifications       — Fetch current user's notifications
 * POST /api/notifications       — Create a notification (internal use only)
 *
 * All authenticated roles can access their own notifications.
 * Directors and admins can create notifications for other users.
 */

import { NextRequest } from 'next/server';
import { withAuth, apiOk, apiCreated, apiError } from '@/lib/api-guard';

// ─── GET /api/notifications ───────────────────────────────────────

export const GET = withAuth(async (_req: NextRequest, ctx) => {
  const { admin, user } = ctx;

  const { data, error } = await admin
    .from('notifications')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('[GET /api/notifications]', error);
    return apiError('فشل تحميل الإشعارات', 500);
  }

  const unreadCount = (data ?? []).filter(n => !n.is_read).length;

  return apiOk({ notifications: data ?? [], unread_count: unreadCount });
});

// ─── POST /api/notifications (internal — for workflow events) ─────

export const POST = withAuth(
  async (req: NextRequest, ctx) => {
    const body = await req.json();

    if (!body.user_id || !body.title || !body.type) {
      return apiError('الحقول المطلوبة: user_id, title, type');
    }

    const { data, error } = await ctx.admin
      .from('notifications')
      .insert({
        user_id:     body.user_id,
        type:        body.type,
        title:       body.title,
        body:        body.body ?? null,
        entity_type: body.entity_type ?? null,
        entity_id:   body.entity_id ?? null,
        is_read:     false,
        created_at:  new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      console.error('[POST /api/notifications]', error);
      return apiError('فشل إنشاء الإشعار', 500);
    }

    return apiCreated({ id: data.id });
  },
  { roles: ['director', 'admin', 'reviewer'] },
);
