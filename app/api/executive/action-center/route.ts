/**
 * GET /api/executive/action-center
 * Returns prioritised action items for the executive action center.
 * Director, admin, reviewer only.
 */

import { NextRequest } from 'next/server';
import { withAuth, apiOk, apiError } from 'A/lib/api-guard';
import { loadActionCenter } from '@/lib/action-center-service';

export const GET = withAuth(
  async (_req: NextRequest, ctx) => {
    try {
      const result = await loadActionCenter(ctx.admin, ctx.user.id, ctx.profile.role);
      return apiOk(result);
    } catch (e) {
      console.error('[GET /api/executive/action-center]', e);
      return apiError('فشل تحميل بيانات مركز الإجراءات', 500);
    }
  },
  { roles: ['director', 'admin', 'reviewer'] },
);
