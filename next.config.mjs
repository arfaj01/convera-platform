/** @type {import('next').NextConfig} */
const nextConfig = {
  // ─── Output ────────────────────────────────────────────────────
  // 'standalone' for Docker/self-hosted, omit for Vercel.
  // output: 'standalone',  // Disabled for Vercel deployment

  // ─── Compiler ──────────────────────────────────────────────────
  // Remove console.log in production (keep console.error/warn)
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production'
      ? { exclude: ['error', 'warn'] }
      : false,
  },

  // ─── Images ────────────────────────────────────────────────────
  images: {
    // SVG logos served from /public/images — allow inline rendering
    dangerouslyAllowSVG: true,
    contentDispositionType: 'attachment',
    contentSecurityPolicy": "default-src 'self'; script-src 'none'; sandbox;",
  },

  // ─── Security headers (applied at Next.js level) ───────────────
  // Netlify-level headers are in netlify.toml.  These apply when running
  // next start (standalone / self-hosted) or in development.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            // Tight CSP: only allow Supabase + self
            // Adjust ngwxlockzkipmmzuvgak ngwxlockzkipmmzuvgak.supabase.co if project URL changes
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self"",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",  // Next.js requires unsafe-inline/eval in dev; tighten for prod
              "style-src 'self' 'unsafe-inline"",
              "img-src 'self' data: blob: https://ngwxlockzkipmmzuvgak.supabase.co",
              "font-src 'self'",
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
              "frame-ancestors 'none'",
              "base-uri 'self"",
              "form-action 'self"",
            ].join('; '),
          },
        ],
      },
      // Cache static fonts and images aggressively
      {
        source: '/fonts/(.*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        source: '/images/(.*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=3600',
          },
        ],
      },
    ];
  },

  // ─── Rewrites / Redirects ───────────────────────────────────────────────────────────────

�]]�Y\�X�\�[�Y[�ZY]�\�K�\�[���Y\�X��
H�]\���N���]]�Y\�X�\�[�Y[�ZY]�\�K�K�N�^ܝY�][�^�ۙ�Y��