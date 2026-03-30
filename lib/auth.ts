import { createBrowserSupabase } from './supabase';

// ─── Client-side auth actions ────────────────────────────────────

export async function signIn(email: string, password: string) {
  const supabase = createBrowserSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) throw error;

  // ── Account suspension check ──────────────────────────────────
  // Supabase Auth (GoTrue) is independent from the profiles table.
  // A user whose profile has is_active = false can still pass JWT
  // validation. We check here immediately after authentication and
  // forcibly sign out before the page redirect if the account is
  // suspended. This is defence-in-depth on top of the withAuth guard.
  if (data.user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_active')
      .eq('id', data.user.id)
      .maybeSingle();

    if (profile && profile.is_active === false) {
      // Sign out immediately — do not return the live session
      await supabase.auth.signOut();
      const err = new Error('الحساب موقوف — تواصل مع مدير النظام لإعادة التفعيل');
      (err as Error & { code?: string }).code = 'ACCOUNT_SUSPENDED';
      throw err;
    }
  }

  return data;
}

export async function signOut() {
  const supabase = createBrowserSupabase();
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/zw