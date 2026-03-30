'use client';

/**
 * Executive KPI Strip — 8 ministry-branded KPI cards
 * Arabic RTL, MoMaH color palette, real data from DashboardKPIs
 */

import type { DashboardKPIs } from '@/services/dashboard';

interface Props {
  kpis: DashboardKPIs;
}

// ── Card color themes ─────────────────────────────────────────────
type Theme = {
  bg:     string;
  border: string;
  icon:   string;
  val:    string;
  label:  string;
  sub:    string;
};

const THEMES = {
  teal:   { bg: 'bg-[#045859]',   border: 'border-[#034342]', icon: 'text-[#87BA26]', val: 'text-white',   label: 'text-white/80', sub: 'text-white/60' },
  green:  { bg: 'bg-[#F0F7E0]',   border: 'border-[#87BA26]/30', icon: 'text-[#87BA26]', val: 'text-[#4A6B10]', label: 'text-[#4A6B10]/80', sub: 'text-[#4A6B10]/60' },
  amber:  { bg: 'bg-[#FFF8E0]',   border: 'border-[#FFC845]/30', icon: 'text-[#C08000]', val: 'text-[#7A4F00]', label: 'text-[#7A4F00]/80', sub: 'text-[#7A4F00]/60' },
  orange: { bg: 'bg-[#FAEEE8]',   border: 'border-[#C05728]/30', icon: 'text-[#C05728]', val: 'text-[#7A3418]', label: 'text-[#7A3418]/80', sub: 'text-[#7A3418]/60' },
  red:    { bg: 'bg-[#FDECEA]',   border: 'border-[#DC2626]/30', icon: 'text-[#DC2626]', val: 'text-[#991B1B]', label: 'text-[#991B1B]/80', sub: 'text-[#991B1B]/60' },
  purple: { bg: 'bg-[#F3F0F9]',   border: 'border-[#502C7C]/20', icon: 'text-[#502C7C]', val: 'text-[#3A1F5C]', label: 'text-[#3A1F5C]/80', sub: 'text-[#3A1F5C]/60' },
  info:   { bg: 'bg-[#E0F4F3]',   border: 'border-[#00A79D]/20', icon: 'text-[#00A79D]', val: 'text-[#005F5A]', label: 'text-[#005F5A]/80', sub: 'text-[#005F5A]/60' },
} satisfies Record<string, Theme>;

// ── Helpers ───────────────────────────────────────────────────────

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'م';
  if (n >= 1_000)     return Math.round(n).toLocaleString('ar-SA');
  return String(Math.round(n));
}

function fmtSAR(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + ' مليار ر.س';
  if (n >= 1_000_000)     return (n / 1_000_000).toFixed(1)     + ' مليون ر.س';
  return Math.round(n).toLocaleString('ar-SA') + ' ر.س';
}

// ── KPI Card ──────────────────────────────────────────────────────

interface CardDef {
  icon:     string;
  label:    string;
  value:    string;
  sub?:     string;
  theme:    keyof typeof THEMES;
  badge?:   string;
  badgeRed?: boolean;
}

function KPICard({ icon, label, value, sub, theme, badge, badgeRed }: CardDef) {
  const t = THEMES[theme];
  return (
    <div className={`relative ${t.bg} border ${t.border} rounded-xl p-3 flex flex-col gap-1 shadow-sm`}>
      {badge && (
        <span className={`absolute top-2 start-2 text-[0.6rem] font-bold px-1.5 py-0.5 rounded-full ${
          badgeRed
            ? 'bg-[#DC2626] text-white'
            : 'bg-[#FFC845] text-[#7A4F00]'
        }`}>
          {badge}
        </span>
      )}
      <div className={`text-xl ${t.icon}`}>{icon}</div>
      <div className={`text-[1.45rem] font-black leading-tight tabular-nums ${t.val}`}>{value}</div>
      <div className={`text-[0.7rem] font-bold ${t.label}`}>{label}</div>
      {sub && <div className={`text-[0.62rem] ${t.sub}`}>{sub}</div>}
    </div>
  );
}

