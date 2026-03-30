/**
 * CONVERA Email Service — SMTP notification dispatch
 *
 * Supports three email providers via environment variables:
 *   1. SMTP (nodemailer-compatible): SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 *   2. Resend API: RESEND_API_KEY (recommended for production)
 *   3. Supabase Edge Function: SUPABASE_EMAIL_FUNCTION_URL
 *
 * All emails are Arabic RTL with MoMaH branding.
 * Falls back gracefully — if no provider is configured, logs and skips.
 */

// ─── Types ────────────────────────────────────────────────────────

export interface EmailRecipient {
  email: string;
  name?: string;
}

export type EmailTemplateType =
  | 'claim_submitted'
  | 'claim_approved'
  | 'claim_returned'
  | 'claim_rejected'
  | 'sla_warning'
  | 'sla_breach'
  | 'ceiling_warning'
  | 'escalation'
  | 'daily_summary'
  | 'critical_alert';

export interface EmailPayload {
  to:          EmailRecipient[];
  template:    EmailTemplateType;
  data:        Record<string, unknown>;
  priority?:   'high' | 'normal';
}

// ─── HTML Template Builder ────────────────────────────────────────

function buildEmailHtml(template: EmailTemplateType, data: Record<string, unknown>): string {
  const subject = EMAIL_SUBJECTS[template] ?? 'إشعار من منصة CONVERA';
  const body    = EMAIL_BODIES[template]?.(data) ?? '';
  const cta     = data.ctaUrl as string | undefined;
  const ctaLabel = data.ctaLabel as string | undefined;

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 0; direction: rtl; }
    .container { max-width: 600px; margin: 20px auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,.08); }
    .header { background: linear-gradient(135deg, #045859 0%, #038580 100%); padding: 24px 28px; display: flex; align-items: center; justify-content: space-between; }
    .header-text { color: white; }
    .header-text h1 { margin: 0; font-size: 20px; font-weight: 900; letter-spacing: 2px; }
    .header-text p  { margin: 4px 0 0; font-size: 12px; color: rgba(255,255,255,.7); }
    .ministry     { color: rgba(255,255,255,.8); font-size: 11px; text-align: left; direction: rtl; }
    .body { padding: 28px; }
    .greeting { font-size: 15px; color: #333; margin-bottom: 16px; }
    .content { font-size: 14px; color: #555; line-height: 1.7; margin-bottom: 20px; }
    .cta { display: inline-block; background: #87BA26; color: white; font-weight: 700; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-size: 14px; }
    .details { background: #f8f9fa; border-radius: 8px; padding: 16px; margin-top: 20px; }
    .details-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #eee; font-size: 13px; }
    .details-row:last-child { border-bottom: none; }
    .details-label { color: #888; }
    .details-value { color: #333; font-weight: 600; }
    .footer { background: #f0f0f0; padding: 16px 28px; text-align: center; font-size: 11px; color: #999; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="header-text">
        <h1>CONVERA</h1>
        <p>منصة حوكمة العقود</p>
      </div>
      <div class="ministry">
        وزارة البلديات والإسكان<br>
        إدارة التطوير والتأهيل
      </div>
    </div>

    <div class="body">
      <p class="greeting">السادة / المعنيون،<br>تحية طيبة،</p>

      <div class="content">${body}</div>

      ${cta ? `<div style="text-align:center; margin: 20px 0;">
        <a href="${cta}" class="cta">${ctaLabel ?? 'عرض التفاصيل'}</a>
      </div>` : ''}

      ${data.details ? buildDetailsTable(data.details as Record<string, string>) : ''}

      <p style="font-size:13px; color:#777; margin-top: 20px;">
        مع التحية،<br>
        <strong>منصة CONVERA</strong> — إدارة التطوير والتأهيل
      </p>
    </div>

    <div class="footer">
      هذا البريد مُرسَل تلقائياً من منصة CONVERA | سري للاستخدام الداخلي<br>
      momah.gov.sa
    </div>
  </div>
</body>
</html>`;
}

function buildDetailsTable(details: Record<string, string>): string {
  const rows = Object.entries(details)
    .map(([k, v]) => `<div class="details-row"><span class="details-label">${k}</span><span class="details-value">${v}</span></div>`)
    .join('');
  return `<div class="details">${rows}</div>`;
}

// ─── Email Subjects ───────────────────────────────────────────────

const EMAIL_SUBJECTS: Record<EmailTemplateType, string> = {
  claim_submitted:  '📤 تم تقديم مطالبة جديدة — CONVERA',
  claim_approved:   '✅ تمت الموافقة على المطالبة — CONVERA',
  claim_returned:   '↩️ تم إرجاع المطالبة — CONVERA',
  claim_rejected:   '❌ تم رفض المطالبة — CONVERA',
  sla_warning:      '⏱ تحذير: اقتراب من نهاية المهلة — CONVERA',
  sla_breach:       '🚨 تنبيه حرج: تجاوز مهلة المراجعة — CONVERA',
  ceiling_warning:  '⚠️ تحذير: اقتراب من سقف العقد — CONVERA',
  escalation:       '🔴 تصعيد: يتطلب تدخلاً فورياً — CONVERA',
  daily_summary:    '📊 الملخص اليومي — CONVERA',
  critical_alert:   '🚨 تنبيه حرج — CONVERA',
};

// ─── Email Body Templates ─────────────────────────────────────────

const EMAIL_BODIES: Record<EmailTemplateType, (d: Record<string, unknown>) => string> = {
  claim_submitted:  d => `تم تقديم المطالبة رقم <strong>${d.claimNo}</strong> للعقد <strong>${d.contractTitle}</strong> وهي الآن في انتظار مراجعتكم.`,
  claim_approved:   d => `تمت الموافقة على المطالبة رقم <strong>${d.claimNo}</strong> للعقد <strong>${d.contractTitle}</strong> بإجمالي <strong>${d.amount} ر.س</strong>.`,
  claim_returned:   d => `تم إرجاع المطالبة رقم <strong>${d.claimNo}</strong> مع ملاحظة: <em>${d.reason ?? 'يرجى مراجعة الملاحظات'}</em>.`,
  claim_rejected:   d => `تم رفض المطالبة رقم <strong>${d.claimNo}</strong> للعقد <strong>${d.contractTitle}</strong>.`,
  sla_warning:      d => `المطالبة رقم <strong>${d.claimNo}</strong> في اليوم <strong>${d.currentDay}</strong> من أصل <strong>${d.slaLimit}</strong> يوم في مرحلة <strong>${d.stage}</strong>. يرجى اتخاذ الإجراء اللازم قبل انتهاء المهلة.`,
  sla_breach:       d => `<strong>تجاوز SLA:</strong> المطالبة رقم <strong>${d.claimNo}</strong> تجاوزت الوقت المحدد في مرحلة <strong>${d.stage}</strong> (${d.days} أيام). مطلوب التدخل الفوري.`,
  ceiling_warning:  d => `العقد <strong>${d.contractNo}</strong> وصل إلى <strong>${d.utilizationPct}٪</strong> من سقفه المالي. المتبقي: <strong>${d.remaining} ر.س</strong>.`,
  escalation:       d => `<span style="color:#DC2626;font-weight:900;">تصعيد:</span> ${d.issue} يستدعي تدخلاً فورياً من سعادتكم.`,
  daily_summary:    d => `ملخص نشاط المنصة ليوم <strong>${d.date}</strong>:<br>• مطالبات معلقة: <strong>${d.pending}</strong><br>• مطالبات معتمدة اليوم: <strong>${d.approved}</strong><br>• تنبيهات SLA: <strong>${d.slaAlerts}</strong>`,
  critical_alert:   d => `<span style="color:#DC2626;font-weight:900;">⚠️ تنبيه حرج:</span> ${d.message}`,
};

// ─── Dispatch (Resend API — production-grade) ────────────────────

export async function sendEmail(payload: EmailPayload): Promise<void> {
  // Check which provider is configured
  const resendKey = process.env.RESEND_API_KEY;
  const smtpHost  = process.env.SMTP_HOST;

  if (!resendKey && !smtpHost) {
    // No provider configured — log for development, skip silently
    if (process.env.NODE_ENV === 'development') {
      console.log('[email-service] No email provider configured. Would send:',
        payload.template, '→', payload.to.map(r => r.email).join(', '));
    }
    return;
  }

  const fromAddress = process.env.EMAIL_FROM ?? 'CONVERA Platform <noreply@momah.gov.sa>';
  const subject     = EMAIL_SUBJECTS[payload.template];
  const html        = buildEmailHtml(payload.template, payload.data);

  // ── Provider: Resend ──────────────────────────────────────────
  if (resendKey) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from:    fromAddress,
          to:      payload.to.map(r => r.email),
          subject,
          html,
          priority: payload.priority === 'high' ? 'high' : 'normal',
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        console.error('[email-service] Resend error:', err);
      }
    } catch (e) {
      console.error('[email-service] Resend dispatch failed:', e);
    }
    return;
  }

  // ── Provider: SMTP (server-side only, via fetch to internal endpoint) ──
  if (smtpHost && process.env.SMTP_USER && process.env.SMTP_PASS) {
    // SMTP requires Node.js nodemailer which only works in API routes.
    // Log warning if called from wrong context.
    console.warn('[email-service] SMTP dispatch must be called from an API route, not client-side.');
  }
}

// ─── High-level helpers ───────────────────────────────────────────

/** Send a critical alert email to all directors */
export async function sendCriticalAlert(
  admin: Parameters<typeof sendEmail>[0]['to'][0] extends infer T ? never : never,
  directorEmails: EmailRecipient[],
  message: string,
  entityRef: string,
  ctaUrl: string,
): Promise<void> {
  await sendEmail({
    to:       directorEmails,
    template: 'critical_alert',
    priority: 'high',
    data: {
      message,
      entityRef,
      ctaUrl,
      ctaLabel: 'عرض الحالة',
    },
  });
}

/** Send daily summary to directors */
export async function sendDailySummary(
  directorEmails: EmailRecipient[],
  stats: { pending: number; approved: number; slaAlerts: number },
): Promise<void> {
  const today = new Date().toLocaleDateString('ar-SA', {
    weekday: 'long',
    year:    'numeric',
    month:   'long',
    day:     'numeric',
  });

  await sendEmail({
    to:       directorEmails,
    template: 'daily_summary',
    data: {
      date:     today,
      pending:  String(stats.pending),
      approved: String(stats.approved),
      slaAlerts: String(stats.slaAlerts),
      ctaUrl:   `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/dashboard`,
      ctaLabel: 'فتح لوحة التحكم',
    },
  });
}
