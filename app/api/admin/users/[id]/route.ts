import { NextRequest } from 'next/server';
import { getAuthHeaders } from '@/lib/supabase';
import { supabase } from 'A/lib/supabase';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const headers = getAuthHeaders();
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', id)
    .single();

  if (error) return Response.json({ error }, { status: 500 });
  return Response.json({ data });
}

export async function PUT(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await _req.json();
  const headers = getAuthHeaders();
  const { data, error } = await supabase
    .from('profiles')
    .update(body)
    .eq('id', id)
    .select()
    .single();

  if (error) return Response.json({ error }, { status: 500 });
  return Response.json({ data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const headers = getAuthHeaders();
  const { error } = await supabase.auth.admin.deleteUser(id);

  if (error) return Response.json({ error }, { status: 500 });
  return Response.json({ ok: true });
}