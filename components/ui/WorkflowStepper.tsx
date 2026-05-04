'use client';

/**
 * WorkflowStepper — visualizes the 5-stage CONVERA claim workflow.
 *
 * Visualization ONLY: this component does not drive transitions or call
 * the action engine. It reads the current ClaimStatus and renders the
 * stage timeline with done/current/pending/error states.
 *
 *  contractor (draft / submitted)
 *    → supervisor (under_supervisor_review / returned_by_supervisor)
 *    → auditor   (under_auditor_review / returned_by_auditor)
 *    → reviewer  (under_reviewer_check)
 *    → director  (pending_director_approval)
 *    → terminal  (approved / rejected / cancelled)
 */

import type { ClaimStatus } from '@/lib/types';
import { Send, Eye, FileSearch, ShieldCheck, BadgeCheck, Check, X, RotateCcw } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface Stage {
  key: 'contractor' | 'supervisor' | 'auditor' | 'reviewer' | 'director';
  label: string;
  description: string;
  icon: LucideIcon;
}

const STAGES: Stage[] = [
  { key: 'contractor', label: 'المقاول',         description: 'إنشاء وتقديم',     icon: Send },
  { key: 'supervisor', label: 'جهة الإشراف',     description: 'مراجعة فنية',      icon: Eye },
  { key: 'auditor',    label: 'المدقق',          description: 'تدقيق مالي/فني',   icon: FileSearch },
  { key: 'reviewer',   label: 'المراجع',          description: 'مطابقة اعتماد',    icon: ShieldCheck },
  { key: 'director',   label: 'مدير الإدارة',     description: 'الاعتماد النهائي',  icon: BadgeCheck },
];

type StageState = 'done' | 'current' | 'pending' | 'returned';

function deriveStageStates(status: ClaimStatus): {
  states: StageState[];
  terminal: 'approved' | 'rejected' | 'cancelled' | null;
  returned: boolean;
} {
  // Index of the active stage on the 5-step rail
  const map: Record<ClaimStatus, { idx: number; state: StageState; terminal?: 'approved'|'rejected'|'cancelled' }> = {
    draft:                     { idx: 0, state: 'current' },
    submitted:                 { idx: 0, state: 'done' },          // moved on, supervisor next
    under_supervisor_review:   { idx: 1, state: 'current' },
    returned_by_supervisor:    { idx: 0, state: 'returned' },
    under_auditor_review:      { idx: 2, state: 'current' },
    returned_by_auditor:       { idx: 0, state: 'returned' },
    under_reviewer_check:      { idx: 3, state: 'current' },
    // Phase 2.6 — new stages collapse onto the existing 5-step rail:
    //   technical/quality/PM reviews all sit at the reviewer bullet (idx 3),
    //   and any returned_by_* falls back to "returned to contractor" (idx 0).
    under_technical_review:        { idx: 3, state: 'current' },
    returned_by_technical:         { idx: 0, state: 'returned' },
    under_quality_review:          { idx: 3, state: 'current' },
    returned_by_quality:           { idx: 0, state: 'returned' },
    under_project_manager_review:  { idx: 3, state: 'current' },
    returned_by_project_manager:   { idx: 0, state: 'returned' },
    returned_by_final_approver:    { idx: 0, state: 'returned' },
    pending_director_approval: { idx: 4, state: 'current' },
    approved:                  { idx: 4, state: 'done', terminal: 'approved' },
    rejected:                  { idx: 4, state: 'done', terminal: 'rejected' },
    cancelled:                 { idx: 0, state: 'done', terminal: 'cancelled' },
  };
  const m = map[status] ?? { idx: 0, state: 'pending' as StageState };
  const states: StageState[] = STAGES.map((_, i) => {
    if (m.state === 'returned') return i === 0 ? 'returned' : 'pending';
    if (i < m.idx) return 'done';
    if (i === m.idx) return m.state;
    return 'pending';
  });
  return { states, terminal: m.terminal ?? null, returned: m.state === 'returned' };
}

