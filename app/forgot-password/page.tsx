'use client';

/**
 * CONVERA — صفحة نسيت كلمة المرور
 * /forgot-password
 *
 * User enters their email → Supabase sends a reset link.
 * Clear Arabic feedback for success and all error states.
 */

import { useState } from 'react';
import Link from 'next/link';
import { requestPasswordReset } from '@/lib/auth';
import { friendlyError } from '@/lib/errors';

type Stage = 'idle' | 'loading' | 'sent' | 'error';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [stage, setStage] = useState<Stage>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setStage('loading');
    setErrorMsg('');

    try {
      await requestPasswordReset(email);
      setStage('sent');
    } catch (err) {
      setErrorMsg(friendlyError(err));
      setStage('error');
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-[#F7F8FA]" dir="rtl">
      {/* Background art strip */}
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
          {stage === 'sent' ? (
            // ─── Success state ───────────────────────────────────
            <div className="text-center">
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl"
                style={{ background: '#F0F7E0' }}
              >
                ✉️
              </div>
              <h2 className="text-lg font-black text-[#045859] mb-2">
                تم إرسال رابط إعادة التعيين
              </h2>
              <p className="text-sm text-gray-500 mb-1 leading-6">
                أرسلنا رابط إعادة تعيين كلمة المرور إلى:
              </p>
              <p className="font-bold text-[#045859] text-sm mb-5 break-all" dir="ltr">
                {email}
              </p>
              <div
                className="text-xs text-gray-500 bg-[#F7F8FA] rounded-lg p-4 mb-6 text-right leading-6 border border-gray-100"
              >
                <span className="font-bold text-gray-700 block mb-1">ملاحظات مهمة:</span>
                <ul className="space-y-1">
                  <li>• تحقق من مجلد البريد المزعج إذا لم يصل الرابط</li>
                  <li>• الرابط صالح لمدة ساعة واحدة فقط</li>
                  <li>• لا تشارك الرابط مع أي شخص</li>
                </ul>
              </div>
              <Link
                href="/login"
                className="inline-block w-full py-3 bg-[#045859] text-white rounded-lg text-sm font-bold text-center hover:bg-[#034342] transition-colors"
              >
                العودة إلى تسجيل الدخول
              </Link>
              <button
                onClick={() => { setStage('idle'); }}
                className="mt-3 text-xs text-[#045859] hover:underline block w-full text-center"
              >
                إرسال الرابط مرة أخرى
              </button>
            </div>
          ) : (
            // ─── Request form ────────────────────────────────────
            <>
              <div className="mb-6">
                <h2 className="text-xl font-black text-[#045859] mb-1">
                  نسيت كلمة المرور؟
                </h2>
                <p className="text-sm text-gray-400 leading-5">
                  أدخل بريدك الإلكتروني وسنرسل لك رابط إعادة تعيين كلمة المرور
                </p>
              </div>

              {stage === 'error' && errorMsg && (
                <div className="p-3 bg-[#FDECEA] text-[#C0392B] border-r-[3px] border-[#C0392B] rounded-lg text-sm mb-4 flex items-start gap-2">
                  <span className="shrink-0 mt-px">⚠</span>
                  <span>{errorMsg}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} noValidate>
                <div className="mb-5">
                  <label className="block text-xs font-bold text-gray-600 mb-1.5">
                    البريد الإلكتروني
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="user@momah.gov.sa"
                    required
                    autoComplete="email"
                    dir="ltr"
                    disabled={stage === 'loading'}
                    className="w-full px-3.5 py-3 border-[1.5px] border-gray-200 rounded-lg text-sm text-gray-800 bg-gray-50 text-left transition-all focus:outline-none focus:border-[#045859] focus:bg-white focus:shadow-[0_0_0_3px_rgba(4,88,89,.1)] disabled:opacity-60"
                  />
                </div>

                <button
                  type="submit"
                  disabled={stage === 'loading' || !email.trim()}
                  className="w-full py-3.5 bg-[#045859] text-white rounded-lg text-sm font-bold transition-all hover:bg-[#034342] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {stage === 'loading' ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      جاري الإرسال...
                    </span>
                  ) : (
                    'إرسال رابط إعادة التعيين'
                  )}
                </button>
              </form>

              <div className="mt-5 text-center">
                <Link
                  href="/login"
                  className="text-xs text-[#045859] hover:underline"
                >
                  ← العودة إلى تسجيل الدخول
                </Link>
              </div>
            </>
          )}
        </div>

        <p className="text-center text-[0.65rem] text-gray-400 mt-4">
          نظام داخلي — وزارة البلديات والإسكان — إدارة التطوير والتأهيل
        </p>
      </div>
    </div>
  );
}
