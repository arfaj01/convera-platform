'use client';

/**
 * CONVERA — Executive Dashboard
 *
 * لوحة القيادة التنفيذية
 * Audience: Director + Reviewers + Auditors
 *
 * Sections:
 * 1. Financial KPI Strip (8 cards)
 * 2. Action Center Banner
 * 3. Intelligence KPI Strip (6 operational cards) [Sprint E]
 * 4. Executive Intelligence Row (Risk / Attention / Performance)
 * 5. Stage Distribution + Needs Attention + Most Delayed [Sprint E]
 * 6. Charts row (Claims by status + Delayed by stage)
 * 7. Financial Charts row (Contract spend + Ceiling progress)
 * 8. Change orders chart
 * 9. Contracts summary table
 * 10. Claims activity panel
 */

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';
import PageHeader from '@/components/ui/PageHeader';
import ExecutiveKPIStrip from '@/components/dashboard/ExecutiveKPIStrip';
import AttentionPanel from '@/components/dashboard/AttentionPanel';
import {
  ClaimsByStatusChart,
  ContractSpendChart,
  DelayedByStageChart,
  CeilingProgressChart,
  ChangeOrdersChart,
} from '@/components/dashboard/DashboardCharts';
import ContractsSummaryPanel from '@/components/dashboard/ContractsSummaryPanel';
import ClaimsActivityPanel from '@/components/dashboard/ClaimsActivityPanel';
import ExecutiveRiskPanel from '@/components/dashboard/ExecutiveRiskPanel';
import ExecutivePerformancePanel from '@/components/dashboard/ExecutivePerformancePanel';
import ActionCenterBanner from '@/components/dashboard/ActionCenterBanner';
import IntelligenceKPIStrip from '@/components/dashboard/IntelligenceKPIStrip';
import StageDistributionPanel from '@/components/dashboard/StageDistributionPanel';
import MostDelayedTable from '@/components/dashboard/MostDelayedTable';
import NeedsAttentionTable from '@/components/dashboard/NeedsAttentionTable';
import { loadDashboardData } from '@/services/dashboard';
import type { DashboardData } from '@/services/dashboard';
import { loadIntelligenceData } from '@/services/dashboard-intelligence';
import type { IntelligenceData } from '@/services/dashboard-intelligence';
import { isExternal } from '@/lib/permissions';
import { getAuthHeaders } from '@/lib/supabase';

// ─── Loading skeleton ────────────────────────────────────────────

function SkeletonBlock({ h = 'h-32', className = '' }: { h?: string; className?: string }) {
  return (
    <div className={`${h} ${className} bg-gray-100 rounded-xl animate-pulse`} />
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3">
      {/* KPI row */}
      <div className="grid grid-cols-4 gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <SkeletonBlock key={i} h="h-24" />
        ))}
      </div>
      {/* Attention + chart row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2.5">
        <SkeletonBlock h="h-48" />
        <SkeletonBlock h="h-48" />
        <SkeletonBlock h="h-48" />
      </div>
      {/* Second chart row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
        <SkeletonBlock h="h-56" />
        <SkeletonBlock h="h-56" />
      </div>
      {/* Tables */}
      <SkeletonBlock h="h-64" />
      <SkeletonBlock h="h-64" />
    </div>
  );
}

// ─── Refresh button ───────────────────────────────────────────────

function RefreshBar({
  loadedAt,
  onRefresh,
  loading,
}: {
  loadedAt: string;
  onRefresh: () => void;
  loading: boolean;
}) {
  const time = new Date(loadedAt).toLocaleTimeString('ar-SA', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="flex items-center justify-between mb-2">
      <p className="text-[0.65rem] text-gray-400">
        آخر تحديث: {time}
      </p>
      <button
        onClick={onRefresh}
        disabled={loading}
        className="text-[0.65rem] text-[#00A79D] font-bold hover:text-[#045859] disabled:opacity-40 flex items-center gap-1"
      >
        {loading ? '...' : '↻ تحديث'}
      </button>
    </div>
  );
}