const STATE_STYLE: Record<StageState, { bullet: string; label: string; rail: string; iconColor: string }> = {
  done:     { bullet: 'bg-[#558B2F] text-white border-[#558B2F]', label: 'text-[#558B2F]', rail: 'bg-[#558B2F]',  iconColor: 'text-white' },
  current:  { bullet: 'bg-[#045859] text-white border-[#045859] ring-4 ring-[#E8F4F4]', label: 'text-[#045859]', rail: 'bg-gray-200', iconColor: 'text-white' },
  pending:  { bullet: 'bg-white text-gray-400 border-gray-300', label: 'text-gray-500', rail: 'bg-gray-200', iconColor: 'text-gray-400' },
  returned: { bullet: 'bg-[#C05728] text-white border-[#C05728]', label: 'text-[#C05728]', rail: 'bg-gray-200', iconColor: 'text-white' },
};

export interface WorkflowStepperProps {
  status: ClaimStatus;
  /** Hide stage descriptions for compact rendering */
  compact?: boolean;
  className?: string;
}

export default function WorkflowStepper({ status, compact = false, className = '' }: WorkflowStepperProps) {
  const { states, terminal, returned } = deriveStageStates(status);

  return (
    <div className={'bg-white rounded-xl border border-gray-100 p-5 ' + className}>
      {/* Stages rail */}
      <div className="flex items-stretch gap-0">
        {STAGES.map((stage, i) => {
          const state = states[i];
          const s = STATE_STYLE[state];
          const Icon = state === 'done'
            ? Check
            : state === 'returned'
              ? RotateCcw
              : stage.icon;
          const isLast = i === STAGES.length - 1;
          return (
            <div key={stage.key} className="flex-1 flex flex-col items-center text-center relative">
              {/* Rail to next stage */}
              {!isLast && (
                <div className="absolute top-5 left-0 right-1/2 h-[3px] bg-gray-200">
                  <div
                    className={'h-full ' + (states[i] === 'done' ? 'bg-[#558B2F]' : 'bg-transparent')}
                    style={{ width: '100%' }}
                  />
                </div>
              )}
              {!isLast && (
                <div className="absolute top-5 right-0 left-1/2 h-[3px] bg-gray-200">
                  <div
                    className={'h-full ' + (states[i] === 'done' ? 'bg-[#558B2F]' : 'bg-transparent')}
                    style={{ width: '100%' }}
                  />
                </div>
              )}
              {/* Bullet */}
              <div className={'relative z-10 w-10 h-10 rounded-full border-2 flex items-center justify-center ' + s.bullet}>
                <Icon size={16} strokeWidth={2.4} />
              </div>
              {/* Label */}
              <div className={'mt-2 text-xs font-bold ' + s.label}>{stage.label}</div>
              {!compact && (
                <div className="mt-0.5 text-[10px] text-gray-400 leading-tight px-1">
                  {stage.description}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Terminal/return banner */}
      {terminal && (
        <div className="mt-5 flex items-center justify-center">
          {terminal === 'approved' && (
            <div className="flex items-center gap-2 text-sm font-bold text-[#558B2F] bg-[#F0F7E0] rounded-full px-4 py-1.5">
              <Check size={14} /> اعتُمدت المطالبة
            </div>
          )}
          {terminal === 'rejected' && (
            <div className="flex items-center gap-2 text-sm font-bold text-[#C0392B] bg-[#FDECEA] rounded-full px-4 py-1.5">
              <X size={14} /> رُفضت المطالبة
            </div>
          )}
          {terminal === 'cancelled' && (
            <div className="flex items-center gap-2 text-sm font-bold text-gray-600 bg-gray-100 rounded-full px-4 py-1.5">
              <X size={14} /> أُلغيت المطالبة
            </div>
          )}
        </div>
      )}

      {returned && (
        <div className="mt-5 flex items-center justify-center">
          <div className="flex items-center gap-2 text-sm font-bold text-[#C05728] bg-[#FAEEE8] rounded-full px-4 py-1.5">
            <RotateCcw size={14} /> مُرجَعة إلى المقاول للتعديل
          </div>
        </div>
      )}
    </div>
  );
}
