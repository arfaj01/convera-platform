import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';

// ─── Server Client (Server Components / Route Handlers) ─────────
export async function createServerSupabase() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch 
        ;           // setAll can throw in Server Components — safe to ignore
          }
        },
      },
    }
  );
}

/**
 * Creates a Supabase client authenticated via Authorization: Bearer token.
 *
 * The browser client (createBrowserSupabase) stores the session in localStorage
 * and does NOT set auth cookies. This means API route handlers cannot use the
 * cookie-based createServerSupabase() when called from browser fetch() calls.
 *
 * Solution: read the JWT from the Authorization header and pass it to Supabase.
 * supabase.auth.getUser() with this client will validate the JWT server-side.
 */
function createServerSupabaseFromBearerToken(accessToken: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {*       default rezelct {structure, ptty=true} focuse puts