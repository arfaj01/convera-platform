'use client';

/**
 * SessionTimeoutBanner
 *
 * Displays a dismissable warning banner when the user has been idle
 * for 25 of the 30-minute idle timeout window.
 *
 * Usage: Drop inside the authenticated layout, it reads idle state
 * from AuthProvider context automatically.
 *
 *   <SessionTimeoutBanner />
 */

import { useAuth } from '@/components/AuthProvider';

export default function SessionTimeoutBanner() {
  const { idleWarning, resetIdle } = useAuth();

  // Only render when idle warning is active
  if (idleWarning === null || idleWarning <= 0) return null;

  const minutes = Math.floor(idleWarning / 60);
  const seconds = idleWarning % 60;
  const timeStr  = minutes > 0
    ? `${minutes}:${String(seconds).padStart(2, '0')} دقيقة`
    : `${seconds} ثانية`;

  // Urgency level for styling
  const isUrgent = idleWarning <= 60;

  return (
    <div
      dir="rtl"
      role="alert"
      aria-live="assertive"
      className={`
        fixed bottom-4 right-4 z-[9999] max-w-sm w-full
        rounded-xl shadow-2xl border
        flex flex-col gap-3 p-4
        transition-all duration-300 animate-in slide-in-from-bottom-2
        ${isUrgent
          ? 'bg-red-50 border-red-300 shadow-red-100'
          : 'bg-amber-50 border-amber-300 shadow-amber-100'
        }
      `}
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        <span className="text-2xl leading-none mt-0.5">
          {isUrgent ? '🔴' : '⏱'}
        </span>
        <div className="flex-1">
          <p className={`text-sm font-black ${isUrgent ? 'text-red-800' : 'text-amber-900'}`}>
            انتهاء الجلسة قريباً
          </p>
          <p className={`text-xs mt-0.5 ${isUrgent ? 'text-red-600' : 'text-amber-700'}`}>
            ستنتهي جلستك تلقائياً خلال
            {' '}
            <span className={`font-black font-mono text-sm ${isUrgent ? 'text-red-700' : 'text-amber-800'}`}>
              {timeStr}
            </span>
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full h-1 rounded-full bg-gray-200 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-1000 ${
            isUrgent ? 'bg-red-500' : 'bg-amber-500'
          }`}
          style={{ width: `${Math.min(100, (idleWarning / 300) * 100)}%` }}
        />
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={resetIdle}
          className={`
            flex-1 py-2 px-4 rounded-lg text-xs font-black text-white
            transition-all hover:-translate-y-px active:translate-y-0
            ${isUrgent
              ? 'bg-red-600 hover:bg-red-700 shadow-md shadow-red-200'
              : 'bg-amber-600 hover:bg-amber-700 shadow-md shadow-amber-200'
            }
          `}
        >
          البقاء في الجلسة
        </button>
        <button
          onClick={() => { window.location.href = '/api/auth/signout'; }}
          className="py-2 px-4 rounded-lg text-xs font-bold text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 transition-colors"
        >
          تسجيل الخروج
        </button>
      </div>
    </div>
  );
}
