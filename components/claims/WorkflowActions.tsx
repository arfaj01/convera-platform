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

import { useState } from 'react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { getAuthHeaders } from '@/lib/supabase';
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
  onActionComplete: () => void;
}

export default function WorkflowActions({
  claimId,
  actionContext,
  onActionComplete,
}: WorkflowActionsProps) {
  const { showToast } = useToast();
  const [modalAction, setModalAction] = useState<ClaimAction | null>(null);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);

  // ─── Single source of truth: action engine ─────────────────────
  const allActions = getAvailableActionsForClaim(actionContext);
  const workflowActions = getWorkflowActions(allActions);

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

      // Map canonical field names for return/reject reasons
      if (action.type === 'return') {
        body.returnReason = notes;
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
      onActionComplete();
    } catch (e) {
      showToast(`خطأ: ${(e as Error).message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const minLen = modalAction?.min_input_length || 10;
  const isRejectModal = modalAction?.type === 'reject';

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

      {/* Reason Modal — shown for return / reject actions */}
      <Modal
        open={!!modalAction}
        onClose={() => { setModalAction(null); setReason(''); }}
        title={modalAction ? modalAction.label_ar : ''}
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => { setModalAction(null); setReason(''); }}
            >
              إلغاء
            </Button>
            <Button
              variant={isRejectModal ? 'red' : 'teal'}
              onClick={() => modalAction && handleAction(modalAction, reason)}
              disabled={loading || reason.trim().length < minLen}
            >
              تأكيد
            </Button>
          </>
        }
      >
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
