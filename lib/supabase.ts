import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = !!(SUPABASE_URL && SUPABASE_KEY);

// ─── Browser Client (Client Components) ─────────────────────────
// Use globalThis with a plain string key to survive HMR
const GLOBAL_KEY = '__convera_sb__';

export function createBrowserSupabase(): SupabaseClient {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        detectSessionInUrl: false,
      },
    });
  }
  return g[GLOBAL_KEY];
}

/**
 * Returns Authorization headers for fetch() calls to Next.js API routes.
 *
 * Problem: createBrowserSupabase() stores the auth session in localStorage,
 * while the API route server reads from cookies via createServerSupabase().
 * The two mechanisms don't share the session.
 *
 * Fix: read the JWT from the browser's localStorage session and send it as
 * an Authorization: Bearer header. The API routes use createServerSupabaseFromRequest()
 * which checks for this header first before falling back to cookies.
 *
 * Returns an object with both Content-Type and Authorization headers, ready
 * to spread into a fetch() headers object.
 *
 * Usage:
 *   const headers = await getAuthHeaders();
 *   const res = await fetch('/api/claims/submit', {
 *     method: 'POST',
 *     headers,
 *     body: JSON.stringify(payload),
 *   });
 */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  const baseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  try {
    const sb = createBrowserSupabase();
    const { data: { session } } = await sb.auth.getSession();
    if (session?.access_token) {
      baseHeaders['Authorization'] = `Bearer ${session.access_token}`;
    }
  } catch {
    // If session read fails, proceed without auth header — the API will return 401
    // with an Arabic message that the UI handles gracefully.
  }

  return baseHeaders;
}

/**
 * Steal any orphaned Web Lock left by a previous GoTrueClient instance
 * that was killed by HMR. Call this once on app startup.
 */
export async function releaseOrphanedLocks() {
  if (typeof navigator === 'undefined' || !navigator.locks) return;
  try {
    const state = await navigator.locks.query();
    const orphaned = state.held?.filter(l => l.name?.startsWith('lock:sb-')) ?? [];
    for (const lock of orphaned) {
      if (!lock.name) continue;
      await navigator.locks.request(lock.name, { steal: true }, () => Promise.resolve());
    }
  } catch {
    // Locks API not available or failed — ignore
  }
}
