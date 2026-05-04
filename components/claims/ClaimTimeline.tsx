'use client';

/**
 * Enhanced Claim Timeline — Sprint E Phase 2
 *
 * Now shows:
 * - Current owner (name + role) at the top
 * - SLA status bar (days in stage, percentage)
 * - Duration between events
 * - Full workflow history with action labels
 */

import { fmtDateTime } from '@/lib/formatters';
import { WORKFLOW_ACTION_LABELS } from '@/lib/constants';
import { getStageLabel, getExpectedActorRole } from '@/lib/workflow-engine';
import type { ClaimWorkflow, ClaimStatus } from '@/lib/types';
import type { SLAAssessment } from '@/lib/sla-escalation';

interface ClaimTimelineProps {
  workflow: ClaimWorkflow[];
  /** Current claim status (for owner/SLA display) */
  currentStatus?: ClaimStatus;
  /** SLA assessment from sla-escalation engine */
  sla?: SLAAssessment | null;
  /** Current owner display name */
  currentOwnerName?: string | null;
}

export default function ClaimTimeline({
  workflow,
  currentStatus,
  sla,
  currentOwnerName,
}: ClaimTimelineProps) {
  const dotColors: Record<string, string> = {
    submit:          'bg-teal-pale text-teal shadow-[0_0_0_2px] shadow-teal-pale',
    resubmit:        'bg-teal-pale text-teal shadow-[0_0_0_2px] shadow-teal-pale',
    approve:         'bg-[#E8F5EE] text-[#1B7A45] shadow-[0_0_0_2px] shadow-[#E8F5EE]',
    forward:         'bg-[#E8F5EE] text-[#1B7A45] shadow-[0_0_0_2px] shadow-[#E8F5EE]',
    return:          'bg-[#FEF3E2] text-[#C46A00] shadow-[0_0_0_2px] shadow-[#FEF3E2]',
    director_return: 'bg-[#FEF3E2] text-[#C46A00] shadow-[0_0_0_2px] shadow-[#FEF3E2]',
    reject:              'bg-[#FDECEA] text-[#C0392B] shadow-[0_0_0_2px] shadow-[#FDECEA]',
    withdraw:            'bg-[#FEF3E2] text-[#C46A00] shadow-[0_0_0_2px] shadow-[#FEF3E2]',
    cancel:              'bg-[#FDECEA] text-[#C0392B] shadow-[0_0_0_2px] shadow-[#FDECEA]',
    upload_certificate:  'bg-[#E8F5EE] text-[#1B7A45] shadow-[0_0_0_2px] shadow-[#E8F5EE]',
    sla_warning:         'bg-[#FFFBEB] text-[#B45309] shadow-[0_0_0_2px] shadow-[#FFFBEB]',
    sla_escalation:      'bg-[#FEF2F2] text-[#DC2626] shadow-[0_0_0_2px] shadow-[#FEF2F2]',
    review:              'bg-teal-pale text-teal shadow-[0_0_0_2px] shadow-teal-pale',
  };

  const icons: Record<string, string> = {
    submit:              '📤',
    resubmit:            '🔄',
    approve:             '✅',
    forward:             '➡️',
    return:              '↩️',
    director_return:     '↩️',
    reject:              '❌',
    withdraw:            '↩️',
    cancel:              '🚫',
    upload_certificate:  '📜',
    sla_warning:         '⏱',
    sla_escalation:      '🚨',
    review:              '👁️',
  };

  /** Calculate duration between two timestamps */
  function getDuration(from: string, to: string): string {
    const ms = new Date(to).getTime() - new Date(from).getTime();
    if (ms < 0) return '';
    const hours = Math.floor(ms / (1000 * 60 * 60));
    if (hours < 1) return 'أقل من ساعة';
    if (hours < 24) return `${hours} ساعة`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'يوم واحد';
    if (days < 7) return `${days} أيام`;
    return `${Math.floor(days / 7)} أسبوع`;
  }

  /** Get role label in Arabic */
  function getRoleLabel(role: string | null): string {
    if (!role) return '';
    const labels: Record<string, string> = {
      contractor:       'المقاول',
      supervisor:       'المكتب الهندسي',
      auditor:          'المدقق',
      reviewer:         'الوحدة الفنية بالوزارة',
      // Phase 2.6 — workflow-gating roles surfaced from WorkflowRole.
      quality:          'وحدة الجودة بالوزارة',
      project_manager:  'مدير المشروع',
      director:         'المدير',
      final_approver:   'الاعتماد النهائي',
    };
    return labels[role] || role;
  }

  /**
   * Phase 2.6 — short, human-friendly stage name for the
   * "أُرجِعت إلى" pill on return events. Maps each `under_*_review`
   * (the destination of a flexible-return that targets an earlier
   * review stage) and each `returned_by_*` (the destination of a
   * return-to-contractor) to a single Arabic phrase.
   */
  function getReturnTargetLabel(toStatus: ClaimStatus | string | null): string {
    if (!toStatus) return '';
    const labels: Record<string, string> = {
      // Return-to-contractor sinks
      returned_by_supervisor:       'المقاول',
      returned_by_auditor:          'المقاول',
      returned_by_technical:        'المقاول',
      returned_by_quality:          'المقاول',
      returned_by_project_manager:  'المقاول',
      returned_by_final_approver:   'المقاول',
      // Return-to-earlier-review-stage destinations
      under_supervisor_review:      'المكتب الهندسي',
      under_auditor_review:         'المدقق',
      under_reviewer_check:         'المراجع',
      under_technical_review:       'الوحدة الفنية بالوزارة',
      under_quality_review:         'وحدة الجودة بالوزارة',
      under_project_manager_review: 'مدير المشروع',
    };
    return labels[toStatus] || getStageLabel(toStatus as ClaimStatus);
  }

  const expectedRole = currentStatus ? getExpectedActorRole(currentStatus) : null;
  const stageLabel = currentStatus ? getStageLabel(currentStatus) : null;

  return (
    <div className="space-y-4">

      {/* ── Current Status Header ────────────────────────────────── */}
      {currentStatus && !['approved', 'rejected', 'cancelled'].includes(currentStatus) && (
        <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-gray-500">المرحلة الحالية:</span>
              <span className="text-xs font-black text-[#045859]">{stageLabel}</span>
            </div>
            {(currentOwnerName || expectedRole) && (
              <div className="flex items-center gap-1.5">
                <span className="text-[0.65rem] font-bold text-gray-400">المسؤول:</span>
                <span className="text-[0.65rem] font-black text-[#045859]">
                  {currentOwnerName || getRoleLabel(expectedRole)}
                </span>
              </div>
            )}
          </div>

          {/* SLA progress bar */}
          {sla && (
            <div className="mt-2.5">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[0.6rem] font-bold text-gray-400">
                  مهلة SLA: {sla.daysElapsed} من أصل {sla.config.limitDays} يوم عمل
                </span>
                <span
                  className="text-[0.6rem] font-black px-1.5 py-0.5 rounded"
                  style={{
                    background: sla.level === 'overdue' ? '#FEF2F2' : sla.level === 'warning' ? '#FFFBEB' : '#F0FDF4',
                    color: sla.level === 'overdue' ? '#DC2626' : sla.level === 'warning' ? '#B45309' : '#166534',
                  }}
                >
                  {sla.level === 'overdue' ? 'متأخر' : sla.level === 'warning' ? 'تحذير' : 'ضمن المهلة'}
                  {' '}{sla.slaPct}٪
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(sla.slaPct, 100)}%`,
                    background: sla.level === 'overdue' ? '#DC2626' : sla.level === 'warning' ? '#F59E0B' : '#87BA26',
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Timeline Events ──────────────────────────────────────── */}
      {!workflow.length ? (
        <p className="text-sm text-gray-400">لا يوجد سجل إجراءات</p>
      ) : (
        <ul className="list-none p-0">
          {workflow.map((w, idx) => {
            // Duration from previous event
            const prevEvent = idx < workflow.length - 1 ? workflow[idx + 1] : null;
            const duration = prevEvent ? getDuration(prevEvent.created_at, w.created_at) : null;

            return (
              <li key={w.id} className="flex gap-3 mb-3 relative">
                {/* Connecting line */}
                {idx < workflow.length - 1 && (
                  <div className="absolute right-[13px] top-[30px] bottom-[-13px] w-0.5 bg-gray-100" />
                )}
                {/* Dot */}
                <div className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-[0.73rem] z-[1] border-2 border-white ${dotColors[w.action] || dotColors.review}`}>
                  {icons[w.action] || '📌'}
                </div>
                {/* Content */}
                <div className="flex-1 pt-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-sm text-teal-dark">
                      {w.profiles?.full_name_ar || w.profiles?.full_name || 'مستخدم'}
                    </span>
                    {duration && (
                      <span className="text-[0.58rem] font-bold text-gray-300 bg-gray-50 px-1.5 py-0.5 rounded border border-gray-100">
                        ⏱ {duration}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-600">
                    {WORKFLOW_ACTION_LABELS[w.action] || w.action}
                    {w.from_status && w.to_status && w.from_status !== w.to_status && (
                      <span className="text-[0.62rem] text-gray-400 mr-1.5">
                        ({getStageLabel(w.from_status as ClaimStatus)} → {getStageLabel(w.to_status as ClaimStatus)})
                      </span>
                    )}
                  </div>
                  {/* Phase 2.6 — flexible-return: render the picked
                      target stage prominently so auditors and the
                      contractor immediately see WHERE the claim went. */}
                  {w.action === 'return' && w.to_status && (
                    <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                      <span className="text-[0.65rem] font-bold text-[#C46A00] bg-[#FEF3E2] px-2 py-0.5 rounded-full border border-[#FED7AA]">
                        أُرجِعت إلى: {getReturnTargetLabel(w.to_status)}
                      </span>
                    </div>
                  )}
                  <div className="text-[0.69rem] text-gray-400 mt-px">
                    {fmtDateTime(w.created_at)}
                  </div>
                  {w.notes && (
                    <div className="mt-1.5 px-2.5 py-1.5 bg-teal-ultra rounded-sm text-xs text-gray-600 border-r-[3px] border-teal">
                      {w.notes}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
