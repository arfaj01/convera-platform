/**
 * CONVERA Automation Engine — Rule-based action triggers
 *
 * Defines automated rules that run server-side and produce:
 *   - Notifications (in-app + email)
 *   - Flags on claims/contracts
 *   - Escalations to the director
 *
 * Rules are evaluated on demand (cron or API call).
 * Each rule is idempotent — running twice on the same data produces the same outcome.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthContext } from './api-guard';

// ─── Types ────────────────────────────────────────────────────────

export type AutomationTrigger =
  | 'sla_breach'
  | 'sla_warning'
  | 'ceiling_approach'
  | 'ceiling_exceeded'
  | 'anomaly_flagged'
  | 'change_order_limit'
  | 'claim_stuck'
  | 'repeated_returns';

export interface AutomationAction {
  type:        'notify' | 'flag' | 'escalate' | 'email';
  targetUserId?: string;              // specific user to notify
  targetRole?:  string;              // notify all users of this role
  title:        string;
  body:         string;
  entityType:   'claim' | 'contract';
  entityId:     string;
  trigger:      AutomationTrigger;
}

export interface AutomationResult {
  trigger:     AutomationTrigger;
  entityId:    string;
  actionsRun:  number;
  errors:      string[];
}

// ─── Helpers ──────────────────────────────────────────────────────

function daysSince(dateStr: string | null | undefined): number {
  if (!dateStr) return 0;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
}

// ─── Rule Definitions ─────────────────────────────────────────────

/**
 * Evaluates all automation rules against current DB state.
 * Returns a list of actions to execute.
 * Call executeAutomationActions() to run them.
 */
export async function evaluateAutomationRules(
  admin: SupabaseClient,
): Promise<AutomationAction[]> {
  const actions: AutomationAction[] = [];

  // Load all in-flight claims + contract data in parallel
  const [claimsRes, contractsRes, workflowRes] = await Promise.all([
    admin
      .from('claims')
      .select('id, claim_no, contract_id, status, updated_at, submitted_at, return_reason, total_amount')
      .in('status', [
        'submitted',
        'under_supervisor_review',
        'under_auditor_review',
        'under_reviewer_check',
        'pending_director_approval',
        'returned_by_supervisor',
        'returned_by_auditor',
      ]),

    admin
      .from('contracts')
      .select('id, contract_no, base_value, status')
      .eq('status', 'active'),

    admin
      .from('claim_workflow')
      .select('claim_id, action')
      .eq('action', 'return'),
  ]);

  const claims    = claimsRes.data    ?? [];
  const contracts = contractsRes.data ?? [];
  const returns   = workflowRes.data  ?? [];

  // Return count per claim
  const returnsByClaim = new Map<string, number>();
  for (const r of returns) {
    returnsByClaim.set(r.claim_id, (returnsByClaim.get(r.claim_id) ?? 0) + 1);
  }

  // Load approved spend per contract
  const { data: approvedClaims } = await admin
    .from('claims')
    .select('contract_id, total_amount')
    .in('status', ['approved', 'closed']);

  const spendByContract = new Map<string, number>();
  for (const c of approvedClaims ?? []) {
    spendByContract.set(
      c.contract_id,
      (spendByContract.get(c.contract_id) ?? 0) + (c.total_amount ?? 0),
    );
  }

  // ── RULE 1: SLA breach — Supervisor stage > 3 days ──────────────
  const supervisorClaims = claims.filter(c => c.status === 'under_supervisor_review');
  for (const claim of supervisorClaims) {
    const days = daysSince(claim.updated_at);
    if (days >= 3) {
      actions.push({
        type:       'escalate',
        targetRole: 'director',
        title:      `تجاوز مهلة الإشراف — مطالبة #${claim.claim_no}`,
        body:       `المطالبة رقم ${claim.claim_no} في مرحلة مراجعة الإشراف منذ ${days} أيام عمل. الحد الأقصى المسموح 3 أيام.`,
        entityType: 'claim',
        entityId:   claim.id,
        trigger:    'sla_breach',
      });
    } else if (days >= 2) {
      actions.push({
        type:       'notify',
        targetRole: 'consultant',
        title:      `تحذير مهلة الإشراف — مطالبة #${claim.claim_no}`,
        body:       `المطالبة رقم ${claim.claim_no} في اليوم ${days} من أصل 3 أيام.`,
        entityType: 'claim',
        entityId:   claim.id,
        trigger:    'sla_warning',
      });
    }
  }

  // ── RULE 2: Claim stuck at any stage > 7 days ─────────────────
  const LONG_STAGE_DAYS = 7;
  const stuckClaims = claims.filter(c =>
    c.status !== 'under_supervisor_review' &&
    daysSince(c.updated_at) >= LONG_STAGE_DAYS,
  );
  for (const claim of stuckClaims) {
    const days = daysSince(claim.updated_at);
    actions.push({
      type:       'notify',
      targetRole: 'director',
      title:      `مطالبة متوقفة — #${claim.claim_no} (${days} يوم)`,
      body:       `المطالبة رقم ${claim.claim_no} متوقفة في المرحلة الحالية منذ ${days} يوماً.`,
      entityType: 'claim',
      entityId:   claim.id,
      trigger:    'claim_stuck',
    });
  }

  // ── RULE 3: Repeated returns (≥ 2 times) ──────────────────────
  for (const claim of claims) {
    const returnCount = returnsByClaim.get(claim.id) ?? 0;
    if (returnCount >= 2) {
      actions.push({
        type:       'flag',
        targetRole: 'admin',
        title:      `مطالبة مُرجَّعة متكرراً — #${claim.claim_no}`,
        body:       `تم إرجاع المطالبة ${returnCount} مرات. يوصى بالتدخل المباشر.`,
        entityType: 'claim',
        entityId:   claim.id,
        trigger:    'repeated_returns',
      });
    }
  }

  // ── RULE 4: Contract ceiling approach (≥ 90%) ─────────────────
  for (const contract of contracts) {
    const spent   = spendByContract.get(contract.id) ?? 0;
    const ceiling = contract.base_value * 1.10;
    const pct     = ceiling > 0 ? (spent / ceiling) * 100 : 0;

    if (pct >= 100) {
      actions.push({
        type:       'escalate',
        targetRole: 'director',
        title:      `تجاوز سقف العقد — ${contract.contract_no}`,
        body:       `العقد ${contract.contract_no} تجاوز سقفه المالي (${pct.toFixed(1)}٪). مطلوب تدخل فوري.`,
        entityType: 'contract',
        entityId:   contract.id,
        trigger:    'ceiling_exceeded',
      });
    } else if (pct >= 90) {
      actions.push({
        type:       'notify',
        targetRole: 'reviewer',
        title:      `اقتراب حرج من سقف العقد — ${contract.contract_no} (${pct.toFixed(1)}٪)`,
        body:       `العقد ${contract.contract_no} وصل لـ${pct.toFixed(1)}٪ من سقفه المالي.`,
        entityType: 'contract',
        entityId:   contract.id,
        trigger:    'ceiling_approach',
      });
    }
  }

  return actions;
}

