import type { Config } from 'tailwindcss';

/**
 * CONVERA — MoMaH Official Tailwind Configuration
 * Colors from Ministry Brand Guidelines V.01 (PANTONE references)
 * Font: MasmakBHD Bold (FRONTEND FONT.otf) — ALL text
 */
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // ── MoMaH PRIMARY — PANTONE 7476C ─────────────────────────
        teal: {
          DEFAULT: '#045859',   // Official dark green — sidebar, headers
          dark:    '#034342',   // Hover/active states
          light:   '#087272',   // Lighter accent
          pale:    '#E8F4F4',   // Background highlights
          ultra:   '#F0FAFA',   // Row hover / subtle bg
        },

        // ── MoMaH SUCCESS — PANTONE 376C ──────────────────────────
        lime: {
          DEFAULT: '#87BA26',   // Approved, active, CTA
          dark:    '#6A9E00',
          pale:    '#F0F7E0',
        },

        // ── MoMaH ACCENT PALETTE ──────────────────────────────────
        // PANTONE CoolGrey11C
        gray: {
          50:  '#F7F8FA',
          100: '#E8F4F4',
          200: '#DDE2E8',
          400: '#54565B',
          600: '#34393E',
          800: '#1A1A2E',
        },

        // Status / semantic colors (MoMaH brand)
        red:    { DEFAULT: '#C05728', light: '#FAEEE8' },   // PANTONE 167C — returned/danger
        green:  { DEFAULT: '#87BA26', light: '#F0F7E0' },   // Approved
        orange: { DEFAULT: '#C05728', light: '#FAEEE8' },   // Warning returned
        blue:   { DEFAULT: '#045859', light: '#E8F4F4' },   // Director pending
        purple: { DEFAULT: '#502C7C', light: '#EDE7F6' },   // PANTONE 7680C — auditor
        gold:   { DEFAULT: '#FFC845', light: '#FFF8E0' },   // PANTONE 1225C — supervisor
        info:   { DEFAULT: '#00A79D', light: '#E0F4F3' },   // PANTONE 326C — teal links
      },

      fontFamily: {
        // MasmakBHD Bold is the ONLY font (FRONTEND FONT.otf)
        // Fallback: Tajawal (Google Fonts, Arabic-optimised)
        sans:    ['MasmakBHD', 'Tajawal', 'sans-serif'],
        display: ['MasmakBHD', 'Tajawal', 'sans-serif'],
        arabic:  ['MasmakBHD', 'Tajawal', 'sans-serif'],
      },

      borderRadius: {
        DEFAULT: '12px',
        sm:      '8px',
        lg:      '16px',
      },

      boxShadow: {
        card:      '0 2px 8px rgba(4,88,89,0.08)',
        cardHover: '0 6px 20px rgba(4,88,89,0.16)',
        topbar:    '0 1px 0 #DDE2E8',
      },

      width:  { sidebar: '230px' },
      height: { topbar: '64px' },
    },
  },
  plugins: [],
};

export default config;
