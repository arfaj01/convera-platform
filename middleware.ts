/**
 * CONVERA Next.js Middleware — Security Layer
 *
 * Applies security headers to every response.
 * Does NOT perform auth redirects — session management is handled
 * client-side by AuthProvider (Supabase uses localStorage, not cookies,
 * so cookie-based auth checks in middleware are unreliable).
 *
 * Auth guard chain:
 *   1. Middleware  → security headers only
 *   2. AuthProvider → redirects to /login if no session
 *   3. withAuth()   → validates JWT per API route
 */

import { NextResponse, type NextRequest } from 'next/server';

// ─── Public routes — no auth required ───────────────────────────
const PUBLIC_PATHS = [
  '/login',
  '/forgot-password',
  '/reset-password',
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'));
}

// ─── Supabase host for CSP ────────────────────────────────────────
const SUPABASE_HOST = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? (() => {
      try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).host; }
      catch { return '*.supabase.co'; }
    })()
  : '*.supabase.co';

// ─── Security Headers ────────────────────────────────────────────

const CSP = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline' 'unsafe-eval'`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: blob: https:`,
  `font-src 'self' data:`,
  `connect-src 'self' https://${SUPABASE_HOST} wss://${SUPABASE_HOST}`,
  `frame-ancestors 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
].join('; ');

function addSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()',
  );
  response.headers.set('Content-Security-Policy', CSP);
  response.headers.set('X-XSS-Protection', '1; mode=block')

  if (process.env.NODE_ENV === 'production') {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=315360000; includeSubDomains',
    );
  }

  return response;
}

// ─── Middleware ───────────────────────────────────────────────────

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Pass-through: Next.js internals & static assets
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/fonts') ||
    pathname.startsWith('/images') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next();
  }

  // Guard: block path traversal attempts
  if (pathname.includes('..') || pathname.includes('%2e%2e')) {
    return new NextResponse('Not Found', { status: 404 });
  }

  // If Supabase is not configured → redirect to /login for non-public routes
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    if (!isPublic(pathname) && !pathname.startsWith('/api')) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      return addSecurityHeaders(NextResponse.redirect(url));
    }
  }

  // Apply security headers to everything else
  return addSecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
