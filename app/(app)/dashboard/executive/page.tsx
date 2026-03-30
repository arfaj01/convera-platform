'use client';

/**
 * CONVERA — Executive Performance Dashboard (لوحة الأداء التنفيذية)
 *
 * Sprint E — Phase 3
 *
 * Sections:
 * 1. Overall Performance KPIs
 * 2. Stage Performance Table
 * 3. Bottleneck Detection
 * 4. Top Delayed Claims
 * 5. Contract Risk Panel
 * 6. Governance Alerts
 */

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';
import PageHeader from '@/components/ui/PageHeader';
import { createBrowserSupabase } from '@/lib/supabase';

import {
  getStagePerformance,
  getUserPerformance,
  getContractPerformance,
  getOverallPerformance,
  type PerformanceClaim,
  type PerformanceContract,
  type PerformanceProfile,
  type WorkflowEvent,
  type StagePerformance,
  type UserPerformance,
  type ContractPerformance,
  type OverallPerformance,
} from '@/lib/performance-engine';
import {
  getBottlenecks,
  type BottleneckAnalysis,
} from '@/lib/bottleneck-engine';
import {
  generateGovernanceAlerts,
  buildAlertSummary,
  type GovernanceAlert,
  type GovernanceAlertSummary,
} from '@/lib/governance-alerts';
import {
  assessClaimSLA,
  getWorkingDaysElapsed,
  SLA_CONFIGS,
} from '@/lib/sla-escalation';
import { getStageLabel } from '@/lib/workflow-engine';
import type { ClaimStatus } from '@/lib/types';

// ─── Data State ─────────────────────────────────────────────────

interface ExecutiveData {
  overall: OverallPerformance;
  stagePerf: StagePerformance[];
  userPerf: UserPerformance[];
  contractPerf: ContractPerformance[];
  bottlenecks: BottleneckAnalysis;
  alertSummary: GovernanceAlertSummary;
  delayedClaims: DelayedClaim[];
}

interface DelayedClaim {
  id: string;
  claimNo: number | string;
  contractNo: string;
  currentStage: string;
  ownerRole: string;
  daysInStage: number;
  slaLimit: number;
  slaLevel: 'on_track' | 'warning' | 'overdue';
}

// ─── Data Loading ───────────────────────────────────────────────

