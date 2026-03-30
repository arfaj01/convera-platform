/**
 * CONVERA Notifications Service
 * In-app + Email notifications with Arabic RTL formatting
 * Handles all workflow triggers, SLA alerts, and governance notifications
 */

import { createBrowserSupabase } from '@/lib/supabase';
import type { Notification, NotificationType, UserRole, ClaimStatus } from '@/lib/types';
import { friendlyError } from '@/lib/errors';

// ─── Type Definitions ────────────────────────────────────────────

export interface NotificationInput {
  userId: string;
  type: NotificationType;
  titleAr: string;
  bodyAr: string;
  entityType: 'claim' | 'change_order' | 'contract';
  entityId: string;
}

export interface EmailData {
  recipientName: string;
  recipientEmail: string;
  subject: string;
  bodyAr: string;
  ctaLabel?: string;
  ctaUrl?: string;
  claimNo?: string | number;
  contractName?: string;
  currentStage?: string;
}

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  success: boolean;
}

function createResponse<T>(data?: T, error?: string): ApiResponse<T> {
  return { data, error, success: !error };
}

/** Create an error response with the correct generic type */
function createErrorResponse<T>(error: string): ApiResponse<T> {
  return { data: undefined as unknown as T, error, success: false };
}

// ─── In-App Notifications ───────────────────────────────────────

/**
 * Create an in-app notification
 */
export async function createNotification(input: NotificationInput): Promise<ApiResponse<Notification>> {
  try {
    const supabase = createBrowserSupabase();

    const { data, error } = await supabase
      .from('notifications')
      .insert({
        user_id: input.userId,
        type: input.type,
        title: input.titleAr,
        body: input.bodyAr,
        entity_type: input.entityType,
        entity_id: input.entityId,
        is_read: false,
      })
      .select()
      .single();

    if (error) throw error;
    return createResponse(data);
  } catch (error) {
    console.error('Failed to create notification:', error);
    return createErrorResponse(friendlyError(error));
  }
}

/**
 * Get all notifications for a user
 */
export async function getUserNotifications(
  userId: string,
  limit: number = 20,
): Promise<ApiResponse<Notification[]>> {
  try {
    const supabase = createBrowserSupabase();

    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return createResponse(data || []);
  } catch (error) {
    return createErrorResponse(friendlyError(error));
  }
}

/**
 * Mark a single notification as read
 */
export async function markAsRead(notificationId: string): Promise<ApiResponse<Notification>> {
  try {
    const supabase = createBrowserSupabase();

    const { data, error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notificationId)
      .select()
      .single();

    if (error) throw error;
    return createResponse(data);
  } catch (error) {
    return createErrorResponse(friendlyError(error));
  }
}

/**
 * Mark all notifications as read for a user
 */
export async function markAllAsRead(userId: string): Promise<ApiResponse<number>> {
  try {
    const supabase = createBrowserSupabase();

    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (error) throw error;
    return createResponse(0);
  } catch (error) {
    return createErrorResponse(friendlyError(error));
  }
}

/**
 * Get count of unread notifications
 */
export async function getUnreadCount(userId: string): Promise<ApiResponse<number>> {
  try {
    const supabase = createBrowserSupabase();

    const { data, error } = await supabase
      .from('notifications')
      .select('id')
      .eq('user_id', userId)
      .eq('is_read', false);

    if (error) throw error;
    return createResponse(data?.length || 0);
  } catch (error) {
    return createErrorResponse(friendlyError(error));
  }
}

// ─── Workflow Notifications ────────────────────────────────────

/**
 * Send notifications for claim workflow transitions
 * Automatically determines recipients based on new status
 */
