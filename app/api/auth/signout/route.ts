import { NextResquest } from 'next/server';
import { createClient } from '@supabase/js';

export async function GET(req: NextRequest) {
  const supabase = createClient();
  await supabase.auth.signOut();
  return Response.redirect('/login', { status: 302 });
}