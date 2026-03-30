/**
 * CONVERA Webhook Emitter — Phase 7: Integration Layer
 *
 * Emits structured events to configured webhook endpoints whenever
 * key domain events occur (claim transitions, contract updates, etc.)
 *
 * Configuration: WEBHOOK_SECRET + WEBHOOK_URL in environment variables
 * Signature: HMAC-SHA256 of payload, in X-Convera-Signature header
 * Retry: fire-and-forget (non-blocking, failures are logged only)
 *
 * Supported events:
 *   claim.submitted
 *   claim.approved
 *   claim.returned
 *   claim.rejected
 *   contract.created
 *   contract.updated
 *   change_order.approved
 *   sla.breached
 */

// ─── Types ────────────────────────────────────────────────────────

export type WebhookEventType =
  | 'claim.submitted'
  | 'claim.approved'
  | 'claim.returned'
  | 'claim.rejected'
  | 'contract.created'
  | 'contract.updated'
  | 'change_order.approved'
  | 'sla.breached';

export interface WebhookPayload {
  event:      WebhookEventType;
  timestamp:  string;           // ISO 8601
  version:    string;           // payload schema version
  data:       Record<string, unknown>;
}

// ─── HMAC Signature ───────────────────────────────────────────────

async function sign(payload: string, secret: string): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return '';

  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const msgData = encoder.encode(payload);

  const key = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );

  const signature = await crypto.subtle.sign('HMAC', key, msgData);
  const hex = Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return `sha256=${hex}`;
}

// ─── Emitter ──────────────────────────────────────────────────────

/**
 * Emits a webhook event. Fire-and-forget — never blocks the caller.
 * Safe to call from any API route or server function.
 */
export async function emitWebhook(
  event: WebhookEventType,
  data: Record<string, unknown>,
): Promise<void> {
  const webhookUrl    = process.env.WEBHOOK_URL;
  const webhookSecret = process.env.WEBHOOK_SECRET;

  if (!webhookUrl) return; // Webhooks not configured — skip silently

  const payload: WebhookPayload = {
    event,
    timestamp: new Date().toISOString(),
    version:   '1.0',
    data,
  };

  const body = JSON.stringify(payload);

  // Build headers
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Convera-Event': event,
    'X-Convera-Version': '1.0',
  };

  if (webhookSecret) {
    try {
      headers['X-Convera-Signature'] = await sign(body, webhookSecret);
    } catch { /* non-critical */ }
  }

  // Fire async — do NOT await so caller is never blocked
  fetch(webhookUrl, { method: 'POST', headers, body })
    .then(async res => {
      if (!res.ok) {
        console.warn(`[webhook] ${event} → ${res.status} ${res.statusText}`);
      }
    })
    .catch(err => {
      console.warn(`[webhook] ${event} failed:`, err?.message ?? err);
    });
}
