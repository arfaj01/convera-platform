/**
 * CONVERA — Bottleneck Detection Engine (محرك كشف الاختناقات)
 *
 * Identifies workflow stages causing delays:
 *   - Highest average duration
 *   - Highest SLA breach percentage
 *   - Returns severity + Arabic recommendation
 *
 * Uses output from performance-engine.ts (read-only).
 *
 * Does NOT:
 *   - Modify any data
 *   - Change RLS, auth, or workflow states
 */

import type { StagePerformance } from './performance-engine';
import type { ClaimStatus } from './types';

// ─── Types ──────────────────────────────────────────────────────

export type BottleneckSeverity = 'none' | 'mild' | 'moderate' | 'severe';

export interface Bottleneck {
  /** Stage causing the bottleneck */
  stage: ClaimStatus;
  stageLabel: string;
  /** Severity level */
  severity: BottleneckSeverity;
  /** Primary reason for bottleneck classification */
  reason: string;
  /** Arabic reason */
  reason_ar: string;
  /** Recommendation for improvement */
  recommendation: string;
  /** Arabic recommendation */
  recommendation_ar: string;
  /** Metrics backing the bottleneck */
  metrics: {
    avgDuration: number;
    slaBreachPct: number;
    volume: number;
    maxDuration: number;
  };
}

export interface BottleneckAnalysis {
  /** Primary bottleneck (worst stage) */
  primary: Bottleneck | null;
  /** Secondary bottleneck if present */
  secondary: Bottleneck | null;
  /** All stages ranked by severity */
  allStages: Bottleneck[];
  /** Overall system health */
  systemHealth: 'healthy' | 'attention' | 'critical';
  systemHealth_ar: string;
}

// ─── Severity Thresholds ────────────────────────────────────────

const THRESHOLDS = {
  /** SLA breach % thresholds */
  slaBreachMild: 10,
  slaBreachModerate: 25,
  slaBreachSevere: 50,
  /** Avg duration relative to SLA limit */
  durationMild: 0.6,    // 60% of SLA
  durationModerate: 0.8, // 80% of SLA
  durationSevere: 1.0,   // 100% of SLA
};

// ─── Recommendations ────────────────────────────────────────────

const STAGE_RECOMMENDATIONS: Record<string, { ar: string; en: string }> = {
  under_supervisor_review: {
    ar: 'تحقق من توزيع المهام على جهات الإشراف — قد تحتاج لتعيين مشرفين إضافيين أو مراجعة عبء العمل',
    en: 'Review supervisor workload distribution — may need additional supervisors or workload rebalancing',
  },
  under_auditor_review: {
    ar: 'راجع حجم المطالبات المسندة لكل مدقق — يُنصح بتوزيع أكثر عدالة أو إضافة مدققين',
    en: 'Review auditor claim assignments — consider more equitable distribution or additional auditors',
  },
  under_reviewer_check: {
    ar: 'تحقق من عملية المراجعة — قد تحتاج لتبسيط متطلبات الفحص أو إضافة مراجعين',
    en: 'Review the review process — may need simplified requirements or additional reviewers',
  },
  pending_director_approval: {
    ar: 'المطالبات تتراكم في انتظار اعتماد المدير — يُنصح بتخصيص وقت محدد للاعتمادات',
    en: 'Claims accumulating at director approval — consider dedicated approval time blocks',
  },
};

// ─── Core Engine ────────────────────────────────────────────────

/**
 * Analyze all stages for bottleneck detection.
 *
 * @param stagePerformance - Output from getStagePerformance()
 */
