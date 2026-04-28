'use client';

/**
 * DecisionHub — top-of-page executive landing zone for /dashboard/executive.
 *
 * Answers five questions a director should be able to answer in 10 seconds:
 *   1. What needs my attention today?
 *   2. Which claims are risky?
 *   3. Which contracts are financially exposed?
 *   4. Where is the workflow delayed?
 *   5. What decision should be taken?
 *
 * Pulls from services/dashboard.ts (already production-ready).
 */

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ShieldAlert,
  Receipt,
  FileText,
  Building2,
  Clock,
  CheckCircle2,
  TrendingDown,
  RotateCcw,
} from 'lucide-react';
import KpiCard from '@/components/ui/KpiCard';
import SectionCard from '@/components/ui/SectionCard';
import AlertCard from '@/components/ui/AlertCard';
import EmptyState from '@/components/ui/EmptyState';
import StatusBadge from '@/components/ui/StatusBadge';
import { loadDashboardData, type DashboardData, type AttentionItem, type ContractSpend } from '@/services/dashboard';
import { fmtCurrency } from '@/lib/formatters';

// ─── Helpers ───────────────────────────────────────────────────────

function shortMoney(v: number): string {
  if (v >= 1_000_000_000) return (v / 1_000_000_000).toFixed(1) + ' مليار';
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + ' مليون';
  if (v >= 1_000) return (v / 1_000).toFixed(0) + ' ألف';
  return Math.round(v).toString();
}

const SEVERITY_LEVEL: Record<AttentionItem['severity'], 'critical' | 'warning' | 'info'> = {
  critical: 'critical',
  warning:  'warning',
  info:     'info',
};

// ─── Component ─────────────────────────────────────────────────────