async function loadExecutiveData(): Promise<ExecutiveData> {
  const supabase = createBrowserSupabase();

  // Parallel queries
  const [
    claimsRes,
    contractsRes,
    workflowRes,
    profilesRes,
    supervisorRes,
  ] = await Promise.all([
    supabase
      .from('claims')
      .select('id, claim_no, contract_id, status, total_amount, submitted_at, approved_at, last_transition_at, created_at, updated_at, return_reason'),
    supabase
      .from('contracts')
      .select('id, contract_no, title_ar, base_value, status'),
    supabase
      .from('claim_workflow')
      .select('id, claim_id, action, from_status, to_status, actor_id, notes, created_at')
      .order('created_at', { ascending: true }),
    supabase
      .from('profiles')
      .select('id, full_name_ar, full_name, role'),
    supabase
      .from('user_contract_roles')
      .select('contract_id, user_id, is_active')
      .eq('contract_role', 'supervisor'),
  ]);

  const claims: PerformanceClaim[] = (claimsRes.data || []).map((c: any) => ({
    id: c.id,
    claim_no: c.claim_no,
    contract_id: c.contract_id,
    status: c.status as ClaimStatus,
    total_amount: c.total_amount || 0,
    submitted_at: c.submitted_at,
    approved_at: c.approved_at,
    last_transition_at: c.last_transition_at,
    created_at: c.created_at,
    updated_at: c.updated_at,
  }));

  const contracts: PerformanceContract[] = (contractsRes.data || []).map((c: any) => ({
    id: c.id,
    contract_no: c.contract_no,
    title_ar: c.title_ar,
    base_value: c.base_value || 0,
    status: c.status,
  }));

  const workflowEvents: WorkflowEvent[] = (workflowRes.data || []).map((w: any) => ({
    id: w.id,
    claim_id: w.claim_id,
    action: w.action,
    from_status: w.from_status || '',
    to_status: w.to_status || '',
    actor_id: w.actor_id,
    notes: w.notes,
    created_at: w.created_at,
  }));

  const profiles: PerformanceProfile[] = (profilesRes.data || []).map((p: any) => ({
    id: p.id,
    full_name_ar: p.full_name_ar,
    full_name: p.full_name,
    role: p.role,
  }));

  const supervisorRoles = (supervisorRes.data || []).map((s: any) => ({
    contract_id: s.contract_id,
    user_id: s.user_id,
    is_active: s.is_active,
  }));

  // Compute analytics
  const overall = getOverallPerformance(claims, workflowEvents);
  const stagePerf = getStagePerformance(claims, workflowEvents);
  const userPerf = getUserPerformance(workflowEvents, profiles);
  const contractPerf = getContractPerformance(contracts, claims, workflowEvents);
  const bottlenecks = getBottlenecks(stagePerf);

  // Governance alerts
  const alertClaims = (claimsRes.data || []).map((c: any) => ({
    id: c.id,
    claim_no: c.claim_no,
    contract_id: c.contract_id,
    status: c.status as ClaimStatus,
    last_transition_at: c.last_transition_at,
    return_reason: c.return_reason,
  }));
  const alertContracts = contracts.map(c => ({
    id: c.id,
    contract_no: c.contract_no,
    title_ar: c.title_ar,
    status: c.status,
  }));
  const alertEvents = workflowEvents.map(w => ({
    claim_id: w.claim_id,
    action: w.action,
    from_status: w.from_status,
    to_status: w.to_status,
    created_at: w.created_at,
  }));

  const alerts = generateGovernanceAlerts({
    contracts: alertContracts,
    claims: alertClaims,
    workflowEvents: alertEvents,
    supervisorRoles,
  });
  const alertSummary = buildAlertSummary(alerts);

  // Top delayed claims
  const contractMap = new Map(contracts.map(c => [c.id, c]));
  const activeStages: ClaimStatus[] = [
    'under_supervisor_review',
    'under_auditor_review',
    'under_reviewer_check',
    'pending_director_approval',
  ];
  const roleLabels: Record<string, string> = {
    supervisor: 'جهة الإشراف',
    auditor: 'المدقق',
    reviewer: 'المراجع',
    director: 'مدير الإدارة',
  };
  const stageToRole: Record<string, string> = {
    under_supervisor_review: 'supervisor',
    under_auditor_review: 'auditor',
    under_reviewer_check: 'reviewer',
    pending_director_approval: 'director',
  };

  const delayedClaims: DelayedClaim[] = [];
  for (const c of claims) {
    if (!activeStages.includes(c.status) || !c.last_transition_at) continue;
    const config = SLA_CONFIGS[c.status];
    if (!config) continue;
    const daysInStage = getWorkingDaysElapsed(new Date(c.last_transition_at));
    const contract = contractMap.get(c.contract_id);
    const role = stageToRole[c.status] || '';

    let slaLevel: 'on_track' | 'warning' | 'overdue' = 'on_track';
    const slaPct = (daysInStage / config.limitDays) * 100;
    if (slaPct >= 100) slaLevel = 'overdue';
    else if (slaPct >= 70) slaLevel = 'warning';

    delayedClaims.push({
      id: c.id,
      claimNo: c.claim_no,
      contractNo: contract?.contract_no || '—',
      currentStage: getStageLabel(c.status),
      ownerRole: roleLabels[role] || role,
      daysInStage,
      slaLimit: config.limitDays,
      slaLevel,
    });
  }
  // Sort by days in stage descending
  delayedClaims.sort((a, b) => b.daysInStage - a.daysInStage);

  return {
    overall,
    stagePerf,
    userPerf,
    contractPerf,
    bottlenecks,
    alertSummary,
    delayedClaims,
  };
}

// ─── Component ──────────────────────────────────────────────────

