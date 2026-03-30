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
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/components/AuthProvider';
import { fetchPendingClaims, performClaimAction } from '@/services/workflow';
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

// ─── ContractRole → Pending Statuses ─────────────────────────────
const CONTRACT_ROLE_STATUSES: Partial<Record<ContractRole, ClaimStatus[]>> = {
  supervisor: ['under_supervisor_review'],
  auditor:    ['under_auditor_review'],
  reviewer:   ['under_reviewer_check'],
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

const STAGE_INFO: Partial<Record<ClaimStatus, { label: string; color: string; icon: string }>> = {
  submitted:                 { label: 'مُقدَّم (توجيه تلقائي)',         color: '#FFC845', icon: '📩' },
  under_supervisor_review:   { label: 'قيد مراجعة جهة الإشراف',       color: '#00A79D', icon: '🔍' },
  returned_by_supervisor:    { label: 'مُرجَع من جهة الإشراف',         color: '#C05728', icon: '↩️' },
  under_auditor_review:      { label: 'قيد مراجعة المدقق',             color: '#502C7C', icon: '🔎' },
  returned_by_auditor:       { label: 'مُرجَع من المدقق',               color: '#C05728', icon: '↩️' },
  under_reviewer_check:      { label: 'قيد فحص المراجع',               color: '#C05728', icon: '📋' },
  pending_director_approval: { label: 'بانتظار اعتماد المدير',          color: '#045859', icon: '✍️' },
  approved:                  { label: 'معتمد',                          color: '#87BA26', icon: '✅' },
  rejected:                  { label: 'مرفوض',                          color: '#C05728', icon: '❌' },
};

const STAGE_LABELS: Partial<Record<ClaimStatus, string>> = {
  under_supervisor_review:   'قيد مراجعة جهة الإشراف',
  under_auditor_review:      'قيد مراجعة المدقق',
  under_reviewer_check:      'قيد فحص المراجع',
  pending_director_approval: 'بانتظار اعتماد المدير',
};

// ─── SLA Helper ──────────────────────────────────────────────────
function calcSLA(submittedAt: string | null): { days: number; isWarning: boolean; isBreach: boolean } | null {
  if (!submittedAt) return null;
  const ms = Date.now() - new Date(submittedAt).getTime();
  const days = ms / (1000 * 60 * 60 * 24);
  return { days: Math.floor(days), isWarning: days >= 2, isBreach: days >= 3 };
}

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
  onDone,
}: {
  claim: PendingClaim;
  actionContext: ActionContext;
  actorId: string;
  onDone: () => void;
}) {
  const { showToast } = useToast();
  const [modalAction, setModalAction] = useState<ClaimAction | null>(null);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);

  // ── Single source of truth: action engine ──
  const allActions = getAvailableActionsForClaim(actionContext);
  const wfActions = getWorkflowActions(allActions);

  // Also include director_override if present
  const directorOverride = allActions.find(a => a.type === 'director_override');

  if (wfActions.length === 0 && !directorOverride) return null;

  const execute = async (action: ClaimAction, notes?: string) => {
    if (!action.workflowAction) return;
    setLoading(true);
    try {
      await performClaimAction(
        claim.id,
        action.workflowAction,
        actorId,
        claim.status,
        action.toStatus || claim.status,
        notes,
      );
      showToast('تم تنفيذ الإجراء بنجاح ✓', 'ok');
      setModalAction(null);
      setReason('');
      onDone();
    } catch (e) {
      showToast(`خطأ: ${(e as Error).message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const minLen = modalAction?.min_input_length || 10;
  const isReject = modalAction?.type === 'reject';

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
              {loading ? '⏳' : action.label_ar}
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
            🔀 {directorOverride.label_ar}
          </Button>
        )}
      </div>

      {/* Reason / Override Modal */}
      <Modal
        open={!!modalAction}
        onClose={() => { setModalAction(null); setReason(''); }}
        title={modalAction?.label_ar || ''}
        footer={
          <>
            <Button variant="outline" onClick={() => { setModalAction(null); setReason(''); }}>إلغاء</Button>
            <Button
              variant={isReject ? 'red' : 'teal'}
              onClick={() => modalAction && execute(modalAction, reason)}
              disabled={loading || reason.length < minLen}
            >
              {loading ? '⏳ جاري التنفيذ...' : 'تأكيد'}
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
                await performClaimAction(claim.id, 'director_override', actorId, claim.status, targetStatus, notes);
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
            <label className="block text-xs font-bold text-gray-600 mb-1">
              {isReject ? 'سبب الرفض (إلزامي)' : 'سبب الإرجاع (إلزامي)'}
            </label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="اكتب السبب بشكل واضح (10 أحرف على الأقل)..."
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
      <div className="p-3 bg-gray-50 rounded border border-gray-100 text-xs">
        <span className="text-gray-500">المرحلة الحالية: </span>
        <span className="font-bold text-teal-dark">
          {STAGE_INFO[claim.status]?.icon} {CLAIM_STATUS_LABELS[claim.status] || claim.status}
        </span>
      </div>

      <div>
        <label className="block text-xs font-bold text-gray-700 mb-2">
          إحالة المطالبة إلى المرحلة:
        </label>
        <div className="space-y-2">
          {availableStages.map(s => (
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
              <div className="text-xs font-bold text-gray-800">
                {STAGE_INFO[s]?.icon} {STAGE_LABELS[s] || CLAIM_STATUS_LABELS[s] || s}
              </div>
            </label>
          ))}
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

      <div className="p-2.5 bg-[#FFF8E0] border border-[#FFC845]/40 rounded text-xs text-[#7A4F00]">
        ⚠ هذا الإجراء يُسجَّل في سجل التدقيق ويُحال المستخلص مباشرةً إلى المرحلة المختارة.
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
  onRefresh,
}: {
  claim: PendingClaim;
  actionContext: ActionContext;
  actorId: string;
  onRefresh: () => void;
}) {
  const router = useRouter();
  const contract = claim.contracts;
  const sla = claim.status === 'under_supervisor_review' ? calcSLA(claim.submitted_at) : null;
  const stage = STAGE_INFO[claim.status];
  const nextStage = NEXT_STAGE[claim.status];
  const nextStageInfo = nextStage ? STAGE_INFO[nextStage] : null;

  return (
    <Card className="hover:shadow-cardHover transition-all">
      <CardBody>
        {/* Stage pipeline strip */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {stage && (
            <span
              className="inline-flex items-center gap-1.5 text-[0.72rem] font-bold px-2 py-0.5 rounded-full"
              style={{ color: stage.color, background: `${stage.color}18` }}
            >
              {stage.icon} {stage.label}
            </span>
          )}
          {nextStageInfo && nextStage && (
            <>
              <span className="text-gray-300 text-xs font-bold">←</span>
              <span className="inline-flex items-center gap-1.5 text-[0.70rem] font-bold px-2 py-0.5 rounded-full text-gray-500 bg-gray-100 border border-gray-200">
                {nextStageInfo.icon} {STAGE_LABELS[nextStage] || CLAIM_STATUS_LABELS[nextStage] || nextStage}
              </span>
            </>
          )}
          {sla?.isBreach && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.68rem] font-bold bg-[#FDECEA] text-red">
              ⚠ تجاوز SLA
            </span>
          )}
          {sla?.isWarning && !sla.isBreach && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.68rem] font-bold bg-[#FFF8E0] text-[#C46A00]">
              ⏰ تنبيه SLA
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
                  <span className={sla.isBreach ? 'text-red font-bold' : sla.isWarning ? 'text-[#C46A00] font-bold' : ''}>
                    {sla.days} أيام في المراجعة
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
  const [roleByContract, setRoleByContract] = useState<Map<string, ContractRole>>(new Map());

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

          // Build map: contract_id → ContractRole (for action engine)
          const cRoleMap = new Map<string, ContractRole>();
          for (const r of myRoles) {
            cRoleMap.set(r.contract_id, r.contract_role as ContractRole);
          }
          setRoleByContract(cRoleMap);

          const actionable: PendingClaim[] = [];
          let primaryRole: ContractRole | null = null;

          for (const claim of all) {
            const cRole = myRoles.find(r => r.contract_id === claim.contract_id)?.contract_role as ContractRole | undefined;
            if (!cRole) continue;

            if (cRole === 'contractor') {
              if (claim.status === 'returned_by_supervisor' || claim.status === 'returned_by_auditor') {
                actionable.push(claim);
                if (!primaryRole) primaryRole = 'contractor';
              }
              continue;
            }

            const statuses = CONTRACT_ROLE_STATUSES[cRole];
            if (statuses && statuses.includes(claim.status)) {
              actionable.push(claim);
              if (!primaryRole) primaryRole = cRole;
            }
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
    const cRole = roleByContract.get(claim.contract_id) || null;
    return buildActionContext({
      userId: profile?.id || '',
      globalRole: userRole || 'contractor',
      contractRole: isDirector ? null : cRole,
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
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: '#E8F4F4' }}>
            <svg className="w-8 h-8" style={{ color: '#045859' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>
          <h3 className="text-base font-bold mb-2" style={{ color: '#045859' }}>
            لا توجد عقود مرتبطة بحسابك حالياً
          </h3>
          <p className="text-sm text-gray-500 max-w-sm leading-relaxed">
            تم تقييد صلاحياتك التشغيلية — لا يمكن عرض طلبات الاعتماد بدون عقود مرتبطة.
            تواصل مع مدير الإدارة لتفعيل الصلاحيات.
          </p>
        </div>
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
          <span>{isDirector ? '👑' : '👤'}</span>
          <span>
            {isDirector
              ? 'عرض شامل — مدير الإدارة يرى جميع المستخلصات النشطة ويملك صلاحية تعديل الإحالة في أي مرحلة'
              : <>أنت مسجّل كـ <strong>{roleLabel}</strong> — يعرض هذا القسم الطلبات الخاصة بمرحلتك فقط</>
            }
          </span>
        </div>
      )}

      {claims.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-5xl mb-4">✅</div>
          <p className="text-base font-bold text-gray-600 mb-1">
            {isDirector ? 'لا توجد مستخلصات نشطة في النظام' : 'لا توجد طلبات بانتظار الإجراء'}
          </p>
          <p className="text-sm text-gray-400">
            {isDirector
              ? 'جميع المستخلصات إما معتمدة أو مرفوضة أو مسودات'
              : 'جميع الطلبات ضمن نطاق عملك تمت معالجتها'}
          </p>
        </div>
      ) : (
        <>
          {/* Status filter tabs */}
          {statusesPresent.length > 1 && (
            <div className="flex gap-2 mb-4 flex-wrap">
              <button
                onClick={() => setFilter('all')}
                className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
                  filter === 'all' ? 'bg-teal text-white' : 'bg-gray-100 text-gray-600 hover:bg-teal-pale'
                }`}
              >
                الكل ({claims.length})
              </button>
              {statusesPresent.map(s => (
                <button
                  key={s}
                  onClick={() => setFilter(s)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
                    filter === s ? 'bg-teal text-white' : 'bg-gray-100 text-gray-600 hover:bg-teal-pale'
                  }`}
                >
                  {STAGE_INFO[s]?.icon} {CLAIM_STATUS_LABELS[s]} ({claims.filter(c => c.status === s).length})
                </button>
              ))}
            </div>
          )}

          {/* Grouped claim cards */}
          <div className="space-y-6">
            {(Object.entries(grouped) as [ClaimStatus, PendingClaim[]][]).map(([status, group]) => (
              <div key={status}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-base">{STAGE_INFO[status]?.icon || '📄'}</span>
                  <h3 className="text-sm font-bold text-teal-dark">{CLAIM_STATUS_LABELS[status]}</h3>
                  {isDirector && NEXT_STAGE[status] && (
                    <span className="text-[0.70rem] text-gray-400">
                      ← المرحلة التالية: {STAGE_INFO[NEXT_STAGE[status]!]?.icon} {CLAIM_STATUS_LABELS[NEXT_STAGE[status]!]}
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
                        onRefresh={load}
                      />
                    )
                  ))}
                </div>
              </div>
            ))}
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
