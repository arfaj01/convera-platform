/**
 * GET /api/action-center
 *
 * Returns role-scoped, prioritised action items for the Action Center page.
 *
 * Role-aware:
 *   - director / admin / reviewer / auditor → all contracts
 *   - consultant / supervisor → linked contracts only
 *   - contractor → linked contracts, relevant claim statuses only
 *
 * Auth: any authenticated user.
 */

import { NextRequest } from 'next/server';
import { withAuth, apiOk, apiError } from '@/lib/api-guard';
import { loadActionCenter } from '@/lib/action-center-service';

export const GET = withAuth(
  async (_req: NextRequest, ctx) => {
    try {
      const result = await loadActionCenter(
        ctx.admin,
        ctx.user.id,
        ctx.profile.role,
      );
      return apiOk(result);
    } catch (e) {
      console.error('[GET /api/action-center]', e);
      return apiError('فشل تحميل بيانات مركز الإجراءات', 500);
    }
  },
  // Scoped roles (contractor/consultant) must have active contract links.
  // Global roles (director/admin) are exempt from this check.
  { enforceContractScope: true },
);
