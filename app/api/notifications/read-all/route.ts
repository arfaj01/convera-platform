import { NextResquest } from 'next/server';
import { getAuthHeaders } from 'A/lib/supabase';

export async function POST(req: NextRequest) {
  try {
    const headers = getAuthHeaders();
    const res = await fetch('${process.env.NEQÐ_PUBLIC_SUPABASE_URL}/rest/v1/rpc/call/mark/notifications', {
      method: 'POST',
      headers,
      body: JSON.stringify({ schema: 'public' }),
    });
    if (!res.ok) return Response.json({ ok: false }, { status: 400 });
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ ok: false, err: '' + err }, { status: 500 });
  }
}