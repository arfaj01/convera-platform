'use client';

/**
 * WorkflowActions — Unified Action Buttons (محرك الإجراءات الموحد)
 *
 * NOW POWERED BY action-engine.ts — the single source of truth for all actions.
 *
 * SECURITY:
 *  - All transitions go through POST /api/claims/transition (server-side).
 *  - The API resolves the actor's role from the authenticated JWT session.
 *  - actorId is NOT sent in the request body to prevent impersonation.
 *  - Available actions come from getAvailableActionsForClaim() which
 *    consumes CLAIM_TRANSITIONS internally — same validation chain.
 */

import { useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { getAuthHeaders } from '@/lib/supabase';
import type { ClaimStatus, ContractRole } from '@/lib/types';
import {
  type ClaimAction,
  type ActionContext,
  getAvailableActionsForClaim,
  getWorkflowActions,
  actionVariantToButtonVariant,
} from '@/lib/action-engine';

interface WorkflowActionsProps {
  claimId: string;
  /** Full action context — replaces individual status/role props */
  actionContext: ActionContext;
  /**
   * Multi-role fix (2026-05-05) — the contract role the user has
   * selected via the role-chip strip on the claim detail page. When
   * present this value is forwarded as `actor_role` in the transition
   * request body. The server validates it against user_contract_roles
   * before using it (frontend is never trusted blindly). Optional for
   * backward compatibility — when omitted, the server falls back to
   * the legacy single-role resolution path.
   */
  activeRole?: ContractRole | null;
  onActionComplete: () => void;
}

export default function WorkflowActions({
  claimId,
  actionContext,
  activeRole,
  onActionComplete,
}: WorkflowActionsProps) {
  const { showToast } = useToast();
  const [modalAction, setModalAction] = useState<ClaimAction | null>(null);
  const [reason, setReason] = useState('');
  const [pickedTarget, setPickedTarget] = useState<ClaimStatus | null>(null);
  const [loading, setLoading] = useState(false);

  // ─── Single source of truth: action engine ─────────────────────
  const allActions = getAvailableActionsForClaim(actionContext);
  const workflowActions = getWorkflowActions(allActions);

  // Phase 2.6 — when the modal opens with a flexible-return action,
  // pre-select the contractor-bound default (index 0). For non-return
  // or single-target actions, pickedTarget stays null.
  useEffect(() => {
    if (modalAction?.returnTargets && modalAction.returnTargets.length > 0) {
      setPickedTarget(modalAction.returnTargets[0].toStatus);
    } else {
      setPickedTarget(null);
    }
  }, [modalAction]);

  if (workflowActions.length === 0) return null;

  /**
   * Execute a workflow transition via the server-side API route.
   * The API resolves actorId and role from the session — we do NOT send actorId.
   */
  const handleAction = async (action: ClaimAction, notes?: string) => {
    if (!action.workflowAction) return;

    setLoading(true);
    try {
      const body: Record<string, string | undefined> = {
        claimId,
        action: action.workflowAction,
        notes,
      };

      // Multi-role fix (2026-05-05) — surface the user's selected
      // contract role to /api/claims/transition. The server validates
      // it against user_contract_roles before trusting it; if invalid,
      // the route returns 403 with a clear Arabic message. Omitted
      // when the page didn't pass an activeRole (single-role fallback).
      if (activeRole) {
        body.actor_role = activeRole;
      }

      // Map canonical field names for return/reject reasons
      if (action.type === 'return') {
        body.returnReason = notes;
        // Phase 2.6 — flexible-return: forward the picked target.
        // Server still validates it against the allow-list (commit #7).
        if (pickedTarget) {
          body.to_status = pickedTarget;
        }
      }
      if (action.type === 'reject') {
        body.rejectionReason = notes;
      }

      const headers = await getAuthHeaders();
      const res = await fetch('/api/claims/transition', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }

      showToast('تم تنفيذ الإجراء بنجاح', 'ok');
      setModalAction(null);
      setReason('');
      setPickedTarget(null);
      onActionComplete();
    } catch (e) {
      showToast(`خطأ: ${(e as Error).message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const minLen = modalAction?.min_input_length || 10;
  const isRejectModal = modalAction?.type === 'reject';
  // Phase 2.6 — confirmation gating for flexible-return:
  //   (a) a target must be picked (only relevant when returnTargets exists)
  //   (b) reason length ≥ minLen (server enforces ≥20; UI matches)
  const hasReturnTargets = !!modalAction?.returnTargets && modalAction.returnTargets.length > 0;
  const confirmDisabled =
    loading ||
    reason.trim().length < minLen ||
    (hasReturnTargets && !pickedTarget);

  return (
    <div className={`flex gap-2 flex-wrap ${loading ? 'pointer-events-none opacity-70' : ''}`}>
      {workflowActions.map(action => (
        <div key={action.workflowAction || action.type} className="relative group">
          <Button
            variant={actionVariantToButtonVariant(action.variant)}
            onClick={() => {
              if (loading) return; // extra guard against double-click
              if (action.requires_input) {
                setModalAction(action);
              } else if (action.type === 'cancel') {
                // Cancel is permanent — require explicit confirmation
                if (window.confirm('هل أنت متأكد من إلغاء المطالبة نهائياً؟ لا يمكن التراجع عن هذا الإجراء.')) {
                  handleAction(action);
                }
              } else {
                handleAction(action);
              }
            }}
            disabled={loading || !action.enabled}
          >
            {loading && action.enabled ? (
              <span className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                {action.label_ar}
              </span>
            ) : action.label_ar}
          </Button>
          {/* Disabled reason tooltip */}
          {!action.enabled && action.reason_if_disabled && (
            <div className="absolute bottom-full mb-1 right-0 hidden group-hover:block z-50 w-56 p-2 bg-gray-800 text-white text-[0.65rem] rounded shadow-lg leading-relaxed">
              {action.reason_if_disabled}
            </div>
          )}
        </div>
      ))}

      {/* Reason / Return-target Modal — shown for return / reject actions */}
      <Modal
        open={!!modalAction}
        onClose={() => { setModalAction(null); setReason(''); setPickedTarget(null); }}
        title={modalAction ? modalAction.label_ar : ''}
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => { setModalAction(null); setReason(''); setPickedTarget(null); }}
            >
              إلغاء
            </Button>
            <Button
              variant={isRejectModal ? 'red' : 'teal'}
              onClick={() => modalAction && handleAction(modalAction, reason)}
              disabled={confirmDisabled}
            >
              تأكيد
            </Button>
          </>
        }
      >
        {/* Phase 2.6 — flexible-return target picker.
            Renders ONLY when the action carries returnTargets (i.e. a
            stage with multiple allowed return destinations). Single-target
            legacy returns and reject actions skip this block. */}
        {hasReturnTargets && modalAction?.returnTargets && (
          <div className="mb-4">
            <label className="block text-xs font-bold text-gray-600 mb-1.5">
              إرجاع إلى <span className="text-red-500">*</span>
            </label>
            <div className="flex flex-col gap-1.5 bg-gray-50 rounded p-2 border border-gray-200">
              {modalAction.returnTargets.map((target, idx) => (
                <label
                  key={target.toStatus}
                  className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-white"
                >
                  <input
                    type="radio"
                    name="return-target"
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
          {isRejectModal ? 'سبب الرفض (إلزامي)' : 'سبب الإرجاع (إلزامي)'}
        </label>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder={`اكتب السبب بشكل واضح (${minLen} أحرف على الأقل)...`}
          className="w-full p-2.5 border border-gray-200 rounded text-sm bg-gray-50 focus:border-[#045859] focus:outline-none resize-y min-h-[80px]"
        />
        {reason.length > 0 && reason.trim().length < minLen && (
          <p className="text-xs text-red-500 mt-1">
            يجب كتابة {minLen} أحرف على الأقل
          </p>
        )}
      </Modal>
    </div>
  );
}