export async function sendWorkflowNotification(
  claimId: string,
  claimNo: string | number,
  contractName: string,
  action: string,
  fromStatus: ClaimStatus,
  toStatus: ClaimStatus,
  actorId: string,
  actorName: string,
): Promise<ApiResponse<Notification[]>> {
  try {
    const supabase = createBrowserSupabase();
    const notifications: Notification[] = [];

    // Fetch claim details
    const { data: claim, error: claimErr } = await supabase
      .from('claims')
      .select('id, submitted_by, contract_id')
      .eq('id', claimId)
      .single();

    if (claimErr) throw claimErr;

    // Fetch contract details
    const { data: contract, error: contractErr } = await supabase
      .from('contracts')
      .select('id, director_id, admin_id, external_user_id')
      .eq('id', claim.contract_id)
      .single();

    if (contractErr) throw contractErr;

    // Determine notification type based on transition
    const typeMap: Record<ClaimStatus, NotificationType> = {
      submitted: 'claim_submitted',
      under_supervisor_review: 'claim_submitted',
      under_auditor_review: 'claim_submitted',
      under_reviewer_check: 'claim_submitted',
      pending_director_approval: 'claim_submitted',
      approved: 'claim_approved',
      rejected: 'claim_rejected',
      returned_by_supervisor: 'claim_returned',
      returned_by_auditor: 'claim_returned',
      draft: 'claim_submitted',
    };

    const notificationType = typeMap[toStatus] || 'claim_submitted';

    // Build notification messages
    const getStageAr = (status: ClaimStatus): string => {
      const stageMap: Record<ClaimStatus, string> = {
        draft: 'مسودة',
        submitted: 'مرسلة',
        under_supervisor_review: 'قيد المراجعة من جهة الإشراف',
        returned_by_supervisor: 'مرجعة من جهة الإشراف',
        under_auditor_review: 'قيد التدقيق',
        returned_by_auditor: 'مرجعة من المدقق',
        under_reviewer_check: 'قيد المراجعة',
        pending_director_approval: 'بانتظار الاعتماد',
        approved: 'معتمدة',
        rejected: 'مرفوضة',
      };
      return stageMap[status] || status;
    };

    let titleAr = '';
    let bodyAr = '';

    if (action === 'approve') {
      titleAr = `تم الموافقة على المطالبة #${claimNo}`;
      bodyAr = `تم الموافقة على المطالبة من قبل ${actorName}. العقد: ${contractName}. المرحلة: ${getStageAr(toStatus)}`;
    } else if (action === 'return') {
      titleAr = `تم إرجاع المطالبة #${claimNo}`;
      bodyAr = `تم إرجاع المطالبة من قبل ${actorName} للتعديل. العقد: ${contractName}`;
    } else if (action === 'reject') {
      titleAr = `تم رفض المطالبة #${claimNo}`;
      bodyAr = `تم رفض المطالبة من قبل ${actorName}. العقد: ${contractName}`;
    } else if (action === 'submit') {
      titleAr = `تم تقديم المطالبة #${claimNo}`;
      bodyAr = `تم تقديم المطالبة الجديدة من قبل ${actorName}. العقد: ${contractName}`;
    } else {
      titleAr = `تحديث المطالبة #${claimNo}`;
      bodyAr = `تم تحديث حالة المطالبة إلى ${getStageAr(toStatus)}. العقد: ${contractName}`;
    }

    // Determine recipients based on new status
    const recipientIds: string[] = [];

    if (
      toStatus === 'submitted' ||
      toStatus === 'under_supervisor_review'
    ) {
      // Notify contract supervisor
      if (contract.external_user_id) recipientIds.push(contract.external_user_id);
    }

    if (toStatus === 'under_auditor_review') {
      // Notify auditors (will be assigned via separate workflow)
      // For now, notify admin
      if (contract.admin_id) recipientIds.push(contract.admin_id);
    }

    if (toStatus === 'pending_director_approval') {
      // Notify director
      if (contract.director_id) recipientIds.push(contract.director_id);
    }

    if (toStatus.startsWith('returned')) {
      // Notify contractor who submitted
      if (claim.submitted_by) recipientIds.push(claim.submitted_by);
    }

    if (toStatus === 'approved') {
      // Notify contractor who submitted
      if (claim.submitted_by) recipientIds.push(claim.submitted_by);
    }

    if (toStatus === 'rejected') {
      // Notify contractor who submitted
      if (claim.submitted_by) recipientIds.push(claim.submitted_by);
    }

    // Create notifications for all recipients
    for (const recipientId of recipientIds) {
      const { data: notif, error: notifErr } = await supabase
        .from('notifications')
        .insert({
          user_id: recipientId,
          type: notificationType,
          title: titleAr,
          body: bodyAr,
          entity_type: 'claim',
          entity_id: claimId,
          is_read: false,
        })
        .select()
        .single();

      if (!notifErr && notif) {
        notifications.push(notif);

        // TODO: Send email notification (see buildEmailHtml)
        // This would be handled by a background job or edge function
      }
    }

    return createResponse(notifications);
  } catch (error) {
    console.error('Failed to send workflow notification:', error);
    return createErrorResponse(friendlyError(error));
  }
}

