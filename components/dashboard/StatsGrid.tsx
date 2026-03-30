'use client';

import StatCard from '@/components/ui/StatCard';
import { fmt } from '@/lib/formatters';
import type { ContractView, ClaimView, ContractCeiling } from '@/lib/types';

interface StatsGridProps {
  contracts: ContractView[];
  claims: ClaimView[];
  ceilings?: ContractCeiling[];
}

/* ── Risk Rules ─────────────────────────────────────────────────
 *  Contracts:   green (normal)
 *  Claims:      green if <5 pending, yellow if 5-10, red if >10
 *  Pending:     green if 0, yellow if 1-3, red if >3
 *  Approved:    green if <70% of total, yellow if 70-90%, red if >90%
 * ─────────────────────────────────────────────────────────────── */

type RiskLevel = 'green' | 'yellow' | 'red' | 'none';

function pendingRisk(count: number): RiskLevel {
  if (count === 0) return 'green';
  if (count <= 3) return 'yellow';
  return 'red';
}

function spendRisk(spent: number, total: number): RiskLevel {
  if (total === 0) return 'green';
  const pct = spent / total;
  if (pct < 0.7) return 'green';
  if (pct < 0.9) return 'yellow';
  return 'red';
}

export default function StatsGrid({ contracts, claims, ceilings }: StatsGridProps) {
  const totalValue = contracts.reduce((s, c) => s + c.value, 0);
  const approvedClaims = claims.filter(c => c.status === 'approved');
  const pendingClaims = claims.filter(c =>
    ['submitted', 'under_consultant_review', 'under_admin_review', 'pending_director_approval'].includes(c.status)
  );
  const totalApproved = approvedClaims.reduce((s, c) => s + c.total, 0);

  // Amendment stats
  const totalAmendments = ceilings?.reduce((s, c) => s + c.amendmentCount, 0) ?? 0;
  const totalAmendmentValue = ceilings?.reduce((s, c) => s + c.amendmentsTotal, 0) ?? 0;

  // Overspend indicators
  const provisionalCount = ceilings?.filter(c =>
    !c.hasAmendments && c.totalSpent > c.baseValue && c.totalSpent <= c.baseValue * 1.10
  ).length ?? 0;

  const overLimitCount = ceilings?.filter(c => {
    if (c.hasAmendments) return c.totalSpent > c.ceiling;
    return c.totalSpent > c.baseValue * 1.10;
  }).length ?? 0;

  return (
    <>
      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-2">
        <StatCard
          icon="📋"
          label="العقود النشطة"
          value={String(contracts.length)}
          theme="teal"
          risk="green"
          subtitle={`بقيمة ${fmt(totalValue)} ريال`}
        />
        <StatCard
          icon="📄"
          label="المطالبات المقدمة"
          value={String(claims.length)}
          theme="lime"
          risk="green"
          subtitle={`${approvedClaims.length} معتمد`}
        />
        <StatCard
          icon="⏳"
          label="بانتظار الاعتماد"
          value={String(pendingClaims.length)}
          theme="orange"
          risk={pendingRisk(pendingClaims.length)}
        />
        <StatCard
          icon="💰"
          label="إجمالي المعتمد"
          value={fmt(totalApproved)}
          theme="blue"
          risk={spendRisk(totalApproved, totalValue)}
          subtitle="ريال سعودي"
        />
      </div>

      {/* Amendment mini-stats + overspend warnings → Alert Strip */}
      {(totalAmendments > 0 || provisionalCount > 0 || overLimitCount > 0) && (
        <div className="flex gap-2 mb-2 flex-wrap">
          {totalAmendments > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#EBF1FA] border border-[#1A4B8C]/10 rounded text-xs">
              <span className="text-sm">📝</span>
              <span className="font-bold text-[#1A4B8C]">{totalAmendments} تعديل</span>
              <span className="text-[#1A4B8C]/60">بقيمة {fmt(totalAmendmentValue)} ر.س</span>
            </div>
          )}
          {provisionalCount > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#FEF3E2] border border-[#F59E0B]/20 rounded text-xs">
              <span className="text-sm">⚠️</span>
              <span className="font-bold text-[#C46A00]">{provisionalCount} عقد — تجاوز ضمن النطاق المؤقت</span>
            </div>
          )}
          {overLimitCount > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#FDECEA] border border-[#DC2626]/20 rounded text-xs">
              <span className="text-sm">🚨</span>
              <span className="font-bold text-[#C0392B]">{overLimitCount} عقد — تجاوز يتطلب تعديل عقد</span>
            </div>
          )}
        </div>
      )}
    </>
  );
}
