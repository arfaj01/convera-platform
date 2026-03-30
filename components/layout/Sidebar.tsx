'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_ITEMS, ROLE_LABELS } from '@/lib/constants';
import type { Profile } from '@/lib/types';

interface SidebarProps {
  profile: Profile;
  isOpen: boolean;
  collapsed: boolean;
  onClose: () => void;
  onToggleCollapse: () => void;
}

/* ── SVG toggle icons ─────────────────────────────────────────── */

function CollapseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
      <polyline points="15 8 12 12 15 16" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
      <polyline points="12 8 15 12 12 16" />
    </svg>
  );
}

/* ── Tooltip wrapper for collapsed mode ───────────────────────── */

function Tooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="relative group">
      {children}
      <div className="pointer-events-none absolute top-1/2 left-0 -translate-y-1/2 -translate-x-[calc(100%+8px)] opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-[200]">
        <div className="bg-gray-800 text-white text-xs font-medium px-2.5 py-1.5 rounded whitespace-nowrap shadow-lg">
          {label}
          <div className="absolute top-1/2 right-0 translate-x-full -translate-y-1/2 border-[5px] border-transparent border-l-gray-800" />
        </div>
      </div>
    </div>
  );
}

/* ── Main Sidebar component ───────────────────────────────────── */

export default function Sidebar({ profile, isOpen, collapsed, onClose, onToggleCollapse }: SidebarProps) {
  const pathname = usePathname();
  const initial = (profile.full_name_ar || profile.full_name || '').charAt(0);

  const filteredNav = NAV_ITEMS.filter(item => {
    if (!item.roles) return true;
    return item.roles.includes(profile.role);
  });

  const EXPANDED_W = 230;
  const COLLAPSED_W = 64;
  const desktopWidth = collapsed ? COLLAPSED_W : EXPANDED_W;

  const navLink = (
    href: string,
    icon: string,
    label: string,
    isActive: boolean,
    key: string,
  ) => {
    const link = (
      <Link
        key={key}
        href={href}
        onClick={onClose}
        className={`
          flex items-center ${collapsed ? 'justify-center lg:justify-center' : ''} gap-2
          ${collapsed ? 'px-1 py-2' : 'px-3 py-[7px]'} rounded text-[0.82rem] font-medium mb-px
          transition-all duration-150 no-underline
          ${isActive
            ? 'bg-lime/[.14] text-lime/90 border-r-[3px] border-lime'
            : 'text-white/[.55] hover:bg-white/[.07] hover:text-white border-r-[3px] border-transparent'
          }
        `}
      >
        <span className="text-[15px] w-[18px] text-center flex-shrink-0">{icon}</span>
        {!collapsed && <span>{label}</span>}
        {collapsed && <span className="lg:hidden">{label}</span>}
      </Link>
    );

    if (collapsed) {
      return (
        <Tooltip label={label} key={key}>
          {link}
        </Tooltip>
      );
    }
    return link;
  };

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/40 z-[99] lg:hidden" onClick={onClose} />
      )}

      <aside
        className={`
          bg-teal-dark flex flex-col fixed top-0 right-0 bottom-0 z-[100] overflow-y-auto overflow-x-hidden
          transition-all duration-300
          lg:translate-x-0
          ${isOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'}
        `}
        style={{ width: isOpen ? EXPANDED_W : desktopWidth }}
      >
        {/* ── Header ─────────────────────────────────────────── */}
        <div className={`${collapsed ? 'px-2' : 'px-3'} pt-3 border-b border-white/[.07]`}>
          {/* Brand — Ministry logo + CONVERA name */}
          <div className="py-2 pb-2 border-b border-white/[.05]">
            {/* Expanded */}
            {!collapsed && (
              <div className="hidden lg:flex items-center gap-2.5">
                {/* MoMaH logo — white filter for dark background */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/images/momah-logo-white.svg"
                  alt="وزارة البلديات والإسكان"
                  className="h-8 w-auto flex-shrink-0"
                  style={{ filter: 'brightness(0) invert(1)', opacity: 0.9 }}
                />
                <div>
                  <h2 className="font-display text-[0.82rem] font-black text-white tracking-wider leading-tight">
                    CONVERA
                  </h2>
                  <p className="text-[0.58rem] text-lime/70 mt-px leading-tight">
                    نظام إدارة المطالبات المالية
                  </p>
                </div>
              </div>
            )}

            {/* Collapsed (desktop) — logo icon only */}
            {collapsed && (
              <div className="hidden lg:flex justify-center py-0.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/images/momah-logo-white.svg"
                  alt="وزارة البلديات والإسكان"
                  className="h-7 w-auto"
                  style={{ filter: 'brightness(0) invert(1)', opacity: 0.85 }}
                />
              </div>
            )}

            {/* Mobile drawer — always show full */}
            <div className="lg:hidden flex items-center gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/momah-logo-white.svg"
                alt="وزارة البلديات والإسكان"
                className="h-8 w-auto flex-shrink-0"
                style={{ filter: 'brightness(0) invert(1)', opacity: 0.9 }}
              />
              <div>
                <h2 className="font-display text-[0.82rem] font-black text-white tracking-wider">CONVERA</h2>
                <p className="text-[0.58rem] text-lime/70 mt-px">نظام إدارة المطالبات المالية</p>
              </div>
            </div>
          </div>

          {/* User card */}
          {!collapsed ? (
            <div className="mx-0 my-1.5 p-2 bg-white/[.06] rounded flex items-center gap-2 border border-white/[.05]">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                style={{ background: '#026D69' }}
              >
                {initial}
              </div>
              <div className="overflow-hidden">
                <div className="text-[0.75rem] text-white font-bold truncate leading-tight">
                  {profile.full_name_ar || profile.full_name}
                </div>
                <div className="text-[0.62rem] text-lime/80 leading-tight">
                  {ROLE_LABELS[profile.role] || profile.role}
                </div>
              </div>
            </div>
          ) : (
            <div className="hidden lg:flex justify-center my-1.5">
              <Tooltip label={`${profile.full_name_ar || profile.full_name} — ${ROLE_LABELS[profile.role] || profile.role}`}>
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white cursor-default"
                  style={{ background: '#026D69' }}
                >
                  {initial}
                </div>
              </Tooltip>
            </div>
          )}
          {/* Mobile drawer always shows full user card */}
          {collapsed && (
            <div className="lg:hidden mx-0 my-1.5 p-2 bg-white/[.06] rounded flex items-center gap-2 border border-white/[.05]">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0" style={{ background: '#026D69' }}>
                {initial}
              </div>
              <div>
                <div className="text-[0.75rem] text-white font-bold">{profile.full_name_ar || profile.full_name}</div>
                <div className="text-[0.62rem] text-lime/80">{ROLE_LABELS[profile.role] || profile.role}</div>
              </div>
            </div>
          )}
        </div>

        {/* ── Navigation ─────────────────────────────────────── */}
        <nav className={`${collapsed ? 'px-1' : 'px-2'} py-1 flex-1`}>
          {!collapsed && (
            <div className="text-[0.58rem] font-bold text-white/20 tracking-[1.5px] px-2 py-1.5 pt-2">
              القائمة الرئيسية
            </div>
          )}
          {collapsed && <div className="pt-1.5" />}

          {filteredNav.map(item => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
            return navLink(item.href, item.icon, item.label, isActive, item.id);
          })}

          {/* New claim link for external users */}
          {(profile.role === 'supervisor' || profile.role === 'contractor') && (
            <>
              {!collapsed && (
                <div className="text-[0.58rem] font-bold text-white/20 tracking-[1.5px] px-2 py-1.5 pt-3">
                  إجراءات
                </div>
              )}
              {navLink('/claims/new', '➕', 'مطالبة جديدة', pathname === '/claims/new', 'new-claim')}
            </>
          )}
        </nav>

        {/* ── Collapse toggle (desktop only) — icon only ────── */}
        <button
          onClick={onToggleCollapse}
          className="hidden lg:flex w-full px-3 py-2.5 bg-white/[.03] border-none border-t border-white/[.07] text-white/40 text-sm cursor-pointer items-center justify-center transition-all hover:bg-white/[.08] hover:text-white font-sans"
          title={collapsed ? 'توسيع القائمة' : 'طي القائمة'}
          aria-label={collapsed ? 'توسيع القائمة' : 'طي القائمة'}
        >
          {collapsed ? <ExpandIcon /> : <CollapseIcon />}
        </button>

        {/* ── Sign out ───────────────────────────────────────── */}
        <div className="p-1.5 border-t border-white/[.07]">
          <form action="/api/auth/signout" method="POST">
            {collapsed ? (
              <Tooltip label="تسجيل الخروج">
                <button
                  type="submit"
                  className="w-full px-1 py-2 bg-white/[.05] border-none rounded text-white/[.40] text-[0.75rem] cursor-pointer flex items-center justify-center transition-all hover:bg-white/10 hover:text-white font-sans"
                >
                  🚪
                </button>
              </Tooltip>
            ) : (
              <button
                type="submit"
                className="w-full px-3 py-1.5 bg-white/[.05] border-none rounded text-white/[.40] text-[0.75rem] cursor-pointer flex items-center gap-2 transition-all hover:bg-white/10 hover:text-white text-right font-sans"
              >
                🚪 <span>تسجيل الخروج</span>
              </button>
            )}
          </form>
        </div>
      </aside>
    </>
  );
}
