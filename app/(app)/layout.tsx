'use client';

import { useState, useEffect, memo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import Sidebar from '@/components/layout/Sidebar';
import Topbar from '@/components/layout/Topbar';
import SessionTimeoutBanner from '@/components/SessionTimeoutBanner';

const SIDEBAR_FULL = 230;
const SIDEBAR_COLLAPSED = 64;

const MemoizedSidebar = memo(Sidebar);
const MemoizedTopbar = memo(Topbar);

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    setIsDesktop(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [loading, user, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="text-3xl mb-2 animate-pulse">⏳</div>
          <p className="text-sm text-gray-400">جاري التحميل...</p>
        </div>
      </div>
    );
  }

  if (!user || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-400 animate-pulse">جاري التحويل...</p>
      </div>
    );
  }

  const sidebarW = isDesktop ? (collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_FULL) : 0;

  return (
    <div className="flex min-h-screen w-full overflow-x-hidden">
      {/* Sidebar spacer — reserves space in flex flow so main doesn't overlap */}
      {isDesktop && (
        <div
          className="flex-shrink-0 transition-all duration-300"
          style={{ width: sidebarW }}
        />
      )}

      {/* Fixed sidebar */}
      <MemoizedSidebar
        profile={profile}
        isOpen={sidebarOpen}
        collapsed={collapsed}
        onClose={() => setSidebarOpen(false)}
        onToggleCollapse={() => setCollapsed(!collapsed)}
      />

      {/* Main content — flex: 1 fills remaining space */}
      <div className="flex-1 min-w-0 flex flex-col min-h-screen transition-all duration-300">
        <MemoizedTopbar
          profile={profile}
          onMenuToggle={() => setSidebarOpen(!sidebarOpen)}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed(!collapsed)}
        />
        <main className="p-3 lg:p-5 flex-1 overflow-x-hidden">
          {children}
        </main>
      </div>

      {/* Session idle timeout warning — shown globally in authenticated layout */}
      <SessionTimeoutBanner />
    </div>
  );
}
