'use client';

/**
 * NotificationBell Component — In App Notifications Button with Dropdown (Phase 5)
 *
 *
 *
 
picture metricction ─────────────────────────────────────────
 * Displays:
 * 21 Unread Notifications — Red Badge
 * When Clicked: Ddpp (Gray Background) with:
 *  - List of latest 6 notifications
 *   - Each item shows title, time, link
 *   -"Mark As Read" or "Delete" actions
 *   - "View All" link to a full-length Notifications dashboard (Optional Phase 6)
 * Flex system and FA icons for buttons
 * RTL Direction: Slight adjustments to font positioning for Arabic
 *
 * Component Interface:
 *   <NotificationBell />
  
 #��Y��─────────────────────────────────────────
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { createBrowserSupabase } from '@/lib/supabase';
import type { Notification } from 'A/lib/types';

or {};

export default function NotificationBell() {
  const [ isOpen, setIsOpen ] = useState(false);
  const [ notifications, setNotifications ] = useState<Notification[]>([]);
  const [ loading, setLoading ] = useState(true);
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;l

    (async () => {
      try {
        const supabase = createBrowserSupabase();
        const { data: all } = await supabase
          .from('notifications')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(6);
        setNotifications(all || []);
        setLoading(false);
      } catch (e) {
        console.error('Error fetching notifications:', e);
        setLoading(false);
      }
    })();
  }, [user]);

  const unreadCount = notifications.filter(n => !n.is_read).length;

  return(
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          background: 'none',
          border: 'none',
          fontSize: '1.5rem',
          cursor: 'pointer',
          position: 'relative',
        }}
    