export default function DecisionHub() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    loadDashboardData()
      .then(d => { if (alive) { setData(d); setError(null); } })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[0,1,2,3].map(i => (
          <div key={i} className="bg-gray-100 animate-pulse rounded-xl h-24" />
        ))}
      </div>
    );
  }
  if (error || !data) {
    return (
      <AlertCard
        level="warning"
        title="تعذّر تحميل لوحة القرارات"
        description={error ?? 'حدث خطأ غير متوقع'}
      />
    );
  }

  const { kpis, contractSpends, attentionItems, claimsByStatus, recentActivity, changeOrders } = data;

  // Top-5 contracts by exposure: closest to ceiling first
  const topExposed: ContractSpend[] = [...contractSpends]
    .filter(c => c.baseValue > 0)
    .sort((a, b) => b.pctConsumed - a.pctConsumed)
    .slice(0, 5);

  // Approved / rejected counts
  const claimCount = (status: string) => claimsByStatus.find(c => c.status === status)?.count ?? 0;
  const approvedCount = claimCount('approved');
  const rejectedCount = claimCount('rejected');
  const submittedCount = claimsByStatus
    .filter(c => c.status === 'submitted' || c.status === 'under_supervisor_review' || c.status === 'under_auditor_review' || c.status === 'under_reviewer_check' || c.status === 'pending_director_approval')
    .reduce((sum, c) => sum + c.count, 0);

  // Change-orders threshold: contracts at >= 9% of base
  const coAtRisk = changeOrders.filter(co => co.pctOfBase >= 9).length;

  // Attention items sorted by severity
  const attention = [...attentionItems].sort((a, b) => {
    const order = { critical: 0, warning: 1, info: 2 };
    return order[a.severity] - order[b.severity];
  });

  // Recommended actions = top 3 critical attention items
  const recommendations = attention.filter(a => a.severity === 'critical').slice(0, 3);

  return (
    <div className="space-y-5 mb-6">
      {/* ── Q5: Recommended actions banner ───────────────────────── */}
      {recommendations.length > 0 ? (
        <div className="space-y-2">
          {recommendations.map((rec, i) => (
            <AlertCard
              key={i}
              level={SEVERITY_LEVEL[rec.severity]}
              title={rec.title}
              description={rec.subtitle}
              action={
                rec.claimId ? (
                  <a
                    href={`/claims/${rec.claimId}`}
                    className="inline-block text-xs font-bold text-[#045859] hover:underline"
                  >
                    عرض المطالبة ←
                  </a>
                ) : rec.contractId ? (
                  <a
                    href={`/contracts/${rec.contractId}`}
                    className="inline-block text-xs font-bold text-[#045859] hover:underline"
                  >
                    عرض العقد ←
                  </a>
                ) : null
              }
            />
          ))}
        </div>
      ) : (
        <AlertCard
          level="success"
          title="لا توجد تنبيهات حرجة الآن"
          description="جميع المؤشرات ضمن الحدود المسموح بها"
        />
      )}

      {/* ── Q1+Q4: KPI strip ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="العقود النشطة"
          value={kpis.activeContractCount}
          hint={'القيمة الإجمالية: ' + shortMoney(kpis.totalContractValue) + ' ر.س'}
          tone="primary"
          icon={Building2}
          href="/contracts"
        />
        <KpiCard
          label="مطالبات قيد المراجعة"
          value={submittedCount}
          hint={kpis.pendingDirectorValue > 0 ? 'قيمة بانتظار المدير: ' + shortMoney(kpis.pendingDirectorValue) + ' ر.س' : undefined}
          tone="info"
          icon={Receipt}
          href="/workflow"
        />
        <KpiCard
          label="تنبيهات حرجة"
          value={attention.filter(a => a.severity === 'critical').length}
          hint={kpis.slaBreachedCount > 0 ? kpis.slaBreachedCount + ' تجاوز للمدة' : 'لا تنبيهات حرجة'}
          tone={attention.some(a => a.severity === 'critical') ? 'danger' : 'success'}
          icon={ShieldAlert}
          href="/action-center"
        />
        <KpiCard
          label="عقود قرب الحد"
          value={kpis.nearCeilingCount}
          hint={coAtRisk > 0 ? coAtRisk + ' عقد قرب 10%' : undefined}
          tone={kpis.nearCeilingCount > 0 ? 'warning' : 'success'}
          icon={TrendingDown}
        />
      </div>

      {/* ── Secondary KPI strip ──────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="معتمدة"
          value={approvedCount}
          tone="success"
          icon={CheckCircle2}
          sublabel="هذه الفترة"
        />
        <KpiCard
          label="مرفوضة"
          value={rejectedCount}
          tone="danger"
          icon={RotateCcw}
          sublabel="هذه الفترة"
        />
        <KpiCard
          label="إجمالي المعتمد"
          value={shortMoney(kpis.totalApprovedSpend) + ' ر.س'}
          tone="primary"
          icon={FileText}
          sublabel="من القيم الإجمالية للمطالبات"
        />
        <KpiCard
          label="تنبيه SLA"
          value={kpis.slaWarningCount}
          tone={kpis.slaWarningCount > 0 ? 'warning' : 'neutral'}
          icon={Clock}
          hint={kpis.slaBreachedCount > 0 ? kpis.slaBreachedCount + ' متجاوز' : undefined}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ── Q3: Top-5 contracts by financial exposure ──────────── */}
        <SectionCard
          title="أعلى 5 عقود من حيث الانكشاف المالي"
          subtitle="مرتبة حسب نسبة الاستهلاك من الحد الأعلى"
          icon={Building2}
        >
          {topExposed.length === 0 ? (
            <EmptyState
              size="sm"
              title="لا توجد عقود بمستهلك متقدم"
              description="جميع العقود ضمن الحد الآمن"
            />
          ) : (
            <div className="space-y-3">
              {topExposed.map(c => {
                const tone =
                  c.riskLevel === 'critical' ? 'bg-[#C0392B]'
                : c.riskLevel === 'warning'  ? 'bg-[#C46A00]'
                : 'bg-[#558B2F]';
                return (
                  <a
                    key={c.contractId}
                    href={`/contracts/${c.contractId}`}
                    className="block hover:bg-gray-50 rounded-lg p-2 -m-2 transition-colors no-underline"
                  >
                    <div className="flex items-center justify-between text-sm mb-1">
                      <div className="font-bold text-[#045859] truncate">{c.contractNo}</div>
                      <div className="text-xs text-gray-500 tabular-nums flex-shrink-0">
                        {Math.round(c.pctConsumed)}%
                      </div>
                    </div>
                    <div className="text-xs text-gray-500 truncate mb-1.5">{c.title}</div>
                    <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                      <div
                        className={'h-2 ' + tone}
                        style={{ width: Math.min(100, c.pctConsumed) + '%' }}
                      />
                    </div>
                    <div className="flex items-center justify-between mt-1 text-[11px] text-gray-500">
                      <span>المستهلك: {fmtCurrency(c.approvedSpend)}</span>
                      <span>المتبقي: {fmtCurrency(c.remaining)}</span>
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </SectionCard>

        {/* ── Q2: Latest decisions ─────────────────────────────── */}
        <SectionCard
          title="آخر القرارات"
          subtitle="آخر التحديثات على المطالبات"
          icon={Clock}
        >
          {recentActivity.length === 0 ? (
            <EmptyState size="sm" title="لا توجد تحديثات حديثة" />
          ) : (
            <ul className="divide-y divide-gray-100">
              {recentActivity.slice(0, 8).map(a => (
                <li key={a.id} className="py-2 flex items-center gap-3">
                  <a href={`/claims/${a.id}`} className="flex-1 min-w-0 no-underline">
                    <div className="text-xs text-gray-500 truncate">
                      {a.contractNo} · #{a.claimNo}
                    </div>
                    <div className="text-sm font-bold text-[#1A1A2E] truncate">
                      {a.contractTitle}
                    </div>
                  </a>
                  <div className="text-left flex-shrink-0">
                    <StatusBadge entity="claim" status={a.status} size="sm" />
                    <div className="text-[10px] text-gray-400 mt-1 tabular-nums">
                      منذ {a.daysOld} يوم
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {/* ── Q1: Full attention queue (capped at 6) ───────────────── */}
      {attention.length > 0 && (
        <SectionCard
          title="ما يحتاج إلى انتباهك"
          subtitle="مرتبة حسب الخطورة"
          icon={AlertTriangle}
        >
          <ul className="divide-y divide-gray-100">
            {attention.slice(0, 6).map((item, i) => (
              <li key={i} className="py-2.5 flex items-start gap-3">
                <div className="flex-shrink-0 mt-0.5">
                  <StatusBadge
                    tone={
                      item.severity === 'critical' ? 'danger'
                    : item.severity === 'warning' ? 'warning'
                    : 'info'
                    }
                    size="sm"
                  >
                    {item.severity === 'critical' ? 'حرج'
                    : item.severity === 'warning' ? 'تنبيه'
                    : 'معلومة'}
                  </StatusBadge>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-[#1A1A2E]">{item.title}</div>
                  <div className="text-xs text-gray-500">{item.subtitle}</div>
                </div>
                {item.claimId && (
                  <a
                    href={`/claims/${item.claimId}`}
                    className="text-xs font-bold text-[#045859] hover:underline flex-shrink-0"
                  >
                    عرض ←
                  </a>
                )}
                {!item.claimId && item.contractId && (
                  <a
                    href={`/contracts/${item.contractId}`}
                    className="text-xs font-bold text-[#045859] hover:underline flex-shrink-0"
                  >
                    عرض ←
                  </a>
                )}
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
    </div>
  );
}
