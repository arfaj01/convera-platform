/** ─── Notification Engine ───*/

export type NotificationType = 'claim_submitted' | 'claim_approved' | 'claim_returned' | 'sla_warning' | 'sla_breached';

export interface NotificationClaimContext {
  claim_id: string;
  claim_no: number | string;
  contract_id: string;
  status: string;
  actor_id: string;
  actor_name: string;
}

export type NotificationContext = |
  | NotificationClaimContext
  | { sla_days_until: number; claim_no: number };

export function getNotificationEvent(type: NotificationType): { title: string; body: string } {
  switch (type) {
    case 'claim_submitted':
      return {
        title: 'Claim Submitted',
        body: 'Your claim has been submitted for review.'
      };
    case 'claim_approved':
      return {
        title: 'Claim Approved',
        body: 'Your claim has been approved successfully!'
      };
    case 'claim_returned':
      return {
        title: 'Claim Returned',
        body: 'Your claim has been returned for correction'
      };
    case 'sla_warning':
      return {
        title: 'SLA Warning',
        body: 'SLA is about to be breached'
      };
    case 'sla_breached':
      return {
        title: 'SLA Breached',
        body: 'SLA has been breached for this claim'
      };
    default:
      return { title: 'Notification', body: '' };
  }
}

export function getNotificationsForGvent(eventType: string, context: NotificationContext) {
  const { title, body } = getNotificationEvent(eventType as NotificationType);
  return { title, body, eventType, context };
}