// ─── Main Dashboard Page ─────────────────────────────────────────

interface ActionCenterCounts { totalCritical: number; totalHigh: number; }

export default function DashboardPage() {
  const { profile } = useAuth();
  const [data, setData]       = useState<DashboardData | null>(null);
  const [intel, setIntel]     = useState<IntelligenceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [actionCounts, setActionCounts] = useState<ActionCenterCounts | null>(null);
  const [acLoading, setAcLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Load both data sources in parallel
      const [dashResult, intelResult] = await Promise.allSettled([
        loadDashboardData(),
        loadIntelligenceData(),
      ]);
      if (dashResult.status === 'fulfilled') setData(dashResult.value);
      else throw dashResult.reason;
      if (intelResult.status === 'fulfilled') setIntel(intelResult.value);
      else console.warn('Intelligence data load failed (non-blocking):', intelResult.reason);
    } catch (e) {
      console.error('Dashboard load error:', e);
      setError('تعذّر تحميل بيانات اللوحة — تحقق من الاتصال وأعد المحاولة.');
    } finally {
      setLoading(false);
    }

    // Load action center counts (non-blocking)
    setAcLoading(true);
    try {
      const headers = await getAuthHeaders();
      if (headers.Authorization) {
        const res = await fetch('/api/executive/action-center', { headers });
        if (res.ok) {
          const json = await res.json();
          setActionCounts({
            totalCritical: json.data?.totalCritical ?? 0,
            totalHigh:     json.data?.totalHigh ?? 0,
          });
        }
      }
    } catch { /* non-critical */ } finally {
      setAcLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // External users (contractors, supervisors) have limited dashboard
  const isExternalUser = profile ? isExternal(profile.role) : false;

  if (loading && !data) {
    return (
      <>
        <PageHeader
          title="لوحة التحكم التنفيذية"
          subtitle={`مرحباً ${profile?.full_name_ar || profile?.full_name || ''}`}
        />
        <LoadingSkeleton />
      </>
    );
  }

  if (error) {
    return (
      <>
        <PageHeader title="لوحة التحكم التنفيذية" />
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <span className="text-3xl">⚠️</span>
          <p className="text-[0.85rem] text-[#C05728] font-bold">{error}</p>
          <button
            onClick={load}
            className="text-[0.75rem] text-white font-bold bg-[#045859] px-4 py-2 rounded-lg hover:bg-[#034342]"
          >
            إعادة المحاولة
          </button>
        </div>
      </>
    );
  }

  if (!data) return null;

  const {
    kpis,
    claimsByStatus,
    contractSpends,
    delayedByStage,
    attentionItems,
    recentActivity,
    changeOrders,
    loadedAt,
  } = data;

  // External users only see their own data — filtered at service level
  // Director/reviewers/auditors see full data

  const criticalCount = attentionItems.filter(i => i.severity === 'critical').length;

  return (
    <>
      <PageHeader
        title="لوحة التحكم التنفيذية"
        subtitle={`مرحباً ${profile?.full_name_ar || profile?.full_name || ''}  —  ${
          profile?.role === 'director' ? 'مدير الإدارة'
          : profile?.role === 'reviewer' ? 'مراجع'
          : profile?.role === 'auditor' ? 'مدقق'
          : profile?.role === 'supervisor' ? 'جهة الإشراف'
          : 'مقاول'
        }`}
        action={
          criticalCount > 0 ? (
            <span className="text-[0.68rem] font-bold px-2.5 py-1 rounded-full bg-[#DC2626] text-white animate-pulse">
              {criticalCount} تنبيه حرج
            </span>
          ) : undefined
        }
      />

      {/* Refresh bar */}
      <RefreshBar loadedAt={loadedAt} onRefresh={load} loading={loading} />

      {/* ── VAT BASIS NOTICE ───────────────────────────────────────── */}
      <div className="flex items-center justify-center gap-1.5 mb-2 px-3 py-1.5 rounded-lg bg-[#E8F4F4] border border-[#045859]/15">
        <span className="text-[#045859] text-[0.7rem]">ℹ</span>
        <p className="text-[0.68rem] font-bold text-[#045859]">
          جميع القيم المالية في هذه اللوحة{' '}
          <span className="underline decoration-dotted">لا تشمل ضريبة القيمة المضافة (١٥٪)</span>
          {' '}— المبالغ المعروضة هي الإجمالي قبل الضريبة (boq + staff)
        </p>
      </div>

      {/* ══ 0. ACTION CENTER BANNER (Critical/High items) ════════ */}
      {!isExternalUser && (
        <ActionCenterBanner
          criticalCount={actionCounts?.totalCritical ?? 0}
          highCount={actionCounts?.totalHigh ?? 0}
          loading={acLoading}
        />
      )}

      {/* ══ 1. FINANCIAL KPI STRIP ═══════════════════════════════ */}
      <ExecutiveKPIStrip kpis={kpis} />

      {/* ══ 1b. INTELLIGENCE KPI STRIP (Sprint E) ═════════════ */}
      {!isExternalUser && intel && (
        <IntelligenceKPIStrip kpis={intel.kpis} />
      )}

      {/* ══ 2. EXECUTIVE INTELLIGENCE ROW (Risk / Attention / Performance) ══ */}
      {!isExternalUser && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-2.5 mb-2.5">
          <ExecutiveRiskPanel
            contractSpends={contractSpends}
            attentionItems={attentionItems}
          />
          <AttentionPanel items={attentionItems} />
          <ExecutivePerformancePanel
            contractSpends={contractSpends}
            recentActivity={recentActivity}
          />
        </div>
      )}

      {/* ══ 2b. OPERATIONAL INTELLIGENCE ROW (Sprint E) ════════ */}
      {!isExternalUser && intel && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-2.5 mb-2.5">
          <StageDistributionPanel stages={intel.stageDistribution} />
          <NeedsAttentionTable claims={intel.needingAttention} />
          <MostDelayedTable claims={intel.mostDelayed} />
        </div>
      )}

      {/* ══ 3. CHARTS ROW ══════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2.5 mb-2.5">
        {/* Claims by status donut */}
        <div className="lg:col-span-1">
          <ClaimsByStatusChart data={claimsByStatus} />
        </div>

        {/* Delayed by stage */}
        <div className="lg:col-span-2">
          <DelayedByStageChart data={delayedByStage} />
        </div>
      </div>

      {/* ══ 3. FINANCIAL CHARTS ROW ══════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5 mb-2.5">
        <ContractSpendChart data={contractSpends} />
        <CeilingProgressChart data={contractSpends} />
      </div>

      {/* ══ 4. CHANGE ORDERS CHART ═══════════════════════════════ */}
      {changeOrders.length > 0 && (
        <div className="mb-2.5">
          <ChangeOrdersChart data={changeOrders} />
        </div>
      )}

      {/* ══ 5. CONTRACTS SUMMARY ═════════════════════════════════ */}
      <div className="mb-2.5">
        <ContractsSummaryPanel
          contracts={contractSpends}
          changeOrders={changeOrders}
        />
      </div>

      {/* ══ 6. CLAIMS ACTIVITY ═══════════════════════════════════ */}
      <div className="mb-4">
        <ClaimsActivityPanel activities={recentActivity} />
      </div>

      {/* ══ Footer info ══════════════════════════════════════════ */}
      <div className="text-center py-2 text-[0.6rem] text-gray-300">
        CONVERA — منصة حوكمة العقود | إدارة التطوير والتأهيل | وزارة البلديات والإسكان
      </div>
    </>
  );
}