// ── Main Strip ────────────────────────────────────────────────────

export default function ExecutiveKPIStrip({ kpis }: Props) {
  const slaTotal = kpis.slaBreachedCount + kpis.slaWarningCount;

  const cards: CardDef[] = [
    {
      icon:  '📋',
      label: 'العقود النشطة',
      value: String(kpis.activeContractCount),
      sub:   `إجمالي القيمة: ${fmtSAR(kpis.totalContractValue)}`,
      theme: 'teal',
    },
    {
      icon:  '💰',
      label: 'إجمالي قيمة العقود',
      value: fmtSAR(kpis.totalContractValue),
      sub:   `${kpis.activeContractCount} عقد نشط`,
      theme: 'info',
    },
    {
      icon:  '✅',
      label: 'إجمالي الصرف المعتمد',
      value: fmtSAR(kpis.totalApprovedSpend),
      sub:   kpis.totalContractValue > 0
        ? `${((kpis.totalApprovedSpend / kpis.totalContractValue) * 100).toFixed(1)}% من قيم العقود · قبل ض.ق.م`
        : 'قبل ضريبة القيمة المضافة',
      theme: kpis.totalContractValue > 0 && kpis.totalApprovedSpend / kpis.totalContractValue > 0.85
        ? 'red'
        : kpis.totalApprovedSpend / kpis.totalContractValue > 0.65
        ? 'amber'
        : 'green',
    },
    {
      icon:  '⏳',
      label: 'المطالبات قيد الإجراء',
      value: String(kpis.pendingClaimsCount),
      sub:   'مطالبة في مراحل التدقيق والمراجعة',
      theme: kpis.pendingClaimsCount > 10 ? 'orange' : kpis.pendingClaimsCount > 5 ? 'amber' : 'green',
    },
    {
      icon:   slaTotal > 0 ? '🚨' : '⏱️',
      label:  'المطالبات المتأخرة عن SLA',
      value:  String(slaTotal),
      sub:    slaTotal > 0
        ? `${kpis.slaBreachedCount} تجاوزت المدة، ${kpis.slaWarningCount} تحذير`
        : 'لا تأخير في جهات الإشراف',
      theme:  kpis.slaBreachedCount > 0 ? 'red' : slaTotal > 0 ? 'amber' : 'green',
      badge:  kpis.slaBreachedCount > 0 ? `${kpis.slaBreachedCount} تجاوز` : undefined,
      badgeRed: true,
    },
    {
      icon:   kpis.nearCeilingCount > 0 ? '⚠️' : '📊',
      label:  'عقود قريبة من السقف المالي',
      value:  String(kpis.nearCeilingCount),
      sub:    kpis.nearCeilingCount > 0
        ? 'تجاوزت 80% من الحد المسموح به'
        : 'جميع العقود ضمن الحدود الآمنة',
      theme:  kpis.nearCeilingCount > 1 ? 'red' : kpis.nearCeilingCount === 1 ? 'orange' : 'green',
    },
    {
      icon:  '📝',
      label: 'أوامر التغيير المعتمدة',
      value: String(kpis.approvedAmendmentsCount),
      sub:   kpis.approvedAmendmentsValue > 0
        ? `قيمة: ${fmtSAR(kpis.approvedAmendmentsValue)}`
        : 'لا توجد تعديلات معتمدة',
      theme: 'purple',
    },
    {
      icon:   '🔖',
      label:  'بانتظار اعتماد المدير',
      value:  fmtSAR(kpis.pendingDirectorValue),
      sub:    kpis.pendingDirectorValue > 0 ? 'يتطلب إجراءً من المدير · قبل ض.ق.م' : 'لا توجد مطالبات معلّقة',
      theme:  kpis.pendingDirectorValue > 0 ? 'amber' : 'green',
      badge:  kpis.pendingDirectorValue > 0 ? 'إجراء مطلوب' : undefined,
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2 mb-3">
      {cards.map((card, i) => (
        <KPICard key={i} {...card} />
      ))}
    </div>
  );
}
