'use client';

import { useState } from 'react';
import Link from 'next/link';
import { signIn } from '@/lib/auth';
import { friendlyError } from '@/lib/errors';
import { isSupabaseConfigured } from '@/lib/supabase';

// ─── Translations ─────────────────────────────────────────────────

const T = {
  ar: {
    dir:             'rtl'  as const,
    ministryName:    'وزارة البلديات والإسكان',
    deptName:        'إدارة التطوير والتأهيل',
    systemSubtitle:  'نظام إدارة المطالبات المالية',
    loginTitle:      'تسجيل الدخول',
    loginSubtitle:   'أدخل بيانات الدخول الخاصة بك',
    emailLabel:      'البريد الإلكتروني',
    passwordLabel:   'كلمة المرور',
    forgotPassword:  'نسيت كلمة المرور؟',
    loginBtn:        'تسجيل الدخول',
    loggingIn:       'جاري الدخول...',
    footerNote:      'نظام داخلي — وزارة البلديات والإسكان',
    supabaseWarning: 'Supabase غير مهيّأ — أضف المتغيرات في ملف .env.local',
    langToggle:      'English',
    timeout:         'انتهت مهلة الاتصال — تحقق من الشبكة',
  },
  en: {
    dir:             'ltr'  as const,
    ministryName:    'Ministry of Municipalities and Housing',
    deptName:        'Development & Rehabilitation Department',
    systemSubtitle:  'Financial Claims Management System',
    loginTitle:      'Sign In',
    loginSubtitle:   'Enter your credentials to access the system',
    emailLabel:      'Email Address',
    passwordLabel:   'Password',
    forgotPassword:  'Forgot your password?',
    loginBtn:        'Sign In',
    loggingIn:       'Signing in…',
    footerNote:      'Internal System — Ministry of Municipalities and Housing',
    supabaseWarning: 'Supabase not configured — add variables to .env.local',
    langToggle:      'عربي',
    timeout:         'Connection timeout — check your network',
  },
} as const;

// ─── Page ─────────────────────────────────────────────────────────

