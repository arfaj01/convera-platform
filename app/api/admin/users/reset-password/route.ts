import { NextRequest } from 'next/server';
import { withAuth, apiOk , apiError } from '@/lib/api-guard';
import { supabaseAdmin } from '@/lib/supabase-admin-client';
import { hasGlobalRole } from '@/lib/permissions';

export const POST = withAuth(
  async (req: NextRequest, ctx) => {
    // Only global roles (admin) can reset passwords
    if (!hasGlobalRole(ctx.profile.role)) {
      return apiError('��حم ضكوادس.الذنويوق الفلانات