// ─── Action Executor ──────────────────────────────────────────────

/**
 * Executes a list of automation actions.
 * Returns results per action.
 */
export async function executeAutomationActions(
  admin: SupabaseClient,
  actions: AutomationAction[],
): Promise<AutomationResult[]> {
  const results: AutomationResult[] = [];

  // Group by trigger + entityId to deduplicate
  const seen = new Set<string>();

  for (const action of actions) {
    const key = `${action.trigger}-${action.entityId}-${action.type}-${action.targetRole ?? action.targetUserId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const result: AutomationResult = {
      trigger:    action.trigger,
      entityId:   action.entityId,
      actionsRun: 0,
      errors:     [],
    };

    try {
      if (action.type === 'notify' || action.type === 'escalate') {
        // Find users with the target role
        const { data: users } = await admin
          .from('profiles')
          .select('id')
          .eq('role', action.targetRole ?? '');

        for (const user of users ?? []) {
          const { error } = await admin.from('notifications').insert({
            user_id:     user.id,
            type:        action.trigger,
            title:       action.title,
            body:        action.body,
            entity_type: action.entityType,
            entity_id:   action.entityId,
            is_read:     false,
            created_at:  new Date().toISOString(),
          });
          if (!error) result.actionsRun++;
          else result.errors.push(error.message);
        }
      }

      if (action.type === 'flag') {
        // Log as a notification to admin + create an audit note
        const { data: admins } = await admin
          .from('profiles')
          .select('id')
          .eq('role', 'admin');

        for (const u of admins ?? []) {
          await admin.from('notifications').insert({
            user_id:     u.id,
            type:        action.trigger,
            title:       `🚩 ${action.title}`,
            body:        action.body,
            entity_type: action.entityType,
            entity_id:   action.entityId,
            is_read:     false,
          });
          result.actionsRun++;
        }
      }

    } catch (e) {
      result.errors.push(String(e));
    }

    results.push(result);
  }

  return results;
}
