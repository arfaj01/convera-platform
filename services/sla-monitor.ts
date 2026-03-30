/**
 * CONVERA SLA Monitoring Service
 * Monitors supervisor review SLA (3 working days)
 * Sends warnings at day 2 and escalates at day 3
 */

import { createBrowserSupabase } from '@/lib/supabase';
import { sendSLANotification } from './notifications';
import { friendlyError } from '@/lib/errors';

// ─── Type Definitions ────────────────────────────────────────────

export interface SLAStatus {
  claimId: string;
  claimNo: number;
  contractName: string;
  daysElapsed: number;
  hoursElapsed: number;
  hoursUntilWarning: number;
  hoursUntilEscalation: number;
  isWarningTriggered: boolean;
  isEscalationTriggered: boolean;
  isBreached: boolean;
  startDate: string;
  warningDate: string;
  escalationDate: string;
}

export interface SLAReport {
  totalClaimsInSupervisorReview: number;
  claimsApproachingWarning: SLAStatus[]; // 1.5-2 days
  claimsWarningTriggered: SLAStatus[]; // 2+ days
  claimsEscalated: SLAStatus[]; // 3+ days
  claimsBreached: SLAStatus[]; // 3+ days
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

// ─── SLA Constants ──────────────────────────────────────────────

const SUPERVISOR_SLA_DAYS = 3;
const SUPERVISOR_SLA_HOURS = SUPERVISOR_SLA_DAYS * 24;
const WARNING_THRESHOLD_HOURS = 48; // Day 2
const ESCALATION_THRESHOLD_HOURS = 72; // Day 3

// ─── Helper Functions ───────────────────────────────────────────

/**
 * Calculate business days elapsed (excluding weekends)
 * In Saudi Arabia: weekends are Friday-Saturday
 */
function getBusinessDaysElapsed(startDate: Date, endDate: Date): number {
  let businessDays = 0;
  let current = new Date(startDate);
  current.setHours(0, 0, 0, 0);

  while (current < endDate) {
    const dayOfWeek = current.getDay();
    // Friday (5) and Saturday (6) are weekend in Saudi Arabia
    if (dayOfWeek !== 5 && dayOfWeek !== 6) {
      businessDays++;
    }
    current.setDate(current.getDate() + 1);
  }

  return businessDays;
}

/**
 * Calculate hours elapsed
 */
function getHoursElapsed(startDate: Date, endDate: Date): number {
  const diff = endDate.getTime() - startDate.getTime();
  return Math.floor(diff / (1000 * 60 * 60));
}

// ─── SLA Monitoring ────────────────────────────────────────────

/**
 * Check SLA status for all claims in supervisor review
 */
export async function checkAllSLABreaches(): Promise<ApiResponse<SLAStatus[]>> {
  try {
    const supabase = createBrowserSupabase();

    const { data: claims, error } = await supabase
      .from('claims')
      .select(
        `
        id, claim_no, status, submitted_at, created_at,
        contracts(id, title_ar, title)
      `,
      )
      .eq('status', 'under_supervisor_review')
      .order('submitted_at', { ascending: true });

    if (error) throw error;

    const now = new Date();
    const slaStatuses: SLAStatus[] = [];

    for (const claim of claims || []) {
      const startDate = new Date(claim.submitted_at || claim.created_at);
      const hoursElapsed = getHoursElapsed(startDate, now);
      const businessDaysElapsed = getBusinessDaysElapsed(startDate, now);

      const warningDate = new Date(startDate);
      warningDate.setHours(warningDate.getHours() + WARNING_THRESHOLD_HOURS);

      const escalationDate = new Date(startDate);
      escalationDate.setHours(escalationDate.getHours() + ESCALATION_THRESHOLD_HOURS);

      const isWarningTriggered = hoursElapsed >= WARNING_THRESHOLD_HOURS;
      const isEscalationTriggered = hoursElapsed >= ESCALATION_THRESHOLD_HOURS;
      const isBreached = hoursElapsed >= ESCALATION_THRESHOLD_HOURS;

      slaStatuses.push({
        claimId: claim.id,
        claimNo: claim.claim_no,
        contractName: (claim.contracts as any)?.title_ar || (claim.contracts as any)?.title || '',
        daysElapsed: businessDaysElapsed,
        hoursElapsed,
        hoursUntilWarning: Math.max(0, WARNING_THRESHOLD_HOURS - hoursElapsed),
        hoursUntilEscalation: Math.max(0, ESCALATION_THRESHOLD_HOURS - hoursElapsed),
        isWarningTriggered,
        isEscalationTriggered,
        isBreached,
        startDate: startDate.toISOString(),
        warningDate: warningDate.toISOString(),
        escalationDate: escalationDate.toISOString(),
      });
    }

    return createResponse(slaStatuses);
  } catch (error) {
    console.error('Failed to check SLA breaches:', error);
    return createErrorResponse(friendlyError(error));
  }
}

/**
 * Process SLA alerts and send notifications
 * This should be called periodically (e.g., every hour via cron/edge function)
 */
export async function processSLAAlerts(): Promise<ApiResponse<{
  warningsProcessed: number;
  escalationsProcessed: number;
}>> {
  try {
    const supabase = createBrowserSupabase();
    const { data: slaStatuses, error: slaErr } = await checkAllSLABreaches();

    if (slaErr) throw new Error(slaErr);

    let warningsProcessed = 0;
    let escalationsProcessed = 0;

    for (const status of slaStatuses || []) {
      // Check if warning has already been sent
      if (status.isWarningTriggered && !status.isEscalationTriggered) {
        const { data: existingWarning } = await supabase
          .from('claim_workflow')
          .select('id')
          .eq('claim_id', status.claimId)
          .eq('action', 'sla_warning')
          .single();

        if (!existingWarning) {
          // Send warning notification
          const result = await sendSLANotification(
            status.claimId,
            status.claimNo,
            status.contractName,
            2, // days
          );

          if (result && result.success && result.data) {
            // Log the warning action
            await supabase.from('claim_workflow').insert({
              claim_id: status.claimId,
              action: 'sla_warning',
              from_status: 'under_supervisor_review',
              to_status: 'under_supervisor_review',
              actor_id: 'system',
              notes: 'تنبيه SLA: تجاوز يومين على الموافقة',
            });

            warningsProcessed++;
          }
        }
      }

      // Check if escalation has already been sent
      if (status.isEscalationTriggered) {
        const { data: existingEscalation } = await supabase
          .from('claim_workflow')
          .select('id')
          .eq('claim_id', status.claimId)
          .eq('action', 'sla_escalation')
          .single();

        if (!existingEscalation) {
          // Send escalation notification
          const result = await sendSLANotification(
            status.claimId,
            status.claimNo,
            status.contractName,
            3, // days
          );

          if (result && result.success && result.data) {
            // Log the escalation action
            await supabase.from('claim_workflow').insert({
              claim_id: status.claimId,
              action: 'sla_escalation',
              from_status: 'under_supervisor_review',
              to_status: 'under_supervisor_review',
              actor_id: 'system',
              notes: 'تنبيه عاجل: تجاوز 3 أيام على الموافقة — تصعيد للمدير',
            });

            // Mark claim as SLA breached (if you have such a field)
            // For now, we're using the workflow log

            escalationsProcessed++;
          }
        }
      }
    }

    return createResponse({
      warningsProcessed,
      escalationsProcessed,
    });
  } catch (error) {
    console.error('Failed to process SLA alerts:', error);
    return createErrorResponse(friendlyError(error));
  }
}

/**
 * Get comprehensive SLA report
 */
export async function getSLAReport(): Promise<ApiResponse<SLAReport>> {
  try {
    const { data: statuses, error } = await checkAllSLABreaches();

    if (error) throw new Error(error);

    const report: SLAReport = {
      totalClaimsInSupervisorReview: statuses?.length || 0,
      claimsApproachingWarning: [],
      claimsWarningTriggered: [],
      claimsEscalated: [],
      claimsBreached: [],
    };

    for (const status of statuses || []) {
      if (status.isEscalationTriggered) {
        report.claimsEscalated.push(status);
        report.claimsBreached.push(status);
      } else if (status.isWarningTriggered) {
        report.claimsWarningTriggered.push(status);
      } else if (status.hoursUntilWarning <= 24) {
        // Approaching warning (within 24 hours)
        report.claimsApproachingWarning.push(status);
      }
    }

    return createResponse(report);
  } catch (error) {
    console.error('Failed to get SLA report:', error);
    return createErrorResponse(friendlyError(error));
  }
}

/**
 * Schedule SLA check to run periodically
 * This function should be called from a Next.js API route or edge function
 * or integrated with a background job runner
 */
export async function scheduleSLACheck(): Promise<ApiResponse<{ success: boolean }>> {
  try {
    // This would typically be called via:
    // 1. A Next.js API route endpoint (manual trigger)
    // 2. A scheduled task/cron job
    // 3. An edge function
    // 4. A Supabase cron extension (future)

    const { data, error } = await processSLAAlerts();

    if (error) throw new Error(error);

    console.log(`SLA check completed: ${data?.warningsProcessed} warnings, ${data?.escalationsProcessed} escalations`);

    return createResponse({ success: true });
  } catch (error) {
    console.error('Failed to schedule SLA check:', error);
    return createErrorResponse(friendlyError(error));
  }
}

/**
 * Get dashboard summary of SLA status
 * Returns high-level metrics for the dashboard
 */
export async function getDashboardSLASummary(): Promise<ApiResponse<{
  totalAtRisk: number;
  warningCount: number;
  escalationCount: number;
  onTrack: number;
}>> {
  try {
    const { data: report, error } = await getSLAReport();

    if (error) throw new Error(error);

    return createResponse({
      totalAtRisk: (report?.claimsApproachingWarning.length || 0) +
        (report?.claimsWarningTriggered.length || 0) +
        (report?.claimsEscalated.length || 0),
      warningCount: report?.claimsWarningTriggered.length || 0,
      escalationCount: report?.claimsEscalated.length || 0,
      onTrack: Math.max(
        0,
        (report?.totalClaimsInSupervisorReview || 0) -
          (report?.claimsApproachingWarning.length || 0) -
          (report?.claimsWarningTriggered.length || 0) -
          (report?.claimsEscalated.length || 0),
      ),
    });
  } catch (error) {
    console.error('Failed to get dashboard SLA summary:', error);
    return createErrorResponse(friendlyError(error));
  }
}
