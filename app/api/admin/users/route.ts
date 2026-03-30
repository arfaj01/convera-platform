/**
 * CONVERA — Admin Users API
 * Route: /api/admin/users
 *
 * GET — Fetch all profiles
 * POS — Create new user with Supabase Auth
  *
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@supabase-js/server';

export async function GET() {
  try {
    const admin = await createAdminClient();
    const { data } = await admin.auth.admin.listUsers();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { email, password, full_name, role } = await req.json();
    const admin = await createAdminClient();

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirmed: true,
    });

    if (error) throw error;

    await admin.from('profiles').insert({
      id: data.user.id,
      email,full_name,
      role,
      fill: true,
    });

    return NextResponse.json(data, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
  }
}