/**
 * Send SLA breach notifications (day 2 warning, day 3 escalation)
 */
export async function sendSLANotification(
  claimId: string,
  claimNo: string | number,
  contractName: string,
  daysElapsed: number,
): Promise<ApiResponse<Notification[]>> {
  try {
    const supabase = createBrowserSupabase();
    const notifications: Notification[] = [];

    // Fetch claim and contract for recipient info
    const { data: claim, error: claimErr } = await supabase
      .from('claims')
      .select('contract_id')
      .eq('id', claimId)
      .single();

    if (claimErr) throw claimErr;

    const { data: contract, error: contractErr } = await supabase
      .from('contracts')
      .select('director_id, admin_id, external_user_id')
      .eq('id', claim.contract_id)
      .single();

    if (contractErr) throw contractErr;

    let titleAr = '';
    let bodyAr = '';
    let notificationType: NotificationType = 'supervisor_sla_warning';

    if (daysElapsed >= 3) {
      titleAr = `تنبيه عاجل: تجاوز المطالبة #${claimNo} مدة الموافقة المحددة`;
      bodyAr = `المطالبة #${claimNo} للعقد ${contractName} تجاوزت مدة الموافقة البالغة 3 أيام عمل. يرجى التعامل الفوري.`;
      notificationType = 'supervisor_sla_escalation';

      // Notify director and admin
      const recipientIds = [contract.director_id, contract.admin_id].filter(Boolean);
      for (const recipientId of recipientIds) {
        const { data: notif } = await supabase
          .from('notifications')
          .insert({
            user_id: recipientId,
            type: notificationType,
            title: titleAr,
            body: bodyAr,
            entity_type: 'claim',
            entity_id: claimId,
            is_read: false,
          })
          .select()
          .single();

        if (notif) notifications.push(notif);
      }
    } else if (daysElapsed >= 2) {
      titleAr = `تنبيه: المطالبة #${claimNo} تقترب من انتهاء المدة المحددة`;
      bodyAr = `المطالبة #${claimNo} للعقد ${contractName} قيد الموافقة منذ يومين. يرجى المتابعة العاجلة.`;
      notificationType = 'supervisor_sla_warning';

      // Notify supervisor who is reviewing
      if (contract.external_user_id) {
        const { data: notif } = await supabase
          .from('notifications')
          .insert({
            user_id: contract.external_user_id,
            type: notificationType,
            title: titleAr,
            body: bodyAr,
            entity_type: 'claim',
            entity_id: claimId,
            is_read: false,
          })
          .select()
          .single();

        if (notif) notifications.push(notif);
      }
    }

    return createResponse(notifications);
  } catch (error) {
    console.error('Failed to send SLA notification:', error);
    return createErrorResponse(friendlyError(error));
  }
}

// ─── Email HTML Generation ──────────────────────────────────────

/**
 * Build RTL Arabic HTML email template
 * Uses MoMaH brand colors: #045859 (primary), #87BA26 (success)
 */
