/**
 * POST /api/notifications/read-all — Mark all notifications as read for current user
 */

import { NextRequest } from 'next/server';
import { withAuth, apiOk, apiError } from '@/lib/api-guard';

export const POST = withAuth(async (_req: NextRequest, ctx) => {
  const { admin, user } = ctx;

  const { error } = await admin
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', user.id)
    .eq('is_read', false);

  if (error) {
    console.error('[POST /api/notifications/read-all]', error);
    return apiError('فشل تحديث الإشعارات', 500);
  }

  return apiOk({ marked_read: true });
});
