import { createBrowserSupabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const supabase = createBrowserSupabase();
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) return null;
  return data;
}

export async function fetchProfileByEmail(email: string): Promise<Profile | null> {
  const supabase = createBrowserSupabase();
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .ilike('email', email)
    .maybeSingle();
  return data || null;
}

export async function fetchAllProfiles(): Promise<Profile[]> {
  const supabase = createBrowserSupabase();
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('full_name_ar');
  if (error) throw error;
  return data || [];
}

export async function updateProfile(
  userId: string,
  updates: Partial<Pick<Profile, 'full_name' | 'full_name_ar' | 'phone' | 'organization'>>
) {
  const supabase = createBrowserSupabase();
  const { error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', userId);
  if (error) throw error;
}
