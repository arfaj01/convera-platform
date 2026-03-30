'use client';

/**
 * Executive Risk Panel — 🔴 Red section
 *
 * Shows: contracts near ceiling, SLA-breached claims,
 * anomaly claims, repeated-rejection contracts.
 * Each item links directly to the relevant entity.
 */

import { useRouter } from 'next/navigation';
import type { ContractSpend, AttentionItem } from '@/services/dashboard';

interface Props {
  contractSpends: ContractSpend[];
  attentionItems: AttentionItem[];
}

interface RiskRow {
  icon:      string;
  label:     string;
  sub:       string;
  route?:    string;
  severity:  'critical' | 'high';
}

export default function ExecutiveRiskPanel({ contractSpends, attentionItems }: Props) {
  const router = useRouter();

  const rows: RiskRow[] = [];

  // Critical attention items
  for (const item of attentionItems.filter(i => i.severity === 'critical').slice(0, 4)) {
    rows.push({
      icon:     item.type === 'sla_breach'    ? '⏱' :
                item.type === 'near_ceiling'  ? '💸' : '⚠️',
      label:    item.title,
      sub:      item.subtitle,
      route:    item.claimId ? `/claims/${item.claimId}` : item.contractId ? `/contracts/${item.contractId}` : undefined,
      severity: 'critical',
    });
  }

  // Contracts > 90% utilization
  for (const ct of contractSpends.filter(c => c.pctConsumed >= 90 && c.riskLevel === 'critical').slice(0, 3)) {
    if (!rows.find(r => r.route === `/contracts/${ct.contractId}`)) {
      rows.push({
        icon:     '💸',
        label:    `${ct.title.slice(0, 40)} — ${ct.pctConsumed.toFixed(0)}٪ من السقف`,
        sub:      `${ct.contractNo} | متبقي: ${Math.round(ct.remaining).toLocaleString('ar-SA')} ر.س`,
        route:    `/contracts/${ct.contractId}`,
        severity: 'critical',
      });
    }
  }

  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-4" style={{ boxShadow: '0 2px 8px rgba(4,88,89,.06)' }}>
        <SectionHeader icon="🔴" title="مواطن الخطر" count={0} color="#DC2626" />
        <div className="flex flex-col items-center justify-center py-6 gap-2">
          <span className="text-2xl">✅</span>
          <p className="text-xs text-gray-400 font-bold">لا توجد مواطن خطر حالياً</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden" style={{ boxShadow: '0 2px 8px rgba(4,88,89,.06)' }}>
      <SectionHeader icon="🔴" title="مواطن الخطر" count={rows.length} color="#DC2626" />

      <div className="divide-y divide-gray-50">
        {rows.map((row, i) => (
          <button
            key={i}
            onClick={() => row.route && router.push(row.route)}
            className="w-full text-right flex items-start gap-3 px-4 py-3 hover:bg-red-50/60 transition-colors group"
            disabled={!row.route}
          >
            <div
              className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-sm mt-0.5"
              style={{ background: row.severity === 'critical' ? '#FEE2E2' : '#FAEEE8' }}
            >
              {row.icon}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-black text-gray-800 leading-snug group-hover:text-red-700 transition-colors">
                {row.label}
              </p>
              <p className="text-[0.65rem] text-gray-400 mt-0.5 truncate">{row.sub}</p>
            </div>
            {row.route && (
              <span className="text-gray-300 text-xs group-hover:text-red-400 transition-colors flex-shrink-0 mt-1">←</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Shared Header ────────────────────────────────────────────────

function SectionHeader({
  icon, title, count, color,
}: { icon: string; title: string; count: number; color: string }) {
  return (
    <div
      className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100"
      style={{ borderTop: `3px solid ${color}` }}
    >
      <div className="flex items-center gap-2">
        <span className="text-base leading-none">{icon}</span>
        <span className="text-[0.8rem] font-black text-gray-800">{title}</span>
      </div>
      {count > 0 && (
        <span
          className="text-[0.65rem] font-black text-white rounded-full px-2 py-0.5"
          style={{ background: color }}
        >
          {count}
        </span>
      )}
    </div>
  );
}