export function getBottlenecks(stagePerformance: StagePerformance[]): BottleneckAnalysis {
  if (stagePerformance.length === 0) {
    return {
      primary: null,
      secondary: null,
      allStages: [],
      systemHealth: 'healthy',
      systemHealth_ar: 'صحي — لا توجد اختناقات',
    };
  }

  const bottlenecks: Bottleneck[] = [];

  for (const sp of stagePerformance) {
    const slaLimit = sp.slaConfig?.limitDays || 5;
    const severity = calculateSeverity(sp.slaBreachPct, sp.avgDuration, slaLimit);

    const reason = buildReason(sp, severity);
    const recommendation = STAGE_RECOMMENDATIONS[sp.stage] || {
      ar: 'مراجعة أداء هذه المرحلة وتحديد أسباب التأخير',
      en: 'Review stage performance and identify delay causes',
    };

    bottlenecks.push({
      stage: sp.stage,
      stageLabel: sp.stageLabel,
      severity,
      reason: reason.en,
      reason_ar: reason.ar,
      recommendation: recommendation.en,
      recommendation_ar: recommendation.ar,
      metrics: {
        avgDuration: sp.avgDuration,
        slaBreachPct: sp.slaBreachPct,
        volume: sp.totalVolume,
        maxDuration: sp.maxDuration,
      },
    });
  }

  // Sort by severity (severe > moderate > mild > none), then by SLA breach %
  const severityOrder: Record<BottleneckSeverity, number> = {
    severe: 3,
    moderate: 2,
    mild: 1,
    none: 0,
  };

  bottlenecks.sort((a, b) => {
    const sevDiff = severityOrder[b.severity] - severityOrder[a.severity];
    if (sevDiff !== 0) return sevDiff;
    return b.metrics.slaBreachPct - a.metrics.slaBreachPct;
  });

  const primary = bottlenecks[0]?.severity !== 'none' ? bottlenecks[0] : null;
  const secondary = bottlenecks[1]?.severity !== 'none' ? bottlenecks[1] : null;

  // System health
  const hasSevere = bottlenecks.some(b => b.severity === 'severe');
  const hasModerate = bottlenecks.some(b => b.severity === 'moderate');

  let systemHealth: 'healthy' | 'attention' | 'critical' = 'healthy';
  let systemHealth_ar = 'صحي — النظام يعمل ضمن المعايير';

  if (hasSevere) {
    systemHealth = 'critical';
    systemHealth_ar = 'حرج — يوجد اختناق شديد يتطلب تدخلاً فورياً';
  } else if (hasModerate) {
    systemHealth = 'attention';
    systemHealth_ar = 'يتطلب انتباه — يوجد تأخر ملحوظ في بعض المراحل';
  }

  return {
    primary,
    secondary,
    allStages: bottlenecks,
    systemHealth,
    systemHealth_ar,
  };
}

// ─── Helpers ────────────────────────────────────────────────────

function calculateSeverity(
  slaBreachPct: number,
  avgDuration: number,
  slaLimit: number,
): BottleneckSeverity {
  const durationRatio = slaLimit > 0 ? avgDuration / slaLimit : 0;

  // Severe: high breach rate OR avg duration exceeds SLA
  if (
    slaBreachPct >= THRESHOLDS.slaBreachSevere ||
    durationRatio >= THRESHOLDS.durationSevere
  ) {
    return 'severe';
  }

  // Moderate
  if (
    slaBreachPct >= THRESHOLDS.slaBreachModerate ||
    durationRatio >= THRESHOLDS.durationModerate
  ) {
    return 'moderate';
  }

  // Mild
  if (
    slaBreachPct >= THRESHOLDS.slaBreachMild ||
    durationRatio >= THRESHOLDS.durationMild
  ) {
    return 'mild';
  }

  return 'none';
}

function buildReason(
  sp: StagePerformance,
  severity: BottleneckSeverity,
): { ar: string; en: string } {
  if (severity === 'none') {
    return {
      ar: `أداء مرحلة "${sp.stageLabel}" ضمن المعايير المقبولة`,
      en: `Stage "${sp.stageLabel}" is performing within acceptable limits`,
    };
  }

  const parts_ar: string[] = [];
  const parts_en: string[] = [];

  if (sp.slaBreachPct > 0) {
    parts_ar.push(`نسبة تجاوز المهلة ${sp.slaBreachPct}%`);
    parts_en.push(`SLA breach rate at ${sp.slaBreachPct}%`);
  }

  if (sp.slaConfig && sp.avgDuration > sp.slaConfig.limitDays * 0.5) {
    parts_ar.push(`متوسط المدة ${sp.avgDuration} يوم عمل من أصل ${sp.slaConfig.limitDays}`);
    parts_en.push(`Avg duration ${sp.avgDuration} days vs ${sp.slaConfig.limitDays} day SLA`);
  }

  if (sp.maxDuration > 0) {
    parts_ar.push(`أطول تأخير: ${sp.maxDuration} يوم عمل`);
    parts_en.push(`Max delay: ${sp.maxDuration} working days`);
  }

  return {
    ar: parts_ar.join(' — ') || `مرحلة "${sp.stageLabel}" تحتاج مراجعة`,
    en: parts_en.join(' — ') || `Stage "${sp.stageLabel}" needs review`,
  };
}
