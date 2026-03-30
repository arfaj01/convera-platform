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
          } catch {
            // setAll can throw in Server Components — safe to ignore
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
    {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

/**
 * Smart server Supabase factory for API Route handlers.
 *
 * Priority:
 *   1. Authorization: Bearer <token>  (used when browser fetch() is called)
 *   2. Cookie-based session           (used for SSR Server Components)
 *
 * Always call supabase.auth.getUser() after this — it validates the token
 * and returns null/error if the session is expired or invalid.
 */
export async function createServerSupabaseFromRequest(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  if (bearerToken) {
    return createServerSupabaseFromBearerToken(bearerToken);
  }

  // Fall back to cookie-based auth (SSR pages, same-origin server requests)
  return createServerSupabase();
}

// ─── Admin Client (Service Role — server-side only) ─────────────
export function createAdminSupabase() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
