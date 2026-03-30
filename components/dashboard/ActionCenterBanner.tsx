'use client';

/**
 * ActionCenterBanner — strip above the main dashboard panels
 *
 * Shows a quick summary of action items and links to /action-center.
 * Only visible when there are HIGH or CRITICAL items.
 */

import { useRouter } from 'next/navigation';

interface Props {
  criticalCount: number;
  highCount:     number;
  loading?:      boolean;
}

export default function ActionCenterBanner({ criticalCount, highCount, loading }: Props) {
  const router = useRouter();
  const total  = criticalCount + highCount;

  if (loading || total === 0) return null;

  const isAllCritical = criticalCount > 0;

  return (
    <button
      onClick={() => router.push('/action-center')}
      className="w-full text-right flex items-center justify-between gap-3 px-4 py-3 rounded-xl mb-3 transition-all hover:-translate-y-px hover:shadow-lg group"
      style={{
        background: isAllCritical
          ? 'linear-gradient(135deg, #DC2626 0%, #b91c1c 100%)'
          : 'linear-gradient(135deg, #C05728 0%, #9a3f1a 100%)',
        boxShadow: isAllCritical
          ? '0 3px 12px rgba(220,38,38,.3)'
          : '0 3px 12px rgba(192,87,40,.25)',
      }}
    >
      <div className="flex items-center gap-3">
        <span className="text-2xl leading-none animate-pulse">
          {isAllCritical ? '🚨' : '⚠️'}
        </span>
        <div>
          <p className="text-[0.82rem] font-black text-white leading-tight">
            {criticalCount > 0 && `${criticalCount} بند حرج`}
            {criticalCount > 0 && highCount > 0 && ' + '}
            {highCount > 0 && `${highCount} بند مرتفع الأولوية`}
            {' '}يتطلب{total === 1 ? ' إجراءً' : ' إجراءات'}
          </p>
          <p className="text-[0.65rem] text-white/70 mt-0.5">
            انقر لعرض مركز الإجراءات التنفيذية
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-white/80 text-sm font-bold group-hover:text-white transition-colors">
          فتح المركز ←
        </span>
      </div>
    </button>
  );
}