export default function ExecutiveDashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState<ExecutiveData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey(k => k + 1), []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    loadExecutiveData()
      .then(setData)
      .catch(e => setError(e.message || 'حدث خطأ في تحميل البيانات'))
      .finally(() => setLoading(false));
  }, [refreshKey]);

  if (loading) return <LoadingSkeleton />;
  if (error) return (
    <div className="p-8 text-center">
      <p className="text-red-600 mb-4">{error}</p>
      <button onClick={refresh} className="px-4 py-2 bg-[#045859] text-white rounded-lg">إعادة المحاولة</button>
    </div>
  );
  if (!data) return null;

  const { overall, stagePerf, userPerf, contractPerf, bottlenecks, alertSummary, delayedClaims } = data;

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1A1A2E]">لوحة الأداء التنفيذية</h1>
          <p className="text-sm text-[#54565B] mt-1">تحليل أداء سير العمل — آخر تحديث: {new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={refresh}
            className="px-4 py-2 text-sm border border-[#DDE2E8] rounded-lg hover:bg-gray-50 transition-colors"
          >
            🔄 تحديث
          </button>
          <a
            href="/dashboard"
            className="px-4 py-2 text-sm bg-[#045859] text-white rounded-lg hover:bg-[#034342] transition-colors"
          >
            ← اللوحة الرئيسية
          </a>
        </div>
      </div>

      {/* System Health Banner */}
      <SystemHealthBanner health={bottlenecks.systemHealth} label={bottlenecks.systemHealth_ar} alertCount={alertSummary.criticalCount} />

      {/* Section 1: Overall Performance KPIs */}
      <OverallPerformanceSection overall={overall} />

      {/* Section 2: Stage Performance Table */}
      <StagePerformanceSection stagePerf={stagePerf} />

      {/* Section 3: Bottleneck Detection */}
      <BottleneckSection bottlenecks={bottlenecks} />

      {/* Section 4: Top Delayed Claims */}
      <DelayedClaimsSection claims={delayedClaims} />

      {/* Section 5: Contract Risk Panel */}
      <ContractRiskSection contracts={contractPerf} />

      {/* Section 6: User Performance */}
      <UserPerformanceSection users={userPerf} />

      {/* Section 7: Governance Alerts */}
      <GovernanceAlertsSection summary={alertSummary} />
    </div>
  );
}

// ─── Section Components ─────────────────────────────────────────

function SystemHealthBanner({ health, label, alertCount }: {
  health: 'healthy' | 'attention' | 'critical';
  label: string;
  alertCount: number;
}) {
  const colors = {
    healthy: 'bg-[#F0F7E0] border-[#87BA26] text-[#3d6b00]',
    attention: 'bg-[#FFF8E0] border-[#FFC845] text-[#8b6914]',
    critical: 'bg-[#FAEEE8] border-[#C05728] text-[#8b3516]',
  };
  const icons = { healthy: '✅', attention: '⚠️', critical: '🔴' };

  return (
    <div className={`p-4 rounded-xl border-2 ${colors[health]} flex items-center justify-between`}>
      <div className="flex items-center gap-3">
        <span className="text-2xl">{icons[health]}</span>
        <div>
          <p className="font-bold text-base">صحة النظام: {label}</p>
          {alertCount > 0 && (
            <p className="text-sm mt-0.5">{alertCount} تنبيه حرج يتطلب انتباهاً فورياً</p>
          )}
        </div>
      </div>
    </div>
  );
}

