'use client';

/**
 * CONVERA Executive Dashboard — Chart Module
 *
 * Charts are rendered using computed SVG paths and CSS bars.
 * All dimensions and positions are calculated from real data —
 * not hardcoded decorations.
 *
 * recharts is not installed and npm registry is restricted.
 * This module implements the 5 required charts using native SVG
 * (proper computed geometry from data) and CSS-based bar charts.
 *
 * Chart 1: المطالبات المالية حسب الحالة → SVG donut (computed arcs)
 * Chart 2: قيمة الصرف حسب العقد        → CSS horizontal comparison bars
 * Chart 3: المطالبات المتأخرة حسب المرحلة → CSS horizontal bars
 * Chart 4: العقود القريبة من السقف       → CSS progress bars
 * Chart 5: أوامر التغيير حسب العقد       → CSS dot + value bars
 */

import type {
  ClaimsByStatus,
  ContractSpend,
  DelayedByStage,
  ChangeOrderSummary,
} from '@/services/dashboard';

// ── Shared helpers ─────────────────────────────────────────────────

function fmtSAR(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'م م';
  if (n >= 1_000_000)     return (n / 1_000_000).toFixed(1) + 'م';
  if (n >= 1_000)         return (n / 1_000).toFixed(0) + 'ك';
  return String(Math.round(n));
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="w-1 h-5 rounded bg-[#045859]" />
      <h3 className="text-[0.85rem] font-black text-[#045859]">{children}</h3>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center h-32 text-[0.8rem] text-gray-400">
      {text}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// CHART 1 — Claims by Status (SVG Donut + Legend)
// ══════════════════════════════════════════════════════════════════

interface DonutSlice {
  label:  string;
  count:  number;
  color:  string;
  startAngle: number;
  endAngle:   number;
}

function polarToXY(angle: number, r: number, cx: number, cy: number) {
  const rad = ((angle - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function donutPath(startAngle: number, endAngle: number, outerR: number, innerR: number, cx: number, cy: number): string {
  const clampedEnd = Math.min(endAngle, startAngle + 359.99);
  const large = clampedEnd - startAngle > 180 ? 1 : 0;
  const o1 = polarToXY(startAngle,  outerR, cx, cy);
  const o2 = polarToXY(clampedEnd,  outerR, cx, cy);
  const i1 = polarToXY(clampedEnd,  innerR, cx, cy);
  const i2 = polarToXY(startAngle,  innerR, cx, cy);
  return [
    `M ${o1.x} ${o1.y}`,
    `A ${outerR} ${outerR} 0 ${large} 1 ${o2.x} ${o2.y}`,
    `L ${i1.x} ${i1.y}`,
    `A ${innerR} ${innerR} 0 ${large} 0 ${i2.x} ${i2.y}`,
    'Z',
  ].join(' ');
}

export function ClaimsByStatusChart({ data }: { data: ClaimsByStatus[] }) {
  const total = data.reduce((s, d) => s + d.count, 0);
  if (total === 0) return (
    <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
      <SectionTitle>المطالبات المالية حسب الحالة</SectionTitle>
      <EmptyState text="لا توجد مطالبات بعد" />
    </div>
  );

  const cx = 80; const cy = 80; const outerR = 68; const innerR = 44;

  let slices: DonutSlice[] = [];
  let angle = 0;
  for (const d of data) {
    const span = (d.count / total) * 360;
    slices.push({ ...d, startAngle: angle, endAngle: angle + span });
    angle += span;
  }

  // Approvals to surface in center
  const approvedCount = data.find(d => d.status === 'approved')?.count || 0;
  const approvedPct   = total > 0 ? Math.round((approvedCount / total) * 100) : 0;

  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
      <SectionTitle>المطالبات المالية حسب الحالة</SectionTitle>
      <div className="flex gap-4 items-start">
        {/* Donut */}
        <div className="flex-shrink-0">
          <svg width="160" height="160" viewBox="0 0 160 160" className="overflow-visible">
            {/* Background ring */}
            <circle cx={cx} cy={cy} r={outerR} fill="none" stroke="#F3F4F6" strokeWidth={outerR - innerR} />
            {/* Slices */}
            {slices.map((s, i) => (
              <path
                key={i}
                d={donutPath(s.startAngle, s.endAngle, outerR, innerR, cx, cy)}
                fill={s.color}
                opacity={0.92}
              />
            ))}
            {/* Center text */}
            <text x={cx} y={cy - 8}  textAnchor="middle" fontSize="22" fontWeight="900" fill="#045859">{total}</text>
            <text x={cx} y={cy + 8}  textAnchor="middle" fontSize="10" fill="#54565B">مطالبة</text>
            <text x={cx} y={cy + 22} textAnchor="middle" fontSize="9"  fill="#87BA26" fontWeight="700">معتمد {approvedPct}%</text>
          </svg>
        </div>
        {/* Legend */}
        <div className="flex-1 grid grid-cols-1 gap-1 mt-1">
          {data.map((d, i) => (
            <div key={i} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: d.color }} />
                <span className="text-[0.68rem] text-gray-600 truncate">{d.label}</span>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {/* Mini bar */}
                <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(d.count / total) * 100}%`,
                      background: d.color,
                    }}
                  />
                </div>
                <span className="text-[0.7rem] font-bold text-gray-700 tabular-nums w-5 text-start">{d.count}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// CHART 2 — Contract Value vs Approved Spending
// ══════════════════════════════════════════════════════════════════

export function ContractSpendChart({ data }: { data: ContractSpend[] }) {
  if (data.length === 0) return (
    <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
      <SectionTitle>قيمة الصرف حسب العقد</SectionTitle>
      <EmptyState text="لا توجد بيانات عقود" />
    </div>
  );

  const maxVal = Math.max(...data.map(d => Math.max(d.ceiling, d.approvedSpend + d.pendingSpend)));

  const RISK_COLORS = {
    normal:   '#045859',
    warning:  '#FFC845',
    critical: '#DC2626',
  };

  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
      <SectionTitle>قيمة الصرف حسب العقد</SectionTitle>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-[0.65rem] text-gray-500">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-2 rounded bg-[#045859]" /> معتمد
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-2 rounded bg-[#00A79D]/60" /> قيد الإجراء
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-2 rounded border border-gray-300 bg-gray-50" /> السقف (×١١٠٪)
        </span>
        <span className="text-[0.58rem] text-gray-300 italic">قبل ض.ق.م</span>
      </div>

      <div className="space-y-3">
        {data.map((d, i) => {
          const approvedW  = maxVal > 0 ? (d.approvedSpend / maxVal) * 100 : 0;
          const pendingW   = maxVal > 0 ? (d.pendingSpend  / maxVal) * 100 : 0;
          const ceilingW   = maxVal > 0 ? (d.ceiling       / maxVal) * 100 : 0;
          const barColor   = RISK_COLORS[d.riskLevel];
          return (
            <div key={i}>
              <div className="flex justify-between items-center mb-1">
                <span className="text-[0.7rem] font-bold text-gray-700 truncate max-w-[55%]">
                  {d.contractNo} — {d.title.substring(0, 28)}
                </span>
                <span className="text-[0.65rem] text-gray-400 tabular-nums flex-shrink-0">
                  {fmtSAR(d.approvedSpend)} / {fmtSAR(d.ceiling)}
                </span>
              </div>
              {/* Stacked bar: approved + pending, ceiling line */}
              <div className="relative h-5 bg-gray-100 rounded-md overflow-hidden">
                {/* Ceiling marker */}
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-gray-400 z-10"
                  style={{ insetInlineStart: `${Math.min(ceilingW, 99)}%` }}
                />
                {/* Approved */}
                <div
                  className="absolute top-0 bottom-0 rounded-s-md"
                  style={{ width: `${Math.min(approvedW, 100)}%`, background: barColor, opacity: 0.9 }}
                />
                {/* Pending */}
                {pendingW > 0 && (
                  <div
                    className="absolute top-0 bottom-0"
                    style={{
                      insetInlineStart: `${Math.min(approvedW, 100)}%`,
                      width: `${Math.min(pendingW, 100 - approvedW)}%`,
                      background: '#00A79D',
                      opacity: 0.45,
                    }}
                  />
                )}
                {/* % label */}
                <span className="absolute inset-y-0 end-1.5 flex items-center text-[0.6rem] font-bold text-gray-600 z-20">
                  {d.pctConsumed.toFixed(0)}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// CHART 3 — Delayed Claims by Stage
// ══════════════════════════════════════════════════════════════════

export function DelayedByStageChart({ data }: { data: DelayedByStage[] }) {
  const hasData = data.some(d => d.count > 0);
  const maxCount = Math.max(...data.map(d => d.count), 1);

  const STAGE_COLORS: Record<string, string> = {
    under_supervisor_review:   '#502C7C',
    under_auditor_review:      '#C05728',
    under_reviewer_check:      '#FFC845',
    pending_director_approval: '#045859',
  };

  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
      <SectionTitle>المطالبات المتأخرة حسب المرحلة</SectionTitle>

      {!hasData ? (
        <div className="flex items-center justify-center h-24 gap-2">
          <span className="text-2xl">✅</span>
          <span className="text-[0.8rem] text-[#87BA26] font-bold">لا تأخير مسجّل</span>
        </div>
      ) : (
        <div className="space-y-3">
          {data.map((d, i) => {
            const widthPct = (d.count / maxCount) * 100;
            const color    = STAGE_COLORS[d.stage] || '#545659';
            return (
              <div key={i} className="flex items-center gap-3">
                <span className="text-[0.7rem] text-gray-600 w-24 flex-shrink-0 text-end">{d.label}</span>
                <div className="flex-1 relative h-7 bg-gray-100 rounded-md overflow-hidden">
                  <div
                    className="absolute top-0 bottom-0 start-0 rounded-md flex items-center"
                    style={{ width: `${widthPct}%`, background: color, opacity: 0.85, minWidth: d.count > 0 ? '2rem' : '0' }}
                  >
                    {d.count > 0 && (
                      <span className="text-white text-[0.68rem] font-black ps-2">{d.count}</span>
                    )}
                  </div>
                  {d.count === 0 && (
                    <span className="absolute inset-0 flex items-center ps-2 text-[0.65rem] text-gray-400">لا تأخير</span>
                  )}
                </div>
                {d.maxDays > 0 && (
                  <span className="text-[0.65rem] text-gray-400 flex-shrink-0">
                    أقصى {d.maxDays}د
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// CHART 4 — Contracts near financial ceiling
// ══════════════════════════════════════════════════════════════════

export function CeilingProgressChart({ data }: { data: ContractSpend[] }) {
  // Sort by pct consumed desc, show top contracts
  const sorted = [...data].sort((a, b) => b.pctConsumed - a.pctConsumed);

  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
      <SectionTitle>العقود القريبة من السقف المالي (قبل ض.ق.م)</SectionTitle>

      {sorted.length === 0 ? (
        <EmptyState text="لا توجد بيانات عقود" />
      ) : (
        <div className="space-y-3">
          {sorted.map((d, i) => {
            const pct   = Math.min(d.pctConsumed, 110);
            const color = d.riskLevel === 'critical' ? '#DC2626'
              : d.riskLevel === 'warning' ? '#FFC845'
              : '#87BA26';
            const trackColor = d.riskLevel === 'critical' ? '#FDECEA'
              : d.riskLevel === 'warning' ? '#FFF8E0'
              : '#F0F7E0';

            return (
              <div key={i}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[0.7rem] font-bold text-gray-700 truncate max-w-[55%]">
                    {d.contractNo} — {d.title.substring(0, 24)}
                  </span>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {d.riskLevel !== 'normal' && (
                      <span className={`text-[0.6rem] font-bold px-1.5 py-0.5 rounded-full ${
                        d.riskLevel === 'critical'
                          ? 'bg-[#FDECEA] text-[#991B1B]'
                          : 'bg-[#FFF8E0] text-[#7A4F00]'
                      }`}>
                        {d.riskLevel === 'critical' ? 'حرج' : 'تحذير'}
                      </span>
                    )}
                    <span className="text-[0.72rem] font-black tabular-nums" style={{ color }}>
                      {d.pctConsumed.toFixed(0)}%
                    </span>
                  </div>
                </div>

                {/* Progress bar with danger zone markers */}
                <div className="relative h-5 rounded-md overflow-hidden" style={{ background: trackColor }}>
                  {/* 80% warning line */}
                  <div className="absolute top-0 bottom-0 w-px bg-[#FFC845]/60 z-10" style={{ insetInlineStart: '80%' }} />
                  {/* 90% danger line */}
                  <div className="absolute top-0 bottom-0 w-px bg-[#DC2626]/60 z-10" style={{ insetInlineStart: '90%' }} />
                  {/* 100% ceiling line */}
                  <div className="absolute top-0 bottom-0 w-px bg-gray-500 z-10" style={{ insetInlineStart: '91%' }} />
                  {/* Fill bar */}
                  <div
                    className="absolute top-0 bottom-0 start-0 rounded-md"
                    style={{ width: `${Math.min(pct / 110 * 100, 100)}%`, background: color, opacity: 0.85 }}
                  />
                  {/* Remaining label */}
                  <span className="absolute inset-y-0 end-1.5 flex items-center text-[0.58rem] text-gray-500 z-20 font-bold">
                    رصيد {fmtSAR(Math.max(d.remaining, 0))}
                  </span>
                </div>

                {/* Axis labels */}
                <div className="flex justify-between text-[0.56rem] text-gray-300 mt-0.5 px-0.5">
                  <span>0%</span>
                  <span className="text-[#FFC845]/80">80%</span>
                  <span className="text-[#DC2626]/80">90%</span>
                  <span>100%</span>
                  <span>110%</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// CHART 5 — Change Orders by Contract
// ══════════════════════════════════════════════════════════════════

export function ChangeOrdersChart({ data }: { data: ChangeOrderSummary[] }) {
  if (data.length === 0) return (
    <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
      <SectionTitle>أوامر التغيير حسب العقد</SectionTitle>
      <EmptyState text="لا توجد أوامر تغيير مسجّلة" />
    </div>
  );

  const maxPct = Math.max(...data.map(d => d.pctOfBase), 1);
  const LIMIT  = 10; // 10% hard limit

  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
      <SectionTitle>أوامر التغيير حسب العقد</SectionTitle>

      <div className="flex gap-3 mb-3 text-[0.65rem]">
        <span className="flex items-center gap-1 text-gray-500">
          <span className="inline-block w-3 h-2 rounded bg-[#502C7C]" /> قيمة معتمدة
        </span>
        <span className="flex items-center gap-1 text-gray-500">
          <span className="inline-block w-3 h-2 rounded border border-[#DC2626] bg-[#FDECEA]" /> حد 10%
        </span>
        {data.some(d => d.pendingCount > 0) && (
          <span className="flex items-center gap-1 text-gray-500">
            <span className="inline-block w-2 h-2 rounded-full bg-[#FFC845]" /> بانتظار اعتماد
          </span>
        )}
      </div>

      <div className="space-y-3">
        {data.map((d, i) => {
          const filledPct = (d.pctOfBase / Math.max(maxPct, LIMIT + 1)) * 100;
          const limitLine = (LIMIT / Math.max(maxPct, LIMIT + 1)) * 100;
          const overLimit = d.pctOfBase > LIMIT;
          return (
            <div key={i}>
              <div className="flex justify-between items-center mb-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[0.7rem] font-bold text-gray-700 truncate max-w-[45%]">
                    {d.contractNo}
                  </span>
                  {d.pendingCount > 0 && (
                    <span className="text-[0.58rem] font-bold px-1.5 py-0.5 rounded-full bg-[#FFF8E0] text-[#7A4F00]">
                      {d.pendingCount} معلّق
                    </span>
                  )}
                  {overLimit && (
                    <span className="text-[0.58rem] font-bold px-1.5 py-0.5 rounded-full bg-[#FDECEA] text-[#991B1B]">
                      تجاوز 10%
                    </span>
                  )}
                </div>
                <div className="text-[0.65rem] text-gray-500 flex-shrink-0 tabular-nums">
                  {d.count} أمر | {fmtSAR(d.approvedValue)} ({d.pctOfBase.toFixed(1)}%)
                </div>
              </div>
              {/* Bar */}
              <div className="relative h-5 bg-gray-100 rounded-md overflow-hidden">
                {/* 10% limit line */}
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-[#DC2626]/40 z-10"
                  style={{ insetInlineStart: `${Math.min(limitLine, 99)}%` }}
                />
                {/* Fill */}
                <div
                  className="absolute top-0 bottom-0 start-0 rounded-md"
                  style={{
                    width: `${Math.min(filledPct, 100)}%`,
                    background: overLimit ? '#DC2626' : '#502C7C',
                    opacity: 0.8,
                  }}
                />
                {/* Count label */}
                {d.count > 0 && (
                  <span className="absolute inset-y-0 start-2 flex items-center text-white text-[0.65rem] font-black z-20">
                    {d.count}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
