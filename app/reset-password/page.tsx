'use client';

/**
 * CONVERA — صفحة إعادة تعيين كلمة المرور
 * /reset-password
 *
 * Handles Supabase PKCE recovery flow:
 *   1. Reads ?code= param from URL (set by Supabase email link)
 *   2. Exchanges code for a live session via supabase.auth.exchangeCodeForSession()
 *   3. Shows a new-password form with real-time strength indicator
 *   4. On success, redirects to /login with a success toast
 *
 * Supabase dashboard requirements:
 *   • Site URL = https://your-app.com
 *   • Redirect URLs must include: https://your-app.com/reset-password
 */

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { exchangeResetCode, updatePassword } from '@/lib/auth';
import { friendlyError } from '@/lib/errors';
import { checkPasswordStrength, validatePasswordPolicy } from '@/lib/password';
import { Suspense } from 'react';

// ─── Password Strength Bar ──────────────────────────────────────

function StrengthBar({ password }: { password: string }) {
  const strength = checkPasswordStrength(password);
  if (!password) return null;

  return (
    <div className="mt-2 space-y-2">
      {/* Progress bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ width: strength.barWidth, background: strength.color }}
          />
        </div>
        <span className="text-[0.65rem] font-bold whitespace-nowrap" style={{ color: strength.color }}>
          {strength.label}
        </span>
      </div>

      {/* Rules checklist */}
      <ul className="space-y-0.5">
        {strength.rules.map(rule => (
          <li
            key={rule.key}
            className="flex items-center gap-1.5 text-[0.65rem]"
            style={{ color: rule.met ? '#87BA26' : '#9CA3AF' }}
          >
            <span className="text-[0.6rem] font-bold">{rule.met ? '✓' : '○'}</span>
            {rule.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Show/hide toggle button ────────────────────────────────────

function EyeToggle({ show, onToggle, label }: { show: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      tabIndex={-1}
      className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs select-none"
      aria-label={label}
    >
      {show ? '🙈' : '👁'}
    </button>
  );
}

// ─── Main content (uses useSearchParams — must be wrapped in Suspense) ─

function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  type Stage = 'exchanging' | 'ready' | 'submitting' | 'success' | 'link_error' | 'error';

  const [stage, setStage]           = useState<Stage>('exchanging');
  const [errorMsg, setErrorMsg]     = useState('');
  const [newPwd, setNewPwd]         = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [showNew, setShowNew]       = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Exchange the PKCE code from URL for a session
  const exchangeCode = useCallback(async () => {
    const code = searchParams.get('code');
    if (!code) {
      setStage('link_error');
      setErrorMsg('لم يتم العثور على رمز التحقق في الرابط. يرجى طلب رابط جديد.');
      return;
    }
    try {
      await exchangeResetCode(code);
      setStage('ready');
    } catch (err) {
      setStage('link_error');
      setErrorMsg(friendlyError(err));
    }
  }, [searchParams]);

  useEffect(() => {
    exchangeCode();
  }, [exchangeCode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Client-side validation
    const policyError = validatePasswordPolicy(newPwd);
    if (policyError) {
      setErrorMsg(policyError);
      return;
    }
    if (newPwd !== confirmPwd) {
      setErrorMsg('كلمتا المرور غير متطابقتين. يرجى التحقق والمحاولة مجدداً.');
      return;
    }

    setErrorMsg('');
    setStage('submitting');

    try {
      await updatePassword(newPwd);
      setStage('success');
      // Redirect to login after 3 seconds
      setTimeout(() => router.replace('/login'), 3000);
    } catch (err) {
      setErrorMsg(friendlyError(err));
      setStage('ready');
    }
  };

  const strength = checkPasswordStrength(newPwd);

  // ─── Stage: exchanging code ──────────────────────────────────
  if (stage === 'exchanging') {
    return (
      <div className="text-center py-8">
        <div className="animate-spin w-10 h-10 border-4 border-[#045859] border-t-transparent rounded-full mx-auto mb-4" />
        <p className="text-sm text-gray-500">جاري التحقق من الرابط...</p>
      </div>
    );
  }

  // ─── Stage: link error ───────────────────────────────────────
  if (stage === 'link_error') {
    return (
      <div className="text-center py-4">
        <div className="w-12 h-12 rounded-full bg-[#FAEEE8] flex items-center justify-center mx-auto mb-4 text-xl">
          ⚠
        </div>
        <h2 className="text-base font-black text-[#C05728] mb-2">رابط غير صالح</h2>
        <p className="text-sm text-gray-500 mb-5 leading-5">{errorMsg}</p>
        <Link
          href="/forgot-password"
          className="inline-block w-full py-3 bg-[#045859] text-white rounded-lg text-sm font-bold text-center hover:bg-[#034342] transition-colors"
        >
          طلب رابط جديد
        </Link>
        <Link href="/login" className="mt-3 text-xs text-[#045859] hover:underline block text-center">
          ← تسجيل الدخول
        </Link>
      </div>
    );
  }

  // ─── Stage: success ──────────────────────────────────────────
  if (stage === 'success') {
    return (
      <div className="text-center py-4">
        <div className="w-14 h-14 rounded-full bg-[#F0F7E0] flex items-center justify-center mx-auto mb-4 text-2xl">
          ✅
        </div>
        <h2 className="text-lg font-black text-[#045859] mb-2">تم تغيير كلمة المرور</h2>
        <p className="text-sm text-gray-500 mb-1 leading-6">
          كلمة المرور الجديدة محفوظة بنجاح.
        </p>
        <p className="text-xs text-gray-400 mb-5">سيتم تحويلك لتسجيل الدخول تلقائياً...</p>
        <div className="w-full bg-gray-100 rounded-full h-1 overflow-hidden mb-5">
          <div className="h-full bg-[#87BA26] rounded-full animate-[progress_3s_linear_forwards]" style={{ width: '0%', animation: 'width 3s linear forwards' }} />
        </div>
        <Link
          href="/login"
          className="text-xs text-[#045859] hover:underline"
        >
          تسجيل الدخول الآن →
        </Link>
      </div>
    );
  }

  // ─── Stage: ready / submitting ───────────────────────────────
  return (
    <>
      <div className="mb-6">
        <h2 className="text-xl font-black text-[#045859] mb-1">تعيين كلمة مرور جديدة</h2>
        <p className="text-sm text-gray-400 leading-5">
          أدخل كلمة مرور قوية — ستُستخدم لحماية حسابك
        </p>
      </div>

      {errorMsg && (
        <div className="p-3 bg-[#FDECEA] text-[#C0392B] border-r-[3px] border-[#C0392B] rounded-lg text-sm mb-4 flex items-start gap-2">
          <span className="shrink-0 mt-px">⚠</span>
          <span>{errorMsg}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>
        {/* New password */}
        <div className="mb-4">
          <label className="block text-xs font-bold text-gray-600 mb-1.5">
            كلمة المرور الجديدة
          </label>
          <div className="relative">
            <input
              type={showNew ? 'text' : 'password'}
              value={newPwd}
              onChange={e => setNewPwd(e.target.value)}
              placeholder="••••••••"
              required
              dir="ltr"
              autoComplete="new-password"
              disabled={stage === 'submitting'}
              className="w-full px-3.5 py-3 pe-10 border-[1.5px] border-gray-200 rounded-lg text-sm text-gray-800 bg-gray-50 text-left transition-all focus:outline-none focus:border-[#045859] focus:bg-white focus:shadow-[0_0_0_3px_rgba(4,88,89,.1)] disabled:opacity-60"
            />
            <EyeToggle
              show={showNew}
              onToggle={() => setShowNew(v => !v)}
              label={showNew ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
            />
          </div>

          {/* Live strength indicator */}
          <StrengthBar password={newPwd} />
        </div>

        {/* Confirm password */}
        <div className="mb-6">
          <label className="block text-xs font-bold text-gray-600 mb-1.5">
            تأكيد كلمة المرور
          </label>
          <div className="relative">
            <input
              type={showConfirm ? 'text' : 'password'}
              value={confirmPwd}
              onChange={e => setConfirmPwd(e.target.value)}
              placeholder="••••••••"
              required
              dir="ltr"
              autoComplete="new-password"
              disabled={stage === 'submitting'}
              className={`w-full px-3.5 py-3 pe-10 border-[1.5px] rounded-lg text-sm text-gray-800 bg-gray-50 text-left transition-all focus:outline-none focus:bg-white focus:shadow-[0_0_0_3px_rgba(4,88,89,.1)] disabled:opacity-60 ${
                confirmPwd && confirmPwd !== newPwd
                  ? 'border-[#C05728] focus:border-[#C05728]'
                  : confirmPwd && confirmPwd === newPwd
                    ? 'border-[#87BA26] focus:border-[#87BA26]'
                    : 'border-gray-200 focus:border-[#045859]'
              }`}
            />
            <EyeToggle
              show={showConfirm}
              onToggle={() => setShowConfirm(v => !v)}
              label={showConfirm ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
            />
          </div>
          {confirmPwd && confirmPwd !== newPwd && (
            <p className="mt-1 text-[0.65rem] text-[#C05728]">كلمتا المرور غير متطابقتين</p>
          )}
          {confirmPwd && confirmPwd === newPwd && (
            <p className="mt-1 text-[0.65rem] text-[#87BA26]">✓ كلمتا المرور متطابقتان</p>
          )}
        </div>

        <button
          type="submit"
          disabled={stage === 'submitting' || !strength.isStrong || newPwd !== confirmPwd}
          className="w-full py-3.5 bg-[#045859] text-white rounded-lg text-sm font-bold transition-all hover:bg-[#034342] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {stage === 'submitting' ? (
            <span className="flex items-center justify-center gap-2">
              <span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              جاري الحفظ...
            </span>
          ) : (
            'حفظ كلمة المرور الجديدة'
          )}
        </button>

        {!strength.isStrong && newPwd && (
          <p className="mt-2 text-center text-[0.65rem] text-gray-400">
            استوفِ جميع متطلبات كلمة المرور لتفعيل الزر
          </p>
        )}
      </form>

      <div className="mt-5 text-center">
        <Link href="/login" className="text-xs text-[#045859] hover:underline">
          ← العودة إلى تسجيل الدخول
        </Link>
      </div>
    </>
  );
}

// ─── Page wrapper (Suspense required for useSearchParams) ─────────

export default function ResetPasswordPage() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-[#F7F8FA]" dir="rtl">
      {/* Brand strip */}
      <div className="absolute right-0 top-0 bottom-0 w-1.5 bg-gradient-to-b from-[#045859] to-[#87BA26]" />

      <div className="w-full max-w-[420px] mx-4">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/momah-logo-color.svg"
            alt="وزارة البلديات والإسكان"
            className="h-10 w-auto"
          />
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-[0_4px_20px_rgba(4,88,89,0.10)] px-8 py-8">
          <Suspense
            fallback={
              <div className="text-center py-8">
                <div className="animate-spin w-10 h-10 border-4 border-[#045859] border-t-transparent rounded-full mx-auto" />
              </div>
            }
          >
            <ResetPasswordContent />
          </Suspense>
        </div>

        <p className="text-center text-[0.65rem] text-gray-400 mt-4">
          نظام داخلي — وزارة البلديات والإسكان — إدارة التطوير والتأهيل
        </p>
      </div>
    </div>
  );
}
