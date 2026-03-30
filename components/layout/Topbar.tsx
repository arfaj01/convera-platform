'use client';

import type { Profile } from '@/lib/types';
import { PAGE_TITLES } from '@/lib/constants';
import { usePathname } from 'next/navigation';
import NotificationBell from '@/components/NotificationBell';

interface TopbarProps {
  profile: Profile;
  onMenuToggle: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

/* Professional sidebar toggle icon */
function SidebarToggleIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {collapsed ? (
        // Panel left + expand arrow
        <>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="9" y1="3" x2="9" y2="21" />
          <polyline points="12 8 15 12 12 16" />
        </>
      ) : (
        // Panel left + collapse arrow
        <>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="9" y1="3" x2="9" y2="21" />
          <polyline points="15 8 12 12 15 16" />
        </>
      )}
    </svg>
  );
}

export default function Topbar({ profile, onMenuToggle, collapsed, onToggleCollapse }: TopbarProps) {
  const pathname = usePathname();

  const segment = pathname.split('/').filter(Boolean)[0] || 'dashboard';
  const title = PAGE_TITLES[segment] || segment;
  const initial = (profile.full_name_ar || profile.full_name || '').charAt(0);

  return (
    <header
      className="h-topbar flex items-center justify-between px-4 lg:px-5 sticky top-0 z-50"
      style={{
        background: 'var(--bg-topbar)',          /* #034342 — MoMaH dark teal */
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        boxShadow: '0 1px 6px rgba(3,67,66,0.25)',
      }}
    >
      {/* ── Left / Start: toggle + page title ─────────────────── */}
      <div className="flex items-center gap-2">
        {/* Mobile hamburger */}
        <button
          onClick={onMenuToggle}
          className="lg:hidden w-9 h-9 bg-transparent border-none cursor-pointer text-xl text-white/70 flex items-center justify-center hover:text-white"
          aria-label="فتح القائمة"
        >
          ☰
        </button>
        {/* Desktop collapse toggle */}
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="hidden lg:flex w-8 h-8 bg-white/[.07] border border-white/10 rounded cursor-pointer text-white/50 items-center justify-center transition-all hover:bg-white/[.13] hover:text-white"
            title={collapsed ? 'إظهار القائمة' : 'إخفاء القائمة'}
            aria-label={collapsed ? 'إظهار القائمة' : 'إخفاء القائمة'}
          >
            <SidebarToggleIcon collapsed={!!collapsed} />
          </button>
        )}
        <div>
          <div className="text-[0.92rem] font-extrabold text-white leading-tight">{title}</div>
          <div className="text-[0.65rem] text-white/40 leading-tight tracking-wide">
            CONVERA · إدارة التطوير والتأهيل
          </div>
        </div>
      </div>

      {/* ── Right / End: ministry logo + user + notifications ──── */}
      <div className="flex items-center gap-2">
        {/* Ministry logo — visible on md+ */}
        <div className="hidden md:flex items-center gap-2 ps-3 pe-1 border-s border-white/[.12]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/momah-logo-white.svg"
            alt="وزارة البلديات والإسكان"
            className="h-6 w-auto"
            style={{ filter: 'brightness(0) invert(1)', opacity: 0.75 }}
          />
          <span className="text-[0.6rem] text-white/50 hidden lg:inline leading-tight text-right">
            وزارة البلديات<br />والإسكان
          </span>
        </div>

        {/* Notification bell — fully wired with dropdown */}
        <NotificationBell />

        {/* User avatar + name */}
        <div className="flex items-center gap-1.5">
          <span className="text-[0.78rem] font-bold text-white/80 hidden sm:inline">
            {profile.full_name_ar || profile.full_name}
          </span>
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white border-2 border-white/20"
            style={{ background: '#87BA26' }}
          >
            {initial}
          </div>
        </div>
      </div>
    </header>
  );
}
