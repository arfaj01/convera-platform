import { supabase } from '@/lib/supabase';
import type { Notification } from '@/lib/types';

export async function getUserNotifications(userId: string) {
  const { data, error } = await supabase.from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false });
  return { data, error };
}

export async function createNotification(userId: string, type: string, title: string, body: string, entityType: string, entityId: string) {
  const { data, error } = await supabase.from('notifications').insert({
    user_id: userId,
    type,
    title,
    body,
    entity_type: entityType,
    entity_id: entityId,
    is_read: false,
  }).select().single();
  return { data, error };
}

export async function markNotificationAsRead(notificationId: string) {
  const { data, error } = await supabase.from('notifications').update({ is_read: true }).eq('id', notificationId).select();
  return { data, error };
}

export async function markAllNotificationsAsRead(userId: string) {
  const { data, error } = await supabase.from('notifications').update({ is_read: true }).eq('user_id', userId).select();
  return { data, error };
}