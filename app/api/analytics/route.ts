/**
 * GET /api/analytics — Portfolio-level financial analytics (Phase 8)
 *
 * Returns executive-level KPIs:
 *   - Total portfolio value (active + completed contracts)
 *   - Total approved claims this month / this year
 *   - Claims by status (for pie chart)
 *   - Monthly spend trend (last 12 months)
 *   - Contracts by risk level (from burn rate analysis)
 *   - Top contracts by utilization %
 *   - Pending items by role
 *
 * Access: director, admin, reviewer only
 */

import { NextRequest } from 'next/server';
import { withAuth, apiOk, apiError } from 'A/lib/api-guard';

export const GET = withAuth(
  async (_req: NextRequest, ctx) => {
    const { admin } = ctx;

    try {
      // ── Parallel data load ─────────────────────────────────────
      const [
        contractsRes,
        claimsRes,
        pendingByRoleRes,
        monthlySpendRes,
      ] = await Promise.all([
        // All contracts with financial data
        admin
          .from('contracts')
          .select('id, status, base_value, duration_months, start_date, end_date, type'),

        // All claims with amounts + status
        admin
          .from('claims')
          .select('id, status, total_amount, created_at, contract_id'),

        // Pending claims by stage
        admin
          .from('claims')
          .select('status')
          .in('status', [
            'submitted',
            'under_supervisor_review',
            'under_auditor_review',
            'under_reviewer_check',
            'pending_director_approval',
          ]),

        // Monthly spend (approved claims, grouped by month)
        admin
          .from('claims')
          .select('total_amount, created_at')
          .in('status', ['approved', 'closed'])
          .gte('created_at', new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()),
      ]);

      const contracts = contractsRes.data ?? [];
      const claims    = claimsRes.data    ?? [];

      // ── Portfolio KPIs ─────────────────────────────────────────
      const activeContracts = contracts.filter(c => c.status === 'active');
      const totalPortfolioValue = contracts.reduce((s, c) => s + (c.base_value ?? 0), 0);
      const activePortfolioValue = activeContracts.reduce((s, c) => s + (c.base_value ?? 0), 0);

      // ── Claims summary ─────────────────────────────────────────
      const approvedClaims = claims.filter(c => ['approved', 'closed'].includes(c.status));
      const totalApproved  = approvedClaims.reduce((s, c) => s + (c.total_amount ?? 0), 0);

      // This month
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const approvedThisMonth = approvedClaims
        .filter(c => new Date(c.created_at) >= monthStart)
        .reduce((s, c) => s + (c.total_amount ?? 0), 0);

      // ── Claims by status (for pie chart) ──────────────────────
      const claimsByStatus: Record<string, number> = {};
      for (const claim of claims) {
        claimsByStatus[claim.status] = (claimsByStatus[claim.status] ?? 0) + 1;
      }

      // ── Pending by stage ───────────────────────────────────────
      const pendingByStage: Record<string, number> = {};
      for (const c of pendingByRoleRes.data ?? []) {
        pendingByStage[c.status] = (pendingByStage[c.status] ?? 0) + 1;
      }
      const totalPending = Object.values(pendingByStage).reduce((s, n) => s + n, 0);

      // ── Monthly spend trend ────────────────────────────────────
      const monthlySpend: Record<string, number> = {};
      for (const c of monthlySpendRes.data ?? []) {
        const month = c.created_at.slice(0, 7); // YYYY-MM
        monthlySpend[month] = (monthlySpend[month] ?? 0) + (c.total_amount ?? 0);
      }

      // Build sorted array of last 12 months
      const now = new Date();
      const spendTrend = Array.from({ length: 12 }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
        const key = d.toISOString().slice(0, 7);
        return { month: key, amount: monthlySpend[key] ?? 0 };
      });

      // ── Top contracts by utilization ───────────────────────────
      const contractUtilization = await Promise.all(
        activeContracts.slice(0, 10).map(async contract => {
          const { data: contractClaims } = await admin
            .from('claims')
            .select('total_amount')
            .eq('contract_id', contract.id)
            .in('status', ['approved', 'closed']);

          const approvedTotal = (contractClaims ?? []).reduce(
            (s, c) => s + (c.total_amount ?? 0),
            0,
          );
          const utilizationPct = contract.base_value > 0
            ? (approvedTotal / contract.base_value) * 100
            : 0;

          return {
            contract_id:     contract.id,
            base_value:      contract.base_value,
            approved_total:  approvedTotal,
            utilization_pct: utilizationPct,
            risk_level:
              utilizationPct >= 100 ? 'critical' :
              utilizationPct >=  85 ? 'high'     :
              utilizationPct >=  70 ? 'medium'   : 'low',
          };
        }),
      );

      // Sort by utilization desc
      contractUtilization.sort((a, b) => b.utilization_pct - a.utilization_pct);

      return apiOk({
        portfolio: {
          total_contracts:       contracts.length,
          active_contracts:      activeContracts.length,
          total_portfolio_value: totalPortfolioValue,
          active_portfolio_value: activePortfolioValue,
        },
        claims: {
          total:               claims.length,
          total_approved_value: totalApproved,
          approved_this_month:  approvedThisMonth,
          by_status:           claimsByStatus,
        },
        workflow: {
          total_pending:   totalPending,
          by_stage:        pendingByStage,
        },
        trends: {
          monthly_spend: spendTrend,
        },
        risk: {
          top_contracts: contractUtilization,
        },
      });

    } catch (e) {
      console.error('[GET /api/analytics]', e);
      return apiError('فشل تحميل بيانات التحليلات', 500);
    }
  },
  { roles: ['director', 'admin', 'reviewer'] },
);
