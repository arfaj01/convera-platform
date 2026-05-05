'use client';

/**
 * Workflow Page — سير الاعتماد
 *
 * NOW POWERED BY Unified Action Engine (lib/action-engine.ts).
 *
 * All action buttons (approve/return/reject/override) are resolved by
 * getAvailableActionsForClaim() — the single source of truth.
 */

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { fetchContracts, fetchMyContractRoles } from '@/services/contracts';
import { isExternal } from '@/lib/permissions';
import type { ContractRole } from '@/lib/types';
import PageHeader from '@/components/ui/PageHeader';
import Card, { CardBody } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import FilterBar from '@/components/ui/FilterBar';
import EmptyState from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/components/AuthProvider';
import { fetchPendingClaims, performClaimAction } from '@/services/workflow';
// IAM-4 (2026-05-05) — multi-role active-role helper. Used to compute
// the contract role to forward to /api/claims/transition for users who
// hold more than one role on the claim's contract. Same logic as the
// claim detail page, extracted into lib/active-role.ts for reuse.
import { pickActiveRole } from '@/lib/active-role';
import { fmt, fmtDate } from '@/lib/formatters';
import { CLAIM_STATUS_LABELS, ROLE_LABELS } from '@/lib/constants';
import type { ClaimStatus, UserRole } from '@/lib/types';
import {
  buildActionContext,
  getAvailableActionsForClaim,
  getWorkflowActions,
  actionVariantToButtonVariant,
  type ClaimAction,
  type ActionContext,
} from '@/lib/action-engine';
import { assessClaimSLA, type SLAAssessment } from '@/lib/sla-escalation';
import {
  Send, Eye, FileSearch, ShieldCheck, BadgeCheck,
  RotateCcw, X as XIcon, CheckCircle2,
  Clock, AlertTriangle, ArrowRight, Crown, User as UserIcon,
  ShieldOff,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// ─── ContractRole → Pending Statuses ─────────────────────────────
const CONTRACT_ROLE_STATUSES: Partial<Record<ContractRole, ClaimStatus[]>> = {
  supervisor: ['under_supervisor_review'],
  auditor:    ['under_auditor_review'],
  reviewer:   ['under_reviewer_check'],
};

// ─── ContractRole → Arabic labels (display only) ────────────────
// Canonical role names per Phase 2.5 standardization brief. Single
// source of truth across the platform — used by the multi-role badges
// strip on this page and mirrored in claims/[id]/page.tsx and
// components/users/UserFormModal.tsx. Pure display layer; no logic.
const CONTRACT_ROLE_LABELS: Record<ContractRole, string> = {
  contractor:      'مقاول',
  supervisor:      'المكتب الهندسي',
  auditor:         'تدقيق',
  reviewer:        'الوحدة الفنية',
  viewer:          'مشاهدة',
  project_manager: 'مدير المشروع',
  quality:         'وحدة الجودة',
  final_approver:  'الاعتماد النهائي',
};

// Legacy fallback
const ROLE_STATUSES: Partial<Record<UserRole, ClaimStatus[]>> = {
  supervisor: ['under_supervisor_review'],
  auditor:    ['under_auditor_review'],
  reviewer:   ['under_reviewer_check'],
};

// ─── Stage Pipeline (ordered) ────────────────────────────────────
const PIPELINE: ClaimStatus[] = [
  'under_supervisor_review',
  'under_auditor_review',
  'under_reviewer_check',
  'pending_director_approval',
];

const NEXT_STAGE: Partial<Record<ClaimStatus, ClaimStatus>> = {
  under_supervisor_review:    'under_auditor_review',
  under_auditor_review:       'under_reviewer_check',
  under_reviewer_check:       'pending_director_approval',
  pending_director_approval:  'approved',
};

interface StageInfo { label: string; color: string; icon: LucideIcon }

const STAGE_INFO: Partial<Record<ClaimStatus, StageInfo>> = {
  submitted:                 { label: 'مُقدَّم (توجيه تلقائي)',         color: '#FFC845', icon: Send },
  under_supervisor_review:   { label: 'قيد مراجعة جهة الإشراف',       color: '#00A79D', icon: Eye },
  returned_by_supervisor:    { label: 'مُرجَع من جهة الإشراف',         color: '#C05728', icon: RotateCcw },
  under_auditor_review:      { label: 'قيد مراجعة المدقق',             color: '#502C7C', icon: FileSearch },
  returned_by_auditor:       { label: 'مُرجَع من المدقق',               color: '#C05728', icon: RotateCcw },
  under_reviewer_check:      { label: 'قيد فحص المراجع',               color: '#C05728', icon: ShieldCheck },
  pending_director_approval: { label: 'بانتظار اعتماد المدير',          color: '#045859', icon: BadgeCheck },
  approved:                  { label: 'معتمد',                          color: '#87BA26', icon: CheckCircle2 },
  rejected:                  { label: 'مرفوض',                          color: '#C05728', icon: XIcon },
};

const STAGE_LABELS: Partial<Record<ClaimStatus, string>> = {
  under_supervisor_review:   'قيد مراجعة جهة الإشراف',
  under_auditor_review:      'قيد مراجعة المدقق',
  under_reviewer_check:      'قيد فحص المراجع',
  pending_director_approval: 'بانتظار اعتماد المدير',
};

// ─── Types ───────────────────────────────────────────────────────
interface PendingClaim {
  id: string;
  claim_no: number;
  contract_id: string;
  status: ClaimStatus;
  submitted_at: string | null;
  total_amount: number;
  gross_amount: number;
  contracts?: {
    contract_no: string;
    title_ar: string | null;
    title: string;
    party_name_ar: string | null;
  } | null;
}

// ─── Unified Inline Actions (powered by action-engine) ──────────

function InlineActions({
  claim,
  actionContext,
  actorId,
  availableRoles,
  onDone,
}: {
  claim: PendingClaim;
  actionContext: ActionContext;
  actorId: string;
  /**
   * IAM-4 (2026-05-05) — the user's active ContractRoles on this
   * claim's contract. Used to compute `actor_role` for /api/claims/transition.
   * Empty for global directors (they bypass via isGlobalRole on the server).
   */
  availableRoles: ContractRole[];
  onDone: () => void;
}) {
  const { showToast } = useToast();
  const [modalAction, setModalAction] = useState<ClaimAction | null>(null);
  const [reason, setReason] = useState('');
  const [pickedTarget, setPickedTarget] = useState<ClaimStatus | null>(null);
  const [loading, setLoading] = useState(false);

  // ── Single source of truth: action engine ──
  const allActions = getAvailableActionsForClaim(actionContext);
  const wfActions = getWorkflowActions(allActions);

  // Also include director_override if present
  const directorOverride = allActions.find(a => a.type === 'director_override');

  // Phase 2.6 — pre-select the contractor-bound default whenever the
  // modal opens with a flexible-return action.
  useEffect(() => {
    if (modalAction?.returnTargets && modalAction.returnTargets.length > 0) {
      setPickedTarget(modalAction.returnTargets[0].toStatus);
    } else {
      setPickedTarget(null);
    }
  }, [modalAction]);

  if (wfActions.length === 0 && !directorOverride) return null;

  const execute = async (action: ClaimAction, notes?: string) => {
    if (!action.workflowAction) return;
    setLoading(true);
    try {
      // IAM-4 (2026-05-05) — pick the active role for this stage so
      // multi-role users hit the same authorisation path as the claim
      // detail page (added by 0f6ca80). The server validates the
      // resulting role against user_contract_roles before honouring it.
      const actorRole = pickActiveRole(availableRoles, claim.status);

      await performClaimAction(
        claim.id,
        action.workflowAction,
        actorId,
        claim.status,
        action.toStatus || claim.status,
        notes,
        // Phase 2.6: forward the picked return target (only meaningful
        // for return actions). Server-side validates against allow-list.
        pickedTarget || undefined,
        // IAM-4: forward the user's active contract role.
        actorRole,
      );
      showToast('تم تنفيذ الإجراء بنجاح ✓', 'ok');
      setModalAction(null);
      setReason('');
      setPickedTarget(null);
      onDone();
    } catch (e) {
      showToast(`خطأ: ${(e as Error).message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const minLen = modalAction?.min_input_length || 10;
  const isReject = modalAction?.type === 'reject';
  const hasReturnTargets = !!modalAction?.returnTargets && modalAction.returnTargets.length > 0;
  const confirmDisabled =
    loading ||
    reason.length < minLen ||
    (hasReturnTargets && !pickedTarget);

  return (
    <>
      <div className="flex gap-2 flex-wrap mt-3 pt-3 border-t border-gray-100">
        {wfActions.map(action => (
          <div key={action.workflowAction || action.type} className="relative group">
            <Button
              variant={actionVariantToButtonVariant(action.variant)}
              onClick={e => {
                e.stopPropagation();
                if (action.requires_input) {
                  setModalAction(action);
                } else {
                  execute(action);
                }
              }}
              disabled={loading || !action.enabled}
              className="text-xs py-1.5 px-3"
            >
              {loading ? '...' : action.label_ar}
            </Button>
            {!action.enabled && action.reason_if_disabled && (
              <div className="absolute bottom-full mb-1 right-0 hidden group-hover:block z-50 w-56 p-2 bg-gray-800 text-white text-[0.65rem] rounded shadow-lg leading-relaxed">
                {action.reason_if_disabled}
              </div>
            )}
          </div>
        ))}

        {/* Director override button */}
        {directorOverride && (
          <Button
            variant="outline"
            onClick={e => { e.stopPropagation(); setModalAction(directorOverride); }}
            className="text-xs py-1.5 px-3 border-[#502C7C] text-[#502C7C] hover:bg-[#502C7C]/10"
          >
            {directorOverride.label_ar}
          </Button>
        )}
      </div>

      {/* Reason / Override Modal */}
      <Modal
        open={!!modalAction}
        onClose={() => { setModalAction(null); setReason(''); setPickedTarget(null); }}
        title={modalAction?.label_ar || ''}
        footer={
          <>
            <Button variant="outline" onClick={() => { setModalAction(null); setReason(''); setPickedTarget(null); }}>إلغاء</Button>
            <Button
              variant={isReject ? 'red' : 'teal'}
              onClick={() => modalAction && execute(modalAction, reason)}
              disabled={confirmDisabled}
            >
              {loading ? 'جاري التنفيذ...' : 'تأكيد'}
            </Button>
          </>
        }
      >
        {modalAction?.type === 'director_override' ? (
          <DirectorOverrideContent
            claim={claim}
            reason={reason}
            onReasonChange={setReason}
            onExecute={async (targetStatus, notes) => {
              setLoading(true);
              try {
                // IAM-4: forward the active contract role; pass undefined for
                // pickedTarget since director_override carries its own target.
                const actorRole = pickActiveRole(availableRoles, claim.status);
                await performClaimAction(
                  claim.id,
                  'director_override',
                  actorId,
                  claim.status,
                  targetStatus,
                  notes,
                  undefined,
                  actorRole,
                );
                showToast('تم تعديل الإحالة بنجاح ✓', 'ok');
                setModalAction(null);
                setReason('');
                onDone();
              } catch (e) {
                showToast(`خطأ: ${(e as Error).message}`, 'error');
              } finally {
                setLoading(false);
              }
            }}
            loading={loading}
          />
        ) : (
          <>
            {/* Phase 2.6 — flexible-return target picker (radio group).
                Shown ONLY when the action carries returnTargets. */}
            {hasReturnTargets && modalAction?.returnTargets && (
              <div className="mb-4">
                <label className="block text-xs font-bold text-gray-600 mb-1.5">
                  إرجاع إلى <span className="text-red">*</span>
                </label>
                <div
                  className="flex flex-col gap-1.5 bg-gray-50 rounded p-2 border border-gray-200"
                  onClick={e => e.stopPropagation()}
                >
                  {modalAction.returnTargets.map((target, idx) => (
                    <label
                      key={target.toStatus}
                      className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-white"
                    >
                      <input
                        type="radio"
                        name="return-target-inline"
                        value={target.toStatus}
                        checked={pickedTarget === target.toStatus}
                        onChange={() => setPickedTarget(target.toStatus)}
                        className="accent-[#045859]"
                      />
                      <span className="text-sm font-bold text-gray-700">
                        {target.labelAr}
                      </span>
                      {idx === 0 && (
                        <span className="text-[0.6rem] text-gray-400 mr-auto">
                          (الافتراضي)
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <label className="block text-xs font-bold text-gray-600 mb-1">
              {isReject ? 'سبب الرفض (إلزامي)' : 'سبب الإرجاع (إلزامي)'}
            </label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder={`اكتب السبب بشكل واضح (${minLen} أحرف على الأقل)...`}
              className="w-full p-2.5 border border-gray-200 rounded text-sm bg-gray-50 focus:border-teal focus:outline-none resize-y min-h-[80px]"
              onClick={e => e.stopPropagation()}
            />
            {reason.length > 0 && reason.length < minLen && (
              <p className="text-xs text-red mt-1">يجب كتابة {minLen} أحرف على الأقل</p>
            )}
          </>
        )}
      </Modal>
    </>
  );
}

// ─── Director Override Content ────────────────────────────────────

function DirectorOverrideContent({
  claim,
  reason,
  onReasonChange,
  onExecute,
  loading,
}: {
  claim: PendingClaim;
  reason: string;
  onReasonChange: (v: string) => void;
  onExecute: (targetStatus: ClaimStatus, notes: string) => void;
  loading: boolean;
}) {
  const [targetStatus, setTargetStatus] = useState<ClaimStatus | ''>('');
  const availableStages = PIPELINE.filter(s => s !== claim.status);

  return (
    <div className="space-y-4">
      <div className="p-3 bg-gray-50 rounded border border-gray-100 text-xs flex items-center gap-2">
        <span className="text-gray-500">المرحلة الحالية:</span>
        {(() => {
          const Ic = STAGE_INFO[claim.status]?.icon;
          return Ic ? <Ic size={12} className="text-[#045859]" strokeWidth={2.2} /> : null;
        })()}
        <span className="font-bold text-teal-dark">
          {CLAIM_STATUS_LABELS[claim.status] || claim.status}
        </span>
      </div>

      <div>
        <label className="block text-xs font-bold text-gray-700 mb-2">
          إحالة المطالبة إلى المرحلة:
        </label>
        <div className="space-y-2">
          {availableStages.map(s => {
            const Ic = STAGE_INFO[s]?.icon;
            return (
            <label
              key={s}
              onClick={e => e.stopPropagation()}
              className={`flex items-center gap-3 p-2.5 rounded border cursor-pointer transition-colors ${
                targetStatus === s
                  ? 'border-teal bg-teal-pale'
                  : 'border-gray-200 hover:border-teal/40 hover:bg-gray-50'
              }`}
            >
              <input
                type="radio"
                name="target_stage"
                value={s}
                checked={targetStatus === s}
                onChange={() => setTargetStatus(s)}
                className="accent-teal"
              />
              <div className="text-xs font-bold text-gray-800 flex items-center gap-2">
                {Ic && <Ic size={12} className="text-[#045859]" strokeWidth={2.2} />}
                {STAGE_LABELS[s] || CLAIM_STATUS_LABELS[s] || s}
              </div>
            </label>
            );
          })}
        </div>
      </div>

      <div>
        <label className="block text-xs font-bold text-gray-700 mb-1">
          سبب تعديل الإحالة (إلزامي)
        </label>
        <textarea
          value={reason}
          onChange={e => onReasonChange(e.target.value)}
          onClick={e => e.stopPropagation()}
          placeholder="اكتب مبرر واضح لتعديل المرحلة (10 أحرف على الأقل)..."
          className="w-full p-2.5 border border-gray-200 rounded text-sm bg-gray-50 focus:border-teal focus:outline-none resize-y min-h-[80px]"
        />
        {reason.length > 0 && reason.length < 10 && (
          <p className="text-xs text-red mt-1">يجب كتابة 10 أحرف على الأقل</p>
        )}
      </div>

      <div className="p-2.5 bg-[#FFF8E0] border border-[#FFC845]/40 rounded text-xs text-[#7A4F00] flex items-start gap-2">
        <AlertTriangle size={14} strokeWidth={2.2} className="flex-shrink-0 mt-0.5" />
        <span>هذا الإجراء يُسجَّل في سجل التدقيق ويُحال المستخلص مباشرةً إلى المرحلة المختارة.</span>
      </div>

      <Button
        variant="teal"
        onClick={() => targetStatus && onExecute(targetStatus as ClaimStatus, reason)}
        disabled={loading || !targetStatus || reason.length < 10}
        className="w-full justify-center"
      >
        {loading ? '⏳ جاري التنفيذ...' : 'تأكيد التعديل'}
      </Button>
    </div>
  );
}

// ─── Claim Card ──────────────────────────────────────────────────
function ClaimCard({
  claim,
  actionContext,
  actorId,
  availableRoles,
  onRefresh,
}: {
  claim: PendingClaim;
  actionContext: ActionContext;
  actorId: string;
  availableRoles: ContractRole[];
  onRefresh: () => void;
}) {
  const router = useRouter();
  const contract = claim.contracts;
  // SLA assessment via the canonical engine (Saudi work-day aware).
  const sla: SLAAssessment | null = assessClaimSLA(
    { id: claim.id, claim_no: claim.claim_no, contract_id: claim.contract_id, status: claim.status },
    claim.submitted_at,
  );
  const stage = STAGE_INFO[claim.status];
  const StageIcon = stage?.icon;
  const nextStage = NEXT_STAGE[claim.status];
  const nextStageInfo = nextStage ? STAGE_INFO[nextStage] : null;
  const NextIcon = nextStageInfo?.icon;

  return (
    <Card className="hover:shadow-cardHover transition-all">
      <CardBody>
        {/* Stage pipeline strip */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {stage && StageIcon && (
            <span
              className="inline-flex items-center gap-1.5 text-[0.72rem] font-bold px-2 py-0.5 rounded-full"
              style={{ color: stage.color, background: `${stage.color}18` }}
            >
              <StageIcon size={12} strokeWidth={2.4} />
              {stage.label}
            </span>
          )}
          {nextStageInfo && nextStage && NextIcon && (
            <>
              <ArrowRight size={12} className="text-gray-300" />
              <span className="inline-flex items-center gap-1.5 text-[0.70rem] font-bold px-2 py-0.5 rounded-full text-gray-500 bg-gray-100 border border-gray-200">
                <NextIcon size={12} strokeWidth={2.2} />
                {STAGE_LABELS[nextStage] || CLAIM_STATUS_LABELS[nextStage] || nextStage}
              </span>
            </>
          )}
          {sla?.level === 'overdue' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.68rem] font-bold bg-[#FDECEA] text-red">
              <AlertTriangle size={11} strokeWidth={2.4} />
              تجاوز SLA · {sla.daysElapsed}/{sla.config.limitDays} يوم عمل
            </span>
          )}
          {sla?.level === 'warning' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.68rem] font-bold bg-[#FFF8E0] text-[#C46A00]">
              <Clock size={11} strokeWidth={2.4} />
              تنبيه SLA · {sla.daysElapsed}/{sla.config.limitDays} يوم عمل
            </span>
          )}
        </div>

        {/* Main row */}
        <div
          className="flex items-start justify-between cursor-pointer"
          onClick={() => router.push(`/claims/${claim.id}`)}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-sm font-bold text-teal">مطالبة #{claim.claim_no}</span>
              <Badge status={claim.status} />
            </div>
            <div className="text-xs font-bold text-gray-600 mb-0.5 truncate">
              {contract?.title_ar || contract?.title || '—'}
            </div>
            <div className="flex items-center gap-3 text-[0.72rem] text-gray-400 flex-wrap">
              <span>{contract?.party_name_ar || '—'}</span>
              <span>·</span>
              <span>تقديم: {fmtDate(claim.submitted_at)}</span>
              {sla && (
                <>
                  <span>·</span>
                  <span className={sla.level === 'overdue' ? 'text-red font-bold' : sla.level === 'warning' ? 'text-[#C46A00] font-bold' : ''}>
                    {sla.daysElapsed} أيام عمل في المراجعة
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="text-right flex-shrink-0 ms-4">
            <div className="text-lg font-extrabold text-teal font-display">
              {fmt(claim.total_amount)}
            </div>
            <div className="text-[0.65rem] text-gray-400">ريال سعودي</div>
          </div>
        </div>

        {/* Actions — unified via action engine */}
        <InlineActions
          claim={claim}
          actionContext={actionContext}
          actorId={actorId}
          availableRoles={availableRoles}
          onDone={onRefresh}
        />
      </CardBody>
    </Card>
  );
}

// ─── Main Page ───────────────────────────────────────────────────
export default function WorkflowPage() {
  const { profile, loading: authLoading } = useAuth();
  const [claims, setClaims]       = useState<PendingClaim[]>([]);
  const [loading, setLoading]     = useState(true);
  const [filter, setFilter]       = useState<ClaimStatus | 'all'>('all');
  const [hasScope, setHasScope]   = useState(true);
  const [effectiveRole, setEffectiveRole] = useState<UserRole | undefined>(undefined);
  // Map<contract_id, ContractRole[]> — Migration 045: a user may hold
  // MULTIPLE contract_role rows for the same contract. Track all of them.
  const [rolesByContract, setRolesByContract] = useState<Map<string, ContractRole[]>>(new Map());

  const userRole   = profile?.role as UserRole | undefined;
  const isDirector = userRole === 'director';
  const isScoped   = userRole ? isExternal(userRole) : false;

  const load = useCallback(async () => {
    try {
      if (isScoped) {
        const contracts = await fetchContracts();
        if (contracts.length === 0) {
          setHasScope(false);
          setClaims([]);
          return;
        }
      }
      setHasScope(true);

      const all = (await fetchPendingClaims()) as unknown as PendingClaim[];

      if (isDirector) {
        setClaims(all);
        setEffectiveRole('director');
      } else {
        const myRoles = await fetchMyContractRoles();

        if (myRoles.length > 0) {
          const contractRoleToUserRole: Record<string, UserRole> = {
            contractor: 'contractor',
            supervisor: 'supervisor',
            auditor: 'auditor',
            reviewer: 'reviewer',
            viewer: userRole || 'contractor',
          };

          // Build map: contract_id → ContractRole[] (multi-role aware).
          // After Migration 045 a user may have multiple rows for the
          // same contract, one per distinct role. Append, don't overwrite.
          const cRoleMap = new Map<string, ContractRole[]>();
          for (const r of myRoles) {
            const cid = r.contract_id;
            const role = r.contract_role as ContractRole;
            const existing = cRoleMap.get(cid) ?? [];
            if (!existing.includes(role)) existing.push(role);
            cRoleMap.set(cid, existing);
          }
          setRolesByContract(cRoleMap);

          const actionable: PendingClaim[] = [];
          let primaryRole: ContractRole | null = null;

          for (const claim of all) {
            const cRoles = cRoleMap.get(claim.contract_id) ?? [];
            if (cRoles.length === 0) continue;

            let matched = false;

            // Contractor view: their action surface is the "returned" stages.
            if (
              cRoles.includes('contractor') &&
              (claim.status === 'returned_by_supervisor' ||
                claim.status === 'returned_by_auditor')
            ) {
              matched = true;
              if (!primaryRole) primaryRole = 'contractor';
            }

            // Workflow-gating roles: any role whose CONTRACT_ROLE_STATUSES
            // entry matches the claim's current status.
            for (const cr of cRoles) {
              if (cr === 'contractor') continue;
              const statuses = CONTRACT_ROLE_STATUSES[cr];
              if (statuses && statuses.includes(claim.status)) {
                matched = true;
                if (!primaryRole) primaryRole = cr;
                break;
              }
            }

            if (matched) actionable.push(claim);
          }

          setClaims(actionable);
          setEffectiveRole(primaryRole ? contractRoleToUserRole[primaryRole] : userRole);
        } else {
          if (userRole && ROLE_STATUSES[userRole]) {
            setClaims(all.filter(c => ROLE_STATUSES[userRole!]!.includes(c.status)));
          } else if (userRole === 'contractor') {
            setClaims(all.filter(c =>
              c.status === 'returned_by_supervisor' || c.status === 'returned_by_auditor'
            ));
          } else {
            setClaims(all);
          }
          setEffectiveRole(userRole);
        }
      }
    } catch (e) {
      console.warn('Workflow load:', e);
    } finally {
      setLoading(false);
    }
  }, [userRole, isDirector, isScoped]);

  useEffect(() => {
    if (!authLoading) load();
  }, [authLoading, load]);

  // ── Build action context for each claim ──
  const getActionContext = (claim: PendingClaim): ActionContext => {
    // Multi-role aware: pass ALL of the user's roles on this contract.
    // Director short-circuits to an empty array — the engine treats them
    // as a global role via isGlobalRole.
    const cRoles = isDirector ? [] : (rolesByContract.get(claim.contract_id) ?? []);
    return buildActionContext({
      userId: profile?.id || '',
      globalRole: userRole || 'contractor',
      contractRoles: cRoles,
      isGlobalRole: isDirector,
      claim: { status: claim.status },
      documents: [], // workflow page doesn't load docs; approval check happens server-side
    });
  };

  const statusesPresent = Array.from(new Set(claims.map(c => c.status)));
  const filtered = filter === 'all' ? claims : claims.filter(c => c.status === filter);
  const grouped  = filtered.reduce<Partial<Record<ClaimStatus, PendingClaim[]>>>((acc, c) => {
    if (!acc[c.status]) acc[c.status] = [];
    acc[c.status]!.push(c);
    return acc;
  }, {});
  const totalAmount = filtered.reduce((s, c) => s + (c.total_amount || 0), 0);

  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-sm text-gray-400 animate-pulse">جاري تحميل طلبات الاعتماد...</p>
      </div>
    );
  }

  if (isScoped && !hasScope) {
    return (
      <>
        <PageHeader title="سير الاعتماد" subtitle="غير متاح" />
        <EmptyState
          size="lg"
          icon={ShieldOff}
          title="لا توجد عقود مرتبطة بحسابك حالياً"
          description="تم تقييد صلاحياتك التشغيلية — لا يمكن عرض طلبات الاعتماد بدون عقود مرتبطة. تواصل مع مدير الإدارة لتفعيل الصلاحيات."
        />
      </>
    );
  }

  const roleLabel = effectiveRole ? ROLE_LABELS[effectiveRole] : '';

  return (
    <>
      <PageHeader
        title="سير الاعتماد"
        subtitle={
          isDirector
            ? `${claims.length} مستخلص نشط — إجمالي: ${fmt(totalAmount)} ريال`
            : claims.length > 0
              ? `${claims.length} طلب بانتظار الإجراء · إجمالي: ${fmt(totalAmount)} ريال`
              : 'لا توجد طلبات بانتظار الاعتماد'
        }
      />

      {/* Role context banner */}
      {userRole && (
        <div
          className={`mb-4 px-3 py-2 rounded-sm text-xs font-bold flex items-center gap-2 border ${
            isDirector
              ? 'bg-[#045859]/08 border-[#045859]/20 text-[#045859]'
              : 'bg-teal-pale border-teal/20 text-teal-dark'
          }`}
        >
          {isDirector ? <Crown size={14} strokeWidth={2.4} /> : <UserIcon size={14} strokeWidth={2.4} />}
          <span>
            {isDirector
              ? 'عرض شامل — مدير الإدارة يرى جميع المستخلصات النشطة ويملك صلاحية تعديل الإحالة في أي مرحلة'
              : <>أنت مسجّل كـ <strong>{roleLabel}</strong> — يعرض هذا القسم الطلبات الخاصة بمرحلتك فقط</>
            }
          </span>
        </div>
      )}

      {/* Multi-role badges strip — shows the deduplicated set of contract
          roles the user holds across all of their contracts. Hidden for
          directors (they have global access). The first role is rendered
          as the "primary" pill (filled teal); additional roles are
          outlined. Pure display — no logic / behaviour change. */}
      {!isDirector && rolesByContract.size > 0 && (() => {
        const allRoles: ContractRole[] = [];
        rolesByContract.forEach((roles) => {
          for (const r of roles) {
            if (!allRoles.includes(r)) allRoles.push(r);
          }
        });
        if (allRoles.length === 0) return null;
        return (
          <div className="flex items-center gap-2 mb-4 px-3 py-2 bg-teal-pale border border-teal/20 rounded-sm text-xs">
            <span className="text-teal-dark font-bold flex-shrink-0">الأدوار:</span>
            <div className="flex gap-1.5 flex-wrap">
              {allRoles.map((role, idx) => (
                <span
                  key={role}
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-[0.7rem] font-bold ${
                    idx === 0
                      ? 'bg-teal text-white'
                      : 'bg-white text-teal-dark border border-teal/30'
                  }`}
                >
                  {CONTRACT_ROLE_LABELS[role] ?? role}
                </span>
              ))}
            </div>
          </div>
        );
      })()}

      {claims.length === 0 ? (
        <EmptyState
          size="lg"
          icon={CheckCircle2}
          title={isDirector ? 'لا توجد مستخلصات نشطة في النظام' : 'لا توجد طلبات بانتظار الإجراء'}
          description={isDirector
            ? 'جميع المستخلصات إما معتمدة أو مرفوضة أو مسودات'
            : 'جميع الطلبات ضمن نطاق عملك تمت معالجتها'}
        />
      ) : (
        <>
          {/* Status filter pills */}
          {statusesPresent.length > 1 && (
            <FilterBar<ClaimStatus | 'all'>
              className="mb-4"
              value={filter}
              onChange={setFilter}
              items={[
                { value: 'all', label: 'الكل', count: claims.length },
                ...statusesPresent.map(s => ({
                  value: s,
                  label: CLAIM_STATUS_LABELS[s] ?? s,
                  count: claims.filter(c => c.status === s).length,
                })),
              ]}
            />
          )}

          {/* Grouped claim cards */}
          <div className="space-y-6">
            {(Object.entries(grouped) as [ClaimStatus, PendingClaim[]][]).map(([status, group]) => {
              const groupStage = STAGE_INFO[status];
              const GroupIcon = groupStage?.icon ?? Send;
              const nxt = NEXT_STAGE[status];
              const NxtIcon = nxt ? STAGE_INFO[nxt]?.icon : null;
              return (
              <div key={status}>
                <div className="flex items-center gap-2 mb-3">
                  <GroupIcon size={16} className="text-[#045859]" strokeWidth={2.2} />
                  <h3 className="text-sm font-bold text-teal-dark">{CLAIM_STATUS_LABELS[status]}</h3>
                  {isDirector && nxt && (
                    <span className="inline-flex items-center gap-1 text-[0.70rem] text-gray-400">
                      <ArrowRight size={11} className="text-gray-300" />
                      المرحلة التالية:
                      {NxtIcon && <NxtIcon size={11} strokeWidth={2.2} />}
                      {CLAIM_STATUS_LABELS[nxt]}
                    </span>
                  )}
                  <span className="ms-auto text-xs text-gray-400 font-bold">{group.length} طلب</span>
                </div>

                <div className="space-y-3">
                  {group.map(claim => (
                    profile && (
                      <ClaimCard
                        key={claim.id}
                        claim={claim}
                        actionContext={getActionContext(claim)}
                        actorId={profile.id}
                        availableRoles={rolesByContract.get(claim.contract_id) ?? []}
                        onRefresh={load}
                      />
                    )
                  ))}
                </div>
              </div>
              );
            })}
          </div>

          {/* Summary footer */}
          <div className="mt-6 p-4 bg-teal-pale rounded border border-teal/10 flex items-center justify-between">
            <div className="text-xs text-gray-600">
              <span className="font-bold">{filtered.length}</span> طلب معروض
              {filter !== 'all' && (
                <button onClick={() => setFilter('all')} className="ms-2 text-teal underline hover:no-underline">
                  عرض الكل
                </button>
              )}
            </div>
            <div className="text-sm font-extrabold text-teal font-display">
              {fmt(totalAmount)} <span className="text-xs font-bold text-gray-400">ريال سعودي</span>
            </div>
          </div>
        </>
      )}
    </>
  );
}
