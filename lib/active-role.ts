/**
 * CONVERA — Active-role helper
 *
 * IAM-4 (2026-05-05).
 *
 * When a user holds more than one ContractRole on the same contract,
 * the UI must let them pick the role they're acting with for a workflow
 * transition. The chosen role is forwarded to /api/claims/transition
 * as `actor_role` and validated server-side against user_contract_roles
 * before any allow-list check.
 *
 * Both the claim detail page and the workflow queue page need the same
 * stage→default-role logic. This module centralises:
 *
 *   • STAGE_DEFAULT_ROLE  — map from claim status to the role that
 *     gates the stage. Mirrors lib/workflow-engine.ts CLAIM_TRANSITIONS
 *     allowedRoles for the six gating stages.
 *
 *   • pickActiveRole()    — given the user's available contract roles
 *     and the claim's current status, return the most appropriate
 *     active role. Falls back to the first role in the list when no
 *     stage-specific role applies (preserves legacy single-role
 *     behaviour exactly).
 *
 * Both consumers (the claim detail page and the workflow queue page)
 * pass the resulting role to:
 *
 *   • <WorkflowActions activeRole={…} />     in the claim detail page
 *   • performClaimAction(…, …, actorRole)    in the workflow queue page
 *
 * Server-side authorisation is unchanged — the API still validates
 * against user_contract_roles before honouring the role. This helper
 * is a UI-only convenience.
 */

import type { ContractRole } from '@/lib/types';

/**
 * Map claim status → ContractRole that gates that stage.
 * Mirrors CLAIM_TRANSITIONS allowedRoles in lib/workflow-engine.ts for
 * the six contract-scoped gating stages (final_approver is the only
 * stage gated by contract_approvers rather than user_contract_roles —
 * the API handles it separately, so we map it here for UI parity).
 */
export const STAGE_DEFAULT_ROLE: Partial<Record<string, ContractRole>> = {
  under_supervisor_review:      'supervisor',
  under_auditor_review:         'auditor',
  under_reviewer_check:         'reviewer',
  under_technical_review:       'reviewer',
  under_quality_review:         'quality',
  under_project_manager_review: 'project_manager',
  pending_director_approval:    'final_approver',
};

/**
 * Pick the active role for a workflow transition.
 *
 * @param availableRoles  the user's active ContractRoles on the
 *                        claim's contract (post Mig 045 — may contain
 *                        more than one entry).
 * @param claimStatus     the claim's current status; used to look up
 *                        the stage's default gating role.
 * @returns               the role to forward as `actor_role`. Returns
 *                        null when the user has no contract roles at
 *                        all (the API will fall back to legacy
 *                        single-role resolution from profile.role).
 *
 * Behaviour:
 *   • If the user holds the role that gates the current stage →
 *     return that role. This is the common case for multi-role users
 *     and is the fix introduced by 0f6ca80 / extended by IAM-4.
 *   • Otherwise return the first available role. This preserves the
 *     legacy single-role behaviour: with one role the result is that
 *     role; with multiple roles where none matches the stage the
 *     selection is deterministic.
 *   • Empty input → null. The caller may want to omit `actor_role`
 *     entirely so the server can fall through to its legacy path.
 */
export function pickActiveRole(
  availableRoles: ContractRole[],
  claimStatus: string,
): ContractRole | null {
  if (!availableRoles || availableRoles.length === 0) return null;
  const stageDefault = STAGE_DEFAULT_ROLE[claimStatus] ?? null;
  if (stageDefault && availableRoles.includes(stageDefault)) {
    return stageDefault;
  }
  return availableRoles[0] ?? null;
}