function OverallPerformanceSection({ overall }: { overall: OverallPerformance }) {
  const cards = [
    { label: 'إجمالي المطالبات', value: overall.totalClaims, color: '#045859', icon: '📊' },
    { label: 'قيد الإجراء', value: overall.inProgressClaims, color: '#00A79D', icon: '⏳' },
    { label: 'متأخرة (SLA)', value: overall.overdueClaims, color: overall.overdueClaims > 0 ? '#C05728' : '#87BA26', icon: overall.overdueClaims > 0 ? '🔴' : '✅' },
    { label: 'معتمدة', value: overall.approvedClaims, color: '#87BA26', icon: '✅' },
    { label: 'مرفوضة', value: overall.rejectedClaims, color: '#54565B', icon: '❌' },
    { label: 'متوسط المعالجة', value: `${overall.avgProcessingTime} يوم`, color: '#502C7C', icon: '⏱️' },
    { label: 'نسبة الاعتماد', value: `${overall.approvalRate}%`, color: '#045859', icon: '📈' },
    { label: 'نسبة الإرجاع', value: `${overall.returnRate}%`, color: overall.returnRate > 30 ? '#C05728' : '#FFC845', icon: '↩️' },
  ];

  return (
    <section>
      <SectionTitle>الأداء العام</SectionTitle>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        {cards.map((card, i) => (
          <div key={i} className="bg-white rounded-xl border border-[#DDE2E8] p-4 text-center hover:shadow-md transition-shadow">
            <div className="text-2xl mb-1">{card.icon}</div>
            <div className="text-2xl font-bold" style={{ color: card.color }}>
              {card.value}
            </div>
            <div className="text-xs text-[#54565B] mt-1">{card.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function StagePerformanceSection({ stagePerf }: { stagePerf: StagePerformance[] }) {
  return (
    <section>
      <SectionTitle>أداء المراحل</SectionTitle>
      <div className="bg-white rounded-xl border border-[#DDE2E8] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#045859] text-white">
              <th className="text-right py-3 px-4 font-medium">المرحلة</th>
              <th className="text-center py-3 px-4 font-medium">متوسط المدة</th>
              <th className="text-center py-3 px-4 font-medium">أقصى مدة</th>
              <th className="text-center py-3 px-4 font-medium">مهلة SLA</th>
              <th className="text-center py-3 px-4 font-medium">نسبة التجاوز</th>
              <th className="text-center py-3 px-4 font-medium">الحجم</th>
              <th className="text-center py-3 px-4 font-medium">نشطة حالياً</th>
              <th className="text-center py-3 px-4 font-medium">الحالة</th>
            </tr>
          </thead>
          <tbody>
            {stagePerf.map((sp, i) => {
              const breachColor = sp.slaBreachPct >= 50 ? '#C05728' : sp.slaBreachPct >= 25 ? '#FFC845' : '#87BA26';
              return (
                <tr key={sp.stage} className={i % 2 === 0 ? 'bg-white' : 'bg-[#F7F8FA]'}>
                  <td className="py-3 px-4 font-medium text-[#1A1A2E]">
                    {sp.stageLabel}
                    {sp.isBottleneck && (
                      <span className="inline-block ms-2 px-2 py-0.5 text-xs bg-[#FAEEE8] text-[#C05728] rounded-full">
                        اختناق
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-center font-bold">{sp.avgDuration} يوم</td>
                  <td className="py-3 px-4 text-center text-[#54565B]">{sp.maxDuration} يوم</td>
                  <td className="py-3 px-4 text-center text-[#54565B]">{sp.slaConfig?.limitDays || '—'} يوم</td>
                  <td className="py-3 px-4 text-center">
                    <span className="inline-block px-3 py-1 rounded-full text-xs font-bold text-white" style={{ backgroundColor: breachColor }}>
                      {sp.slaBreachPct}%
                    </span>
                  </td>
                  <td className="py-3 px-4 text-center">{sp.totalVolume}</td>
                  <td className="py-3 px-4 text-center font-bold" style={{ color: sp.activeCount > 0 ? '#045859' : '#54565B' }}>{sp.activeCount}</td>
                  <td className="py-3 px-4 text-center">
                    <SLABar pct={sp.slaConfig ? (sp.avgDuration / sp.slaConfig.limitDays) * 100 : 0} />
                  </td>
                </tr>
              );
            })}
            {stagePerf.length === 0 && (
              <tr><td colSpan={8} className="py-8 text-center text-[#54565B]">لا توجد بيانات كافية لتحليل المراحل</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BottleneckSection({ bottlenecks }: { bottlenecks: BottleneckAnalysis }) {
  if (!bottlenecks.primary && bottlenecks.allStages.every(s => s.severity === 'none')) {
    return (
      <section>
        <SectionTitle>كشف الاختناقات</SectionTitle>
        <div className="bg-[#F0F7E0] border border-[#87BA26] rounded-xl p-6 text-center">
          <span className="text-3xl">✅</span>
          <p className="font-bold text-[#3d6b00] mt-2">لا توجد اختناقات — جميع المراحل تعمل ضمن المعايير</p>
        </div>
      </section>
    );
  }

  return (
    <section>
      <SectionTitle>كشف الاختناقات</SectionTitle>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {bottlenecks.primary && (
          <BottleneckCard bottleneck={bottlenecks.primary} label="الاختناق الرئيسي" />
        )}
        {bottlenecks.secondary && (
          <BottleneckCard bottleneck={bottlenecks.secondary} label="اختناق ثانوي" />
        )}
      </div>
      {/* All stages severity */}
      <div className="mt-4 bg-white rounded-xl border border-[#DDE2E8] p-4">
        <p className="text-sm font-bold text-[#1A1A2E] mb-3">تقييم جميع المراحل</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {bottlenecks.allStages.map(s => (
            <div key={s.stage} className="flex items-center gap-2 p-2 rounded-lg bg-[#F7F8FA]">
              <SeverityDot severity={s.severity} />
              <div>
                <p className="text-xs font-bold text-[#1A1A2E]">{s.stageLabel}</p>
                <p className="text-[10px] text-[#54565B]">{s.metrics.avgDuration} يوم — {s.metrics.slaBreachPct}% تجاوز</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function BottleneckCard({ bottleneck, label }: { bottleneck: import('@/lib/bottleneck-engine').Bottleneck; label: string }) {
  const sevColors = {
    severe: 'border-[#C05728] bg-[#FAEEE8]',
    moderate: 'border-[#FFC845] bg-[#FFF8E0]',
    mild: 'border-[#00A79D] bg-[#E0F4F3]',
    none: 'border-[#DDE2E8] bg-white',
  };
  const sevLabels = {
    severe: 'شديد',
    moderate: 'متوسط',
    mild: 'خفيف',
    none: 'لا يوجد',
  };

  return (
    <div className={`rounded-xl border-2 p-5 ${sevColors[bottleneck.severity]}`}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-bold text-[#54565B] uppercase">{label}</p>
        <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
          bottleneck.severity === 'severe' ? 'bg-[#C05728] text-white' :
          bottleneck.severity === 'moderate' ? 'bg-[#FFC845] text-[#1A1A2E]' :
          'bg-[#00A79D] text-white'
        }`}>
          {sevLabels[bottleneck.severity]}
        </span>
      </div>
      <p className="text-lg font-bold text-[#1A1A2E] mb-2">📍 {bottleneck.stageLabel}</p>
      <p className="text-sm text-[#54565B] mb-3">{bottleneck.reason_ar}</p>
      <div className="bg-white/60 rounded-lg p-3 border border-white/80">
        <p className="text-xs font-bold text-[#045859] mb-1">💡 التوصية</p>
        <p className="text-xs text-[#54565B]">{bottleneck.recommendation_ar}</p>
      </div>
      <div className="flex gap-4 mt-3 text-xs text-[#54565B]">
        <span>المتوسط: <b>{bottleneck.metrics.avgDuration}</b> يوم</span>
        <span>التجاوز: <b>{bottleneck.metrics.slaBreachPct}%</b></span>
        <span>الحجم: <b>{bottleneck.metrics.volume}</b></span>
      </div>
    </div>
  );
}

function DelayedClaimsSection({ claims }: { claims: DelayedClaim[] }) {
  const top = claims.slice(0, 10);

  return (
    <section>
      <SectionTitle>المطالبات الأكثر تأخيراً</SectionTitle>
      <div className="bg-white rounded-xl border border-[#DDE2E8] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#045859] text-white">
              <th className="text-right py-3 px-4 font-medium">المطالبة</th>
              <th className="text-right py-3 px-4 font-medium">العقد</th>
              <th className="text-right py-3 px-4 font-medium">المرحلة</th>
              <th className="text-right py-3 px-4 font-medium">المسؤول</th>
              <th className="text-center py-3 px-4 font-medium">أيام في المرحلة</th>
              <th className="text-center py-3 px-4 font-medium">المهلة</th>
              <th className="text-center py-3 px-4 font-medium">الحالة</th>
            </tr>
          </thead>
          <tbody>
            {top.map((c, i) => {
              const levelColor = c.slaLevel === 'overdue' ? '#C05728' : c.slaLevel === 'warning' ? '#FFC845' : '#87BA26';
              const levelLabel = c.slaLevel === 'overdue' ? 'متأخرة' : c.slaLevel === 'warning' ? 'تحذير' : 'ضمن المهلة';
              return (
                <tr key={c.id} className={i % 2 === 0 ? 'bg-white' : 'bg-[#F7F8FA]'}>
                  <td className="py-3 px-4">
                    <a href={`/claims/${c.id}`} className="font-bold text-[#045859] hover:underline">#{c.claimNo}</a>
                  </td>
                  <td className="py-3 px-4 text-[#54565B]">{c.contractNo}</td>
                  <td className="py-3 px-4 text-[#1A1A2E]">{c.currentStage}</td>
                  <td className="py-3 px-4 text-[#54565B]">{c.ownerRole}</td>
                  <td className="py-3 px-4 text-center font-bold" style={{ color: c.daysInStage > c.slaLimit ? '#C05728' : '#1A1A2E' }}>
                    {c.daysInStage}
                  </td>
                  <td className="py-3 px-4 text-center text-[#54565B]">{c.slaLimit} يوم</td>
                  <td className="py-3 px-4 text-center">
                    <span className="inline-block px-3 py-1 rounded-full text-xs font-bold text-white" style={{ backgroundColor: levelColor }}>
                      {levelLabel}
                    </span>
                  </td>
                </tr>
              );
            })}
            {top.length === 0 && (
              <tr><td colSpan={7} className="py-8 text-center text-[#54565B]">لا توجد مطالبات نشطة حالياً</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ContractRiskSection({ contracts }: { contracts: ContractPerformance[] }) {
  const riskColors = {
    low: { bg: '#F0F7E0', border: '#87BA26', text: '#3d6b00', label: 'منخفض' },
    medium: { bg: '#FFF8E0', border: '#FFC845', text: '#8b6914', label: 'متوسط' },
    high: { bg: '#FAEEE8', border: '#C05728', text: '#8b3516', label: 'مرتفع' },
  };

  return (
    <section>
      <SectionTitle>تقييم مخاطر العقود</SectionTitle>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {contracts.map(c => {
          const risk = riskColors[c.riskLevel];
          return (
            <div
              key={c.contractId}
              className="rounded-xl border-2 p-5 transition-shadow hover:shadow-md"
              style={{ borderColor: risk.border, backgroundColor: risk.bg }}
            >
              <div className="flex items-center justify-between mb-3">
                <p className="font-bold text-[#1A1A2E]">{c.contractNo}</p>
                <span
                  className="px-3 py-1 rounded-full text-xs font-bold"
                  style={{ backgroundColor: risk.border, color: 'white' }}
                >
                  خطر {risk.label} — {c.riskScore}
                </span>
              </div>
              {c.titleAr && <p className="text-xs text-[#54565B] mb-3 line-clamp-1">{c.titleAr}</p>}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <MetricCell label="إجمالي المطالبات" value={c.totalClaims} />
                <MetricCell label="معتمدة" value={c.approvedClaims} />
                <MetricCell label="متأخرة" value={c.overdueClaims} color={c.overdueClaims > 0 ? '#C05728' : undefined} />
                <MetricCell label="متوسط المعالجة" value={`${c.avgDuration} يوم`} />
              </div>
              {/* Risk score bar */}
              <div className="mt-3">
                <div className="h-2 rounded-full bg-white/60 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${Math.min(c.riskScore, 100)}%`, backgroundColor: risk.border }}
                  />
                </div>
              </div>
            </div>
          );
        })}
        {contracts.length === 0 && (
          <div className="col-span-full py-8 text-center text-[#54565B] bg-white rounded-xl border border-[#DDE2E8]">لا توجد عقود لتقييمها</div>
        )}
      </div>
    </section>
  );
}

function UserPerformanceSection({ users }: { users: UserPerformance[] }) {
  if (users.length === 0) return null;

  const roleLabels: Record<string, string> = {
    director: 'مدير الإدارة',
    admin: 'مدقق',
    reviewer: 'مراجع',
    consultant: 'جهة الإشراف',
    contractor: 'مقاول',
    auditor: 'مدقق',
    supervisor: 'جهة الإشراف',
  };

  return (
    <section>
      <SectionTitle>أداء المستخدمين</SectionTitle>
      <div className="bg-white rounded-xl border border-[#DDE2E8] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#045859] text-white">
              <th className="text-right py-3 px-4 font-medium">المستخدم</th>
              <th className="text-right py-3 px-4 font-medium">الدور</th>
              <th className="text-center py-3 px-4 font-medium">المطالبات</th>
              <th className="text-center py-3 px-4 font-medium">متوسط المعالجة</th>
              <th className="text-center py-3 px-4 font-medium">أقصى مدة</th>
              <th className="text-center py-3 px-4 font-medium">تجاوز SLA</th>
              <th className="text-center py-3 px-4 font-medium">الإرجاعات</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u, i) => (
              <tr key={u.userId} className={i % 2 === 0 ? 'bg-white' : 'bg-[#F7F8FA]'}>
                <td className="py-3 px-4 font-medium text-[#1A1A2E]">{u.userName}</td>
                <td className="py-3 px-4 text-[#54565B]">{roleLabels[u.role] || u.role}</td>
                <td className="py-3 px-4 text-center font-bold">{u.claimsProcessed}</td>
                <td className="py-3 px-4 text-center">{u.avgHandlingTime} يوم</td>
                <td className="py-3 px-4 text-center text-[#54565B]">{u.maxHandlingTime} يوم</td>
                <td className="py-3 px-4 text-center">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${
                    u.slaBreachRate > 30 ? 'bg-[#FAEEE8] text-[#C05728]' :
                    u.slaBreachRate > 0 ? 'bg-[#FFF8E0] text-[#8b6914]' :
                    'bg-[#F0F7E0] text-[#3d6b00]'
                  }`}>
                    {u.slaBreachRate}%
                  </span>
                </td>
                <td className="py-3 px-4 text-center text-[#54565B]">{u.returnCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function GovernanceAlertsSection({ summary }: { summary: GovernanceAlertSummary }) {
  const categoryLabels: Record<string, string> = {
    supervisor: 'جهة الإشراف',
    overdue: 'تأخير',
    returns: 'إرجاعات',
    delay: 'تأخير شديد',
    governance: 'حوكمة',
  };
  const sevIcons = { critical: '🔴', warning: '🟡', info: 'ℹ️' };

  return (
    <section>
      <SectionTitle>التنبيهات الرقابية</SectionTitle>

      {/* Summary strip */}
      <div className="flex gap-3 mb-4">
        <div className="flex-1 bg-[#FAEEE8] border border-[#C05728] rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-[#C05728]">{summary.criticalCount}</p>
          <p className="text-xs text-[#8b3516]">حرجة</p>
        </div>
        <div className="flex-1 bg-[#FFF8E0] border border-[#FFC845] rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-[#8b6914]">{summary.warningCount}</p>
          <p className="text-xs text-[#8b6914]">تحذير</p>
        </div>
        <div className="flex-1 bg-[#E0F4F3] border border-[#00A79D] rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-[#007a72]">{summary.infoCount}</p>
          <p className="text-xs text-[#007a72]">معلومات</p>
        </div>
      </div>

      {/* Alerts list */}
      {summary.alerts.length === 0 ? (
        <div className="bg-[#F0F7E0] border border-[#87BA26] rounded-xl p-6 text-center">
          <span className="text-3xl">✅</span>
          <p className="font-bold text-[#3d6b00] mt-2">لا توجد تنبيهات رقابية — النظام سليم</p>
        </div>
      ) : (
        <div className="space-y-2">
          {summary.alerts.slice(0, 15).map(alert => (
            <div
              key={alert.id}
              className={`bg-white rounded-lg border p-4 flex items-start gap-3 ${
                alert.severity === 'critical' ? 'border-[#C05728]' :
                alert.severity === 'warning' ? 'border-[#FFC845]' :
                'border-[#DDE2E8]'
              }`}
            >
              <span className="text-lg flex-shrink-0 mt-0.5">{sevIcons[alert.severity]}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <p className="font-bold text-sm text-[#1A1A2E]">{alert.title_ar}</p>
                  <span className="flex-shrink-0 px-2 py-0.5 rounded text-[10px] font-bold bg-[#F7F8FA] text-[#54565B]">
                    {categoryLabels[alert.category] || alert.category}
                  </span>
                </div>
                <p className="text-xs text-[#54565B] leading-relaxed">{alert.description_ar}</p>
              </div>
              <a
                href={alert.entityType === 'claim' ? `/claims/${alert.entityId}` : `/contracts/${alert.entityId}`}
                className="flex-shrink-0 px-3 py-1.5 text-xs bg-[#045859] text-white rounded-lg hover:bg-[#034342] transition-colors"
              >
                عرض
              </a>
            </div>
          ))}
          {summary.alerts.length > 15 && (
            <p className="text-center text-sm text-[#54565B] py-2">
              و {summary.alerts.length - 15} تنبيه آخر...
            </p>
          )}
        </div>
      )}
    </section>
  );
}

// ─── Shared UI Components ───────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-lg font-bold text-[#1A1A2E] mb-3 flex items-center gap-2">
      <span className="w-1 h-6 bg-[#045859] rounded-full inline-block" />
      {children}
    </h2>
  );
}

function SLABar({ pct }: { pct: number }) {
  const capped = Math.min(pct, 200);
  const color = capped >= 100 ? '#C05728' : capped >= 70 ? '#FFC845' : '#87BA26';
  return (
    <div className="w-16 h-2 rounded-full bg-gray-100 overflow-hidden mx-auto">
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${Math.min(capped, 100)}%`, backgroundColor: color }}
      />
    </div>
  );
}

function SeverityDot({ severity }: { severity: import('@/lib/bottleneck-engine').BottleneckSeverity }) {
  const colors = { severe: '#C05728', moderate: '#FFC845', mild: '#00A79D', none: '#87BA26' };
  return <span className="w-3 h-3 rounded-full flex-shrink-0 inline-block" style={{ backgroundColor: colors[severity] }} />;
}

function MetricCell({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="bg-white/50 rounded-lg p-2">
      <p className="text-[10px] text-[#54565B]">{label}</p>
      <p className="font-bold text-sm" style={{ color: color || '#1A1A2E' }}>{value}</p>
    </div>
  );
}

// ─── Loading Skeleton ───────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="space-y-6 pb-12">
      <div className="h-10 bg-gray-100 rounded-xl animate-pulse w-1/3" />
      <div className="h-16 bg-gray-100 rounded-xl animate-pulse" />
      <div className="grid grid-cols-8 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />
        ))}
      </div>
      <div className="h-64 bg-gray-100 rounded-xl animate-pulse" />
      <div className="grid grid-cols-2 gap-4">
        <div className="h-48 bg-gray-100 rounded-xl animate-pulse" />
        <div className="h-48 bg-gray-100 rounded-xl animate-pulse" />
      </div>
      <div className="h-64 bg-gray-100 rounded-xl animate-pulse" />
      <div className="grid grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-40 bg-gray-100 rounded-xl animate-pulse" />
        ))}
      </div>
    </div>
  );
}
