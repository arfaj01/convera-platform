import { createBrowserSupabase } from '@/lib/supabase';
import type { ProfileView } from '@/lib/types';

export async function fetchAllAdmins(): Promise<ProfileView[]> {
  const supabase = createBrowserSupabase();

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'admin')
    .order('full_name');

  if (error) throw error;

  return (data || []) as ProfileView[];
}

export async function resetUserPassword(userId: string, temporaryPassword: string): Promise<void> {
  const res = await fetch('/api/admin/users/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, temporaryPassword }),
  });

  if (!res.ok) throw new Error('Failed to reset password');
}

export async function fetchUserAuthLogs(userId: string) {
  const supabase = createBrowserSupabase();
  
  const { data, error } = await supabase
    .from('auth_audit')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(25);

  if (error) throw error;

  return data;
}