export function buildEmailHtml(emailData: EmailData): string {
  const {
    recipientName,
    subject,
    bodyAr,
    ctaLabel = 'عرض التفاصيل',
    ctaUrl = '#',
    claimNo,
    contractName,
    currentStage,
  } = emailData;

  return `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Tajawal', 'Arial', sans-serif;
      direction: rtl;
      line-height: 1.6;
      color: #1A1A2E;
    }
    .email-container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #FFFFFF;
      border: 1px solid #DDE2E8;
      border-radius: 8px;
      overflow: hidden;
    }
    .header {
      background-color: #045859;
      padding: 24px;
      text-align: right;
    }
    .header-logo {
      height: 40px;
      margin-bottom: 16px;
    }
    .header-title {
      color: #FFFFFF;
      font-size: 18px;
      font-weight: bold;
    }
    .header-subtitle {
      color: #87BA26;
      font-size: 12px;
      margin-top: 8px;
    }
    .content {
      padding: 32px 24px;
      text-align: right;
    }
    .greeting {
      font-size: 16px;
      margin-bottom: 24px;
      color: #1A1A2E;
    }
    .message {
      font-size: 14px;
      line-height: 1.8;
      margin-bottom: 24px;
      color: #54565B;
      padding: 16px;
      background-color: #F7F8FA;
      border-right: 4px solid #045859;
      border-radius: 4px;
    }
    .cta-button {
      display: inline-block;
      background-color: #87BA26;
      color: #FFFFFF;
      padding: 12px 32px;
      text-decoration: none;
      border-radius: 8px;
      font-weight: bold;
      font-size: 14px;
      margin: 24px 0;
    }
    .cta-button:hover {
      background-color: #7aa820;
    }
    .details {
      background-color: #F7F8FA;
      padding: 16px;
      margin: 24px 0;
      border-radius: 8px;
    }
    .detail-row {
      display: flex;
      flex-direction: row-reverse;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #DDE2E8;
    }
    .detail-row:last-child {
      border-bottom: none;
    }
    .detail-label {
      font-weight: bold;
      color: #1A1A2E;
    }
    .detail-value {
      color: #54565B;
    }
    .footer {
      background-color: #F7F8FA;
      padding: 20px 24px;
      text-align: right;
      border-top: 1px solid #DDE2E8;
    }
    .footer-text {
      font-size: 12px;
      color: #54565B;
      margin-bottom: 8px;
    }
    .footer-link {
      color: #045859;
      text-decoration: none;
    }
    .footer-link:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="email-container">
    <!-- Header -->
    <div class="header">
      <div class="header-title">منصة CONVERA</div>
      <div class="header-subtitle">وزارة البلديات والإسكان — إدارة التطوير والتأهيل</div>
    </div>

    <!-- Content -->
    <div class="content">
      <div class="greeting">السادة / ${recipientName}</div>
      <div class="greeting">تحية طيبة وبعد،</div>

      <div class="message">${bodyAr}</div>

      <a href="${ctaUrl}" class="cta-button">${ctaLabel}</a>

      <!-- Details Section -->
      <div class="details">
        ${claimNo ? `
        <div class="detail-row">
          <span class="detail-label">رقم المطالبة:</span>
          <span class="detail-value">${claimNo}</span>
        </div>
        ` : ''}
        ${contractName ? `
        <div class="detail-row">
          <span class="detail-label">العقد:</span>
          <span class="detail-value">${contractName}</span>
        </div>
        ` : ''}
        ${currentStage ? `
        <div class="detail-row">
          <span class="detail-label">المرحلة الحالية:</span>
          <span class="detail-value">${currentStage}</span>
        </div>
        ` : ''}
        <div class="detail-row">
          <span class="detail-label">التاريخ:</span>
          <span class="detail-value">${new Date().toLocaleDateString('ar-SA')}</span>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div class="footer">
      <div class="footer-text">مع التحية،</div>
      <div class="footer-text"><strong>منصة CONVERA — إدارة التطوير والتأهيل</strong></div>
      <div class="footer-text">
        <a href="https://momah.gov.sa" class="footer-link">momah.gov.sa</a>
        | سري للاستخدام الداخلي
      </div>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Send email notification (calls backend)
 * Backend handles actual email sending via SendGrid, Postmark, etc.
 */
export async function sendEmailNotification(emailData: EmailData): Promise<ApiResponse<{ sent: boolean }>> {
  try {
    const response = await fetch('/api/notifications/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientEmail: emailData.recipientEmail,
        subject: emailData.subject,
        html: buildEmailHtml(emailData),
      }),
    });

    const result = await response.json();
    if (!response.ok) {
      return createErrorResponse<{ sent: boolean }>(result.error || 'فشل في إرسال البريد الإلكتروني');
    }

    return createResponse({ sent: true });
  } catch (error) {
    console.error('Failed to send email:', error);
    return createErrorResponse(friendlyError(error));
  }
}
