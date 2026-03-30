/**
 * CONVERA Recommendation Engine
 *
 * Takes risk scores and operational context as input and returns
 * prioritised, actionable Arabic-language recommendations.
 *
 * Each recommendation includes:
 *   - A one-line title (what is wrong)
 *   - An action suggestion (what to do)
 *   - Priority: CRITICAL / HIGH / MEDIUM / LOW
 *   - Quick action route (for the Action Center button)
 *   - Entity reference (claimId or contractId)
 */

import type { ContractRiskScore, ClaimRiskScore, RiskLevel } from './risk-engine';

/* ─── Types ────────────────────────────────────────────────────────

export type RecommendationPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type RecommendationCategory =
  | 'financial'
  | 'sla'
  | 'workflow'
  | 'compliance'
  | 'performance';

export interface Recommendation {
  id:           string;               // deterministic: entity_type + entity_id + rule_id
  entityType:   'contract' | 'claim';
  entityId:     string;
  entityRef:    string;               // human-readable reference (e.g. "عقد 231001101771")
  category:     RecommendationCategory;
  priority:     RecommendationPriority;
  title:        string;               // Arabic: what is wrong
  action:       string;               // Arabic: what to do
  quickRoute:   string;               // URL for "quick action" button
  riskScore:    number;
  createdAt:    string;               // ISO timestamp
  dismissed?:   boolean;
}

// ─── Context inputs ───────────────────────────────────────────────

export interface ContractRecommendationContext {
  contractId:   string;
  contractNo:   string;
  title:        string;
  score:        ContractRiskScore;
  utilizationPct: number;
  coUtilizationPct: number;
  returnRate:   number;
  daysOverdue?: number;
}

export interface ClaimRecommendationContext {
  claimId:    string;
  claimNo:    number;
  contractNo: string;
  score:      ClaimRiskScore;
  currentStage: string;
  daysInStage:  number;
  slaLimitDays: number;
  returnCount:  number;
}

// ─── Stage display labels ─────────────────────────────────────────

const STAGE_LABELS: Record<string, string> = {
  under_supervisor_review:   'جهة الإشراف',
  under_auditor_review:      'المدقق',
  under_reviewer_check:      'المراجع',
  pending_director_approval: 'المدير',
  submitted:                 'الانتظار',
};

// ─── Contract Recommendations ─────────────────────────────────────

export function generateContractRecommendations(
  ctx: ContractRecommendationContext,
): Recommendation[] {
  const recs: Recommendation[] = [];
  const now = new Date().toISOString();

  const make = (
    ruleId: string,
    priority: RecommendationPriority,
    category: RecommendationCategory,
    title: string,
    action: string,
  ): Recommendation => ({
    id:         `contract-${ctx.contractId}-${ruleId}`,
    entityType: 'contract',
    entityId:   ctx.contractId,
    entityRef:  `عقد ${ctx.contractNo}`,
    category,
    priority,
    title,
    action,
    quickRoute: `/contracts/${ctx.contractId}`,
    riskScore:  ctx.score.score,
    createdAt:  now,
  });

  // Rule C1: Contract ceiling exceeded
  if (ctx.utilizationPct >= 100) {
    recs.push(make(
      'ceiling_exceeded', 'CRITICAL', 'financial',
      `تجاوز سقف العقد — الاستخدام ${ctx.utilizationPct.toFixed(0)}٪`,
      'أوقف قبول المطالبات المالي مع الفريق القانوني',
    ));
  }
  // Rule C2: Approaching ceiling (≥90%)
  else if (ctx.utilizationPct >= 90) {
    recs.push(make(
      'ceiling_critical', 'CRITICAL', 'financial',
      `اقتراب حرج من سقف العقد (${ctx.utilizationPct.toFixed(0)}٪)`,
      'راجع المطالبات المعلقة وقيّم الحاجة لتعديل قيمة العقد',
    ));
  }
  // Rule C3: Warning zone (≥80%)
  else if (ctx.utilizationPct >= 80) {
    recs.push(make(
      'ceiling_warning', 'HIGH', 'financial',
      `العقد في منطقة التحذير — الاستخدام ${ctx.utilizationPct.toFixed(0)}٪`,
      'تابع المطالبات القادمة وخطط للتعديل التعاقدي إن لزم',
    ));
  }

  // Rule C4: Change orders approaching limit
  if (ctx.coUtilizationPct >= 9) {
    recs.push(make(
      'co_limit', 'HIGH', 'compliance',
      `أوامر التغيير تقترب من الحد الأقصى (${ctx.coUtilizationPct.toFixed(1)}٪)`,
      'لا تعتمد أوامر تغيير جديدة حتى تراجع الموقف التراكمي',
    ));
  }

  // Rule C5: High return rate
  if (ctx.returnRate >= 0.5) {
    recs.push(make(
      'high_returns', 'HIGH', 'performance',
      `معدل استرداد مرتفع — ${Math.round(ctx.returnRate * 100)}٪ من المطالبات مُرجَّعة`,
      'حقق في أسباب الاسترداد المتكررة وقدم جلسة توجيهية للمقاول',
    ));
  }

  // Rule C6: CRITICAL overall risk
  if (ctx.score.level === 'CRITICAL') {
    recs.push(make(
      'critical_overall', 'CRITICAL', 'compliance',
      'هذا العقد يستدعي تدخلاً فورياً من الإدارة',
      'جدول اجتماعاً طارئاً لمراجعة الوضع الشامل للعقد',
    ));
  }

  return recs;
}

// ─── Claim Recommendations ────────────────────────────────────────

export function generateClaimRecommendations(
  ctx: ClaimRecommendationContext,
): Recommendation[] {
  const recs: Recommendation[] = [];
  const now = new Date().toISOString();

  const make = (
    ruleId: string,
    priority: RecommendationPriority,
    category: RecommendationCategory,
    title: string,
    action: string,
  ): Recommendation => ({
    id:         `claim-${ctx.claimId}-${ruleId}`,
    entityType: 'claim',
    entityId:   ctx.claimId,
    entityRef:  `مطالبة #${ctx.claimNo} (${ctx.contractNo})`,
    category,
    priority,
    title,
    action,
    quickRoute: `/claims/${ctx.claimId}`,
    riskScore:  ctx.score.score,
    createdAt:  now,
  });

  // Rule R1: SLA breach (>100% of limit)
  const slaPct = ctx.slaLimitDays > 0
    ? (ctx.daysInStage / ctx.slaLimitDays) * 100
    : 0;

  if (slaPct >= 150) {
    recs.push(make(
      'sla_critical', 'CRITICAL', 'sla',
      `مطالبة #${ctx.claimNo} — تجاوز المهلة بنسبة ${(slaPct - 100).toFixed(0)}٪`,
      'صعّد فوراً إلى المدير — هذه المطالبة متوقفة لأكثر من مرة ونصف المهلة',
    ));
  } else if (slaPct >= 100) {
    recs.push(make(
      'sla_breach', 'HIGH', 'sla',
      `مطالبة #${ctx.claimNo} — تجاوزت المهلة في مرحلة ${STAGE_LABELS[ctx.currentStage] ?? ctx.currentStage}`,
      'أرسل تنبيهاً للمسؤول في هذه المرحلة وسجّل خرق SLA',
    ));
  } else if (slaPct >= 80) {
    recs.push(make(
      'sla_warning', 'MEDIUM', 'sla',
      `مطالبة #${ctx.claimNo} — تقترب من نهاية المهلة (${ctx.daysInStage}/${ctx.slaLimitDays} يوم)`,
      'نبّه المسؤول الحالي بضرورة اتخاذ إجراء قبل انتهاء المهلة',
    ));
  }

  // Rule R2: Repeated returns
  if (ctx.returnCount >= 3) {
    recs.push(make(
      'repeated_returns', 'HIGH', 'workflow',
      `مطالبة #${ctx.claimNo} — مُرجَّعة ${ctx.returnCount} مرات`,
      'تدخّل مباشرة واعقد اجتماعاً مع المقاول لحل المشكلة الجذرية',
    ));
  } else if (ctx.returnCount === 2) {
    recs.push(make(
      'double_return', 'MEDIUM', 'workflow',
      `مطالبة #${ctx.claimNo} — مُرجَّعة مرتين`,
      'تأكد أن سبب الإرجاع السابق قد عولج قبل قبول إعادة التقديم',
    ));
  }

  // Rule R3: High value anomaly
  if (ctx.score.factors.valueDeviationRisk >= 22) {
    recs.push(make(
      'high_value', 'HIGH', 'financial',
      `مطالبة #${ctx.claimNo} — قيمة غير اعتيادية`,
      'راجع تفاصيل البنود بدقة قبل الاعتماد — القيمة مرتفعة بشكل لافت',
    ));
  }

  // Rule R4: Low risk but delayed — approve quickly
  if (ctx.score.level === 'LOW' && slaPct >= 60) {
    recs.push(make(
      "low_risk_delayed", 'MEDIUM', 'workflow',
      `مطالبة #${ctx.claimNo} — منخفضة المخاطر لكنها متأخرة`,
      'اعتمدها بسرعة — خطر منخفض ومتأخرة عن الجدول دون مبرر',
    ));
  }

  return recs;
}

// ─── Priority Sorting ─────────────────────────────────────────────

const PRIORITY_ORDER: Record<RecommendationPriority, number> = {
  CRITICAL: 0,
  HIGH:     1,
  MEDIUM:   2,
  LOW:      3,
};

export function sortRecommendations(recs: Recommendation[]): Recommendation[] {
  return [...recs].sort((a, b) => {
    const pd = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[".priority];
    if (pd !== 0) return pd;
    return b.riskScore - a.riskScore;
  });
}

// ─── Display Helpers ──────────────────────────────────────────────

export const PRIORITY_COLORS: Record<RecommendationPriority, string> = {
  CRITICAL: '#DC2626',
  HIGH:     '#C05728',
  MEDIUM:   '#FFC845',
  LOW:      '#87BA26',
};

export const PRIORITY_BG: Record<RecommendationPriority, string> = {
  CRITICAL: '#FEE2E2',
  HIGH:     '#FAEEE8',
  MEDIUM:   '#FFF8E0',
  LOW:      '#F0F7E0',
};

export const PRIORITY_LABELS: Record<RecommendationPriority, string> = {
  CRITICAL: 'حرج',
  HIGH:     'مرتفع',
  MEDIUM:   'متوسط',
  LOW:      'منخفض',
};

export const CATEGORY_ICONS: Record<RecommendationCategory, string> = {
  financial:   '💰',
  sla:         '⏱',
  workflow:    '🔄',
  compliance:  '⚖️',
  performance: '📊',
};
