'use client';

/**
 * (print) Route Group Layout
 *
 * Minimal authenticated layout with no sidebar or topbar.
 * Used for print-optimized pages (certificates, reports).
 * Redirects to /login if session is missing.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';

export default function PrintLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [loading, user, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <p className="text-sm text-gray-400 animate-pulse">جاري التحميل...</p>
      </div>
    );
  }

  if (!user) return null;

  return <>{children}</>;
}
