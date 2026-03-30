/**
 * POST /api/executive/automation/run
 * Evaluate + execute all automation rules. Director/admin only.
 * Returns summary of actions taken.
 */

import { NextRequest } from 'next/server';
import { withAuth, apiOk, apiError } from '@/lib/api-guard';
import { evaluateAutomationRules, executeAutomationActions } from '@/lib/automation-engine';

export const POST = withAuth(
  async (_req: NextRequest, ctx) => {
    try {
      const actions = await evaluateAutomationRules(ctx.admin);
      const results = await executeAutomationActions(ctx.admin, actions);

      const actionsRun  = results.reduce((s, r) => s + r.actionsRun, 0);
      const errorCount  = results.reduce((s, r) => s + r.errors.length, 0);

      return apiOk({
        rules_evaluated: actions.length,
        actions_run:     actionsRun,
        errors:          errorCount,
        summary:         results,
        ran_at:          new Date().toISOString(),
      });
    } catch (e) {
      console.error('[POST /api/executive/automation/run]', e);
      return apiError('فشل تشغيل محرك الأتمتة', 500);
    }
  },
  { roles: ['director', 'admin'] },
);
