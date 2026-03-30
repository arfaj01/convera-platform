/**
 * CONVERA — Admin User Contract Roles API
 * Route: /api/admin/users/[id]/contract-roles
 *
 * GET — fetch a user's contract-role assignments from user_contract_roles table.
 * Director only. Uses admin client (service role) to bypass RLS.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseFromRequest, createAdminSupabase } from '@/lib/supabase-server';

async function requireDirector(request: NextRequest) {
  const supabase = await createServerSupabaseFromRequest(request);
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .single();

  if (!profile || profile.role !== 'director') return null;
  return profile;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const actor = await requireDirector(req);
  if (!actor) {
    return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  }

  const { id: targetId } = await params;
  const admin = createAdminSupabase();

  // Try to fetch from user_contract_roles (migration 025+)
  const { data, error } = await admin
    .from('user_contract_roles')
    .select('contract_id, contract_role, is_active')
    .eq('user_id', targetId)
    .eq('is_active', true);

  if (error) {
    // Table doesn't exist yet — return empty
    if (error.code === '42P01') {
      return NextResponse.json({ contract_roles: [] });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    contract_roles: (data || []).map(r => ({
      contract_id:   r.contract_id,
      contract_role: r.contract_role,
    })),
  });
}
