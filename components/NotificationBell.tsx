'use client';

/**
 * NotificationBell — In-app notification center
 *
 * Renders a bell icon in the Topbar with:
 * - Unread count badge
 * - Dropdown list of recent notifications
 * - Click to mark as read + navigate to entity
 * - "Mark all read" action
 * - Polling every 60 seconds for new notifications
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getAuthHeaders } from '@/lib/supabase';

// ─── Types ────────────────────────────────────────────────────────

interface Notification {
  id:          string;
  type:        string;
  title:       string;
  body:        string | null;
  entity_type: string | null;
  entity_id:   string | null;
  is_read:     boolean;
  created_at:  string;
}

// ─── Time formatter ───────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const now   = Date.now();
  const then  = new Date(dateStr).getTime();
  const diffMs = now - then;
  const mins   = Math.floor(diffMs / 60_000);
  const hours  = Math.floor(mins / 60);
  const days   = Math.floor(hours / 24);

  if (days > 0)  return `منذ ${days} يوم`;
  if (hours > 0) return `منذ ${hours} ساعة`;
  if (mins > 1)  return `منذ ${mins} دقيقة`;
  return 'الآن';
}

// ─── Notification type icons ──────────────────────────────────────

function notifIcon(type: string): string {
  if (type.includes('approved')) return '✅';
  if (type.includes('return'))   return '↩️';
  if (type.includes('reject'))   return '❌';
  if (type.includes('submit'))   return '📤';
  if (type.includes('sla'))      return '⏰';
  if (type.includes('change'))   return '📝';
  return '🔔';
}

// ─── Entity navigation ────────────────────────────────────────────

function entityPath(type: string | null, id: string | null): string | null {
  if (!type || !id) return null;
  if (type === 'claim')        return `/claims/${id}`;
  if (type === 'contract')     return `/contracts/${id}`;
  if (type === 'change_order') return `/change-orders/${id}`;
  return null;
}

// ─── Component ───────────────────────────────────────────────────

export default function NotificationBell() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount,   setUnreadCount]   = useState(0);
  const [open,          setOpen]          = useState(false);
  const [loading,       setLoading]       = useState(false);
  const dropdownRef  = useRef<HTMLDivElement>(null);
  const pollInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch notifications ─────────────────────────────────────────
  const fetchNotifications = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      if (!headers.Authorization) return;

      const res = await fetch('/api/notifications', { headers });
      if (!res.ok) return;

      const json = await res.json();
      setNotifications(json.data?.notifications ?? []);
      setUnreadCount(json.data?.unread_count ?? 0);
    } catch {
      // Silently ignore — bell is non-critical
    }
  }, []);

  // ── Auto-poll every 60s ─────────────────────────────────────────
  useEffect(() => {
    fetchNotifications();
    pollInterval.current = setInterval(fetchNotifications, 60_000);
    return () => {
      if (pollInterval.current) clearInterval(pollInterval.current);
    };
  }, [fetchNotifications]);

  // ── Close dropdown on outside click ────────────────────────────
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  // ── Mark single notification read ──────────────────────────────
  async function markRead(notif: Notification) {
    if (!notif.is_read) {
      try {
        const headers = await getAuthHeaders();
        await fetch(`/api/notifications/${notif.id}`, {
          method: 'PATCH',
          headers,
        });
        setNotifications(prev =>
          prev.map(n => n.id === notif.id ? { ...n, is_read: true } : n),
        );
        setUnreadCount(c => Math.max(0, c - 1));
      } catch { /* non-critical */ }
    }

    // Navigate to entity if applicable
    const path = entityPath(notif.entity_type, notif.entity_id);
    if (path) {
      setOpen(false);
      router.push(path);
    }
  }

  // ── Mark all read ───────────────────────────────────────────────
  async function markAllRead() {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      await fetch('/api/notifications/read-all', {
        method: 'POST',
        headers,
      });
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch { /* non-critical */ } finally {
      setLoading(false);
    }
  }

  // ─── Render ───────────────────────────────────────────────────
  return (
    <div className="relative" ref={dropdownRef} dir="rtl">
      {/* Bell button */}
      <button
        onClick={() => { setOpen(v => !v); if (!open) fetchNotifications(); }}
        className="relative p-2 rounded-lg hover:bg-white/10 transition-colors"
        aria-label="الإشعارات"
      >
        <span className="text-xl leading-none">🔔</span>
        {unreadCount > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-[0.58rem] font-black text-white"
            style={{ background: '#C05728', padding: '0 3px' }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full mt-2 end-0 z-50 w-80 bg-white rounded-xl shadow-2xl border border-gray-100 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <span className="text-sm font-black text-teal-dark">الإشعارات</span>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                disabled={loading}
                className="text-[0.68rem] font-bold text-teal hover:text-teal-dark transition-colors disabled:opacity-50"
              >
                {loading ? '...' : 'تعيين الكل كمقروء'}
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
            {notifications.length === 0 ? (
              <div className="py-10 text-center">
                <div className="text-3xl mb-2">🔔</div>
                <p className="text-xs text-gray-400">لا توجد إشعارات</p>
              </div>
            ) : (
              notifications.slice(0, 20).map(notif => (
                <button
                  key={notif.id}
                  onClick={() => markRead(notif)}
                  className={`w-full text-right px-4 py-3 hover:bg-gray-50 transition-colors flex items-start gap-3 ${
                    !notif.is_read ? 'bg-teal-ultra' : ''
                  }`}
                >
                  <span className="text-base leading-none mt-0.5 flex-shrink-0">
                    {notifIcon(notif.type)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs leading-snug ${!notif.is_read ? 'font-black text-gray-900' : 'font-bold text-gray-700'}`}>
                      {notif.title}
                    </p>
                    {notif.body && (
                      <p className="text-[0.65rem] text-gray-400 mt-0.5 line-clamp-2">
                        {notif.body}
                      </p>
                    )}
                    <p className="text-[0.6rem] text-gray-300 mt-1">
                      {timeAgo(notif.created_at)}
                    </p>
                  </div>
                  {!notif.is_read && (
                    <div className="w-2 h-2 rounded-full bg-teal flex-shrink-0 mt-1.5" />
                  )}
                </button>
              ))
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="px-4 py-2.5 border-t border-gray-100 text-center">
              <button
                onClick={() => { setOpen(false); router.push('/notifications'); }}
                className="text-[0.68rem] font-bold text-teal hover:text-teal-dark transition-colors"
              >
                عرض كل الإشعارات
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