export default function LoginPage() {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPwd,  setShowPwd]  = useState(false);
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const [lang,     setLang]     = useState<'ar' | 'en'>('ar');

  const t = T[lang];
  const toggleLang = () => setLang(l => l === 'ar' ? 'en' : 'ar');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(t.timeout)), 15000),
      );
      await Promise.race([signIn(email, password), timeout]);
      window.location.href = '/dashboard';
    } catch (err) {
      setError(friendlyError(err));
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 flex z-[9999]" dir={t.dir}>

      {/* ═══ ART SIDE ═══════════════════════════════════════════════ */}
      <div className="hidden lg:flex flex-1 relative overflow-hidden flex-col items-center justify-center"
        style={{ background: 'linear-gradient(145deg, #023d3e 0%, #045859 45%, #038580 100%)' }}>

        {/* Decorative rings */}
        <div className="absolute w-[700px] h-[700px] rounded-full border border-white/[.04] -bottom-[250px] -right-[150px]" />
        <div className="absolute w-[400px] h-[400px] rounded-full border border-white/[.05] -bottom-[100px] -right-[50px]" />
        <div className="absolute w-[260px] h-[260px] rounded-full border border-lime/[.08] top-16 -left-[60px]" />
        <div className="absolute w-[120px] h-[120px] rounded-full border border-lime/[.12] top-24 left-16" />

        {/* Radial glow accents */}
        <div className="absolute inset-0"
          style={{ background: 'radial-gradient(circle at 25% 75%, rgba(135,186,38,.13) 0%, transparent 55%), radial-gradient(circle at 75% 20%, rgba(0,167,157,.09) 0%, transparent 45%)' }} />

        {/* Main content */}
        <div className="relative z-10 flex flex-col items-center text-center px-10">

          {/* Logo with glow halo — white version for dark background */}
          <div className="relative mb-8">
            <div className="absolute inset-0 rounded-full bg-white/8 blur-2xl scale-[1.8]" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/momah-logo-white.svg"
              alt={t.ministryName}
              className="relative h-32 w-auto mx-auto drop-shadow-[0_4px_24px_rgba(255,255,255,.18)]"
            />
          </div>

          {/* Decorative separator */}
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-px bg-gradient-to-r from-transparent to-lime/50" />
            <div className="w-1.5 h-1.5 rounded-full bg-lime/70" />
            <div className="w-10 h-px bg-gradient-to-l from-transparent to-lime/50" />
          </div>

          {/* Brand name */}
          <h1 className="text-[3.2rem] font-black text-white tracking-[5px] leading-none mb-2"
              style={{ fontFamily: 'MasmakBHD, Tajawal, sans-serif' }}>
            CONVERA
          </h1>
          <p className="text-white/55 text-sm tracking-[2px]">{t.systemSubtitle}</p>

          {/* Ministry info block */}
          <div className="mt-10 pt-6 border-t border-white/10 space-y-1.5">
            <p className="text-white/55 text-[0.78rem] font-bold">{t.ministryName}</p>
            <p className="text-white/35 text-[0.68rem]">{t.deptName}</p>
            <div className="mt-3">
              <span className="inline-block bg-lime/10 border border-lime/20 text-lime/75 px-4 py-1 rounded-full text-[0.62rem] tracking-[2px] uppercase">
                Ministry of Municipalities and Housing
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ FORM SIDE ══════════════════════════════════════════════ */}
      <div className="w-[440px] min-w-[340px] bg-white flex flex-col justify-center px-10 py-12 relative shadow-[-8px_0_40px_rgba(0,0,0,.12)]"
           dir={t.dir}>

        {/* Language toggle — top corner of form panel */}
        <button
          onClick={toggleLang}
          className="absolute top-5 start-5 flex items-center gap-1.5 bg-gray-50 hover:bg-[#E8F4F4] border border-gray-200 hover:border-teal/30 text-gray-500 hover:text-teal text-[0.72rem] font-bold px-3 py-1.5 rounded-full transition-all"
          dir="ltr"
        >
          🌐 {t.langToggle}
        </button>

        {/* Mobile-only: logo + name (art side is hidden on small screens) */}
        <div className="flex lg:hidden items-center gap-3 mb-6 pb-4 border-b border-gray-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/momah-logo-color.svg" alt={t.ministryName} className="h-10 w-auto" />
          <div>
            <p className="text-xs font-bold text-teal-dark leading-snug">{t.ministryName}</p>
            <p className="text-[0.65rem] text-gray-400">{t.deptName}</p>
          </div>
        </div>

        {/* Desktop header — accent bar + org name (NO logo — logo is on art side) */}
        <div className="hidden lg:flex items-center gap-3 mb-8 pb-5 border-b border-gray-100">
          <div className="w-1 h-9 rounded-full" style={{ background: 'linear-gradient(to bottom, #87BA26, #045859)' }} />
          <div>
            <p className="text-[0.73rem] font-bold text-teal-dark leading-tight">{t.ministryName}</p>
            <p className="text-[0.64rem] text-gray-400 mt-0.5">{t.deptName}</p>
          </div>
        </div>

        {/* Form heading */}
        <h2 className="text-[1.6rem] font-black text-teal-dark mb-1">{t.loginTitle}</h2>
        <p className="text-sm text-gray-400 mb-7">{t.loginSubtitle}</p>

        {/* Supabase config warning */}
        {!isSupabaseConfigured && (
          <div className="p-3 bg-amber-50 text-amber-700 border-s-[3px] border-amber-500 rounded-md text-xs mb-4">
            {t.supabaseWarning}
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="p-3 bg-red-50 text-red-700 border-s-[3px] border-red-500 rounded-md text-sm mb-4 flex items-start gap-2">
            <span className="mt-px shrink-0">⚠</span>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          {/* Email */}
          <div className="mb-4">
            <label className="block text-xs font-bold text-gray-600 mb-1.5">
              {t.emailLabel}
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="user@example.com"
              required
              autoComplete="email"
              dir="ltr"
              className="w-full px-4 py-3 border-[1.5px] border-gray-200 rounded-lg text-sm text-gray-800 bg-gray-50 text-left transition-all focus:outline-none focus:border-teal focus:bg-white focus:shadow-[0_0_0_3px_rgba(4,88,89,.1)]"
            />
          </div>

          {/* Password */}
          <div className="mb-3">
            <label className="block text-xs font-bold text-gray-600 mb-1.5">
              {t.passwordLabel}
            </label>
            <div className="relative">
              <input
                type={showPwd ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
                dir="ltr"
                className="w-full px-4 py-3 pe-11 border-[1.5px] border-gray-200 rounded-lg text-sm text-gray-800 bg-gray-50 text-left transition-all focus:outline-none focus:border-teal focus:bg-white focus:shadow-[0_0_0_3px_rgba(4,88,89,.1)]"
              />
              <button
                type="button"
                onClick={() => setShowPwd(v => !v)}
                tabIndex={-1}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm select-none"
                aria-label="toggle password visibility"
              >
                {showPwd ? '🙈' : '👁'}
              </button>
            </div>
          </div>

          {/* Forgot password */}
          <div className="flex justify-start mb-7">
            <Link
              href="/forgot-password"
              className="text-xs text-teal hover:text-teal-dark hover:underline transition-colors font-bold"
            >
              {t.forgotPassword}
            </Link>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading || !isSupabaseConfigured}
            className="w-full py-3.5 text-white border-none rounded-xl font-bold text-base cursor-pointer transition-all hover:-translate-y-px disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: 'linear-gradient(135deg, #045859 0%, #038580 100%)', boxShadow: '0 4px 14px rgba(4,88,89,.30)' }}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                {t.loggingIn}
              </span>
            ) : (
              t.loginBtn
            )}
          </button>
        </form>

        <div className="mt-8 text-center text-[0.62rem] text-gray-300 tracking-wide">
          {t.footerNote}
        </div>
      </div>
    </div>
  );
}
