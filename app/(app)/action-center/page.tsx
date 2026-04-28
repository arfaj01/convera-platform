'use client';

/**
 * CONVERA — Action Center (مركز الإجراءات)
 *
 * Operations command center showing every user exactly:
 *   1. What needs action now   (CRITICAL)
 *   2. What needs attention soon (HIGH)
 *   3. What can be improved   (MEDIUM/LOW)
 *   4. Full unified list with filters + sorting
 *
 * Role-aware — each user sees only items relevant to their scope.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { getAuthHeaders } from '@/lib/supabase';
import type { ActionItem, ActionPriority, ActionCategory } from '@/lib/action-center-service';
import { getWorkflowActions, getBusinessActions } from '@/lib/action-engine';
import FilterBar, { type FilterItem } from '@/components/ui/FilterBar';
import EmptyState from '@/components/ui/EmptyState';
import AlertCard from '@/components/ui/AlertCard';
import {
  ShieldAlert, AlertTriangle, AlertCircle, CheckCircle2,
  Clock, DollarSign, GitMerge, Paperclip, Scale,
  RotateCcw, User as UserIcon, BarChart3, Search,
  Lightbulb, FileText, Wrench, RefreshCw, Settings, ListChecks,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// ─── Display configuration ────────────────────────────────────────

interface PriorityCfg {
  label: string;
  color: string;
  bg: string;
  border: string;
  icon: LucideIcon;
  sectionTitle: string;
  sectionSubtitle: string;
}

const PRIORITY_CFG: Record<ActionPriority, PriorityCfg> = {
  CRITICAL: {
    label: 'حرج', color: '#DC2626', bg: '#FEF2F2', border: '#FCA5A5',
    icon: ShieldAlert,
    sectionTitle: 'إجراءات فورية',
    sectionSubtitle: 'هذه البنود تستدعي تدخلاً فورياً — لا يجوز تأجيلها',
  },
  HIGH: {
    label: 'مرتفع', color: '#C05728', bg: '#FFF7F3', border: '#FDBA74',
    icon: AlertTriangle,
    sectionTitle: 'تستوجب الاهتمام',
    sectionSubtitle: 'بنود مرتفعة الأولوية — يُنصح بمعالجتها خلال 24 ساعة',
  },
  MEDIUM: {
    label: 'متوسط', color: '#B45309', bg: '#FFFBEB', border: '#FCD34D',
    icon: AlertCircle,
    sectionTitle: 'توصيات وتحسينات',
    sectionSubtitle: 'فرص تحسين لا تستدعي تدخلاً عاجلاً',
  },
  LOW: {
    label: 'منخفض', color: '#166534', bg: '#F0FDF4', border: '#86EFAC',
    icon: CheckCircle2,
    sectionTitle: 'ملاحظات',
    sectionSubtitle: 'بنود منخفضة المخاطر للمراجعة الدورية',
  },
};

interface CategoryCfg { icon: LucideIcon; label: string }

const CATEGORY_CFG: Record<ActionCategory, CategoryCfg> = {
  sla:        { icon: Clock,       label: 'مهلة SLA' },
  financial:  { icon: DollarSign,  label: 'مالي' },
  workflow:   { icon: GitMerge,    label: 'سير عمل' },
  documents:  { icon: Paperclip,   label: 'مستندات' },
  risk:       { icon: AlertTriangle, label: 'مخاطر' },
  governance: { icon: Scale,       label: 'حوكمة' },
};

const ENTITY_TYPE_LABELS: Record<ActionItem['entityType'], string> = {
  claim:        'مطالبة',
  contract:     'عقد',
  change_order: 'أمر تغيير',
};

// ─── Filter / Sort state ──────────────────────────────────────────

type FilterTab =
  | 'all'
  | 'critical'
  | 'high'
  | 'overdue'
  | 'mine'
  | 'claims'
  | 'contracts'
  | 'change_orders';

type SortMode = 'priority' | 'age_desc' | 'age_asc' | 'mine_first';

const FILTER_ICON: Record<FilterTab, LucideIcon> = {
  all:            ListChecks,
  critical:       ShieldAlert,
  high:           AlertTriangle,
  overdue:        Clock,
  mine:           UserIcon,
  claims:         FileText,
  contracts:      FileText,
  change_orders:  Wrench,
};

const FILTER_TAB_LABEL: Record<FilterTab, string> = {
  all: 'الكل', critical: 'حرج', high: 'مرتفع', overdue: 'متأخر',
  mine: 'بانتظاري', claims: 'مطالبات', contracts: 'عقود', change_orders: 'أوامر التغيير',
};

// ─── Loading skeleton ─────────────────────────────────────────────

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`rounded animate-pulse bg-gray-100 ${className}`} />;
}

function LoadingState() {
  return (
    <div className="space-y-6" dir="rtl">
      {/* KPI strip skeleton */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-100 p-4">
            <Skeleton className="h-6 w-10 mb-2" />
            <Skeleton className="h-8 w-14 mb-1" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
      {/* Cards skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-100 p-4">
            <div className="flex gap-3 mb-3">
              <Skeleton className="h-5 w-5 rounded" />
              <div className="flex-1"><Skeleton className="h-4 w-3/4 mb-2" /><Skeleton className="h-3 w-1/2" /></div>
              <Skeleton className="h-5 w-14 rounded-full" />
            </div>
            <Skeleton className="h-10 w-full rounded-lg mb-3" />
            <Skeleton className="h-7 w-28 rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────

interface AcKpiCardProps {
  label:       string;
  value:       number;
  icon:        LucideIcon;
  accentColor: string;
  isActive?:   boolean;
  onClick?:    () => void;
}

function AcKpiCard({ label, value, icon: Icon, accentColor, isActive, onClick }: AcKpiCardProps) {
  return (
    <div
      className={`
        relative bg-white rounded-xl p-4 flex flex-col gap-1.5 transition-all
        ${onClick ? 'cursor-pointer hover:shadow-md' : ''}
        ${isActive ? 'ring-2' : 'border border-gray-100 hover:border-gray-200'}
      `}
      style={{
        borderRightWidth: 4,
        borderRightColor: accentColor,
        boxShadow: isActive ? `0 0 0 2px ${accentColor}` : undefined,
      }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      <div className="flex items-center justify-between">
        <Icon size={18} strokeWidth={2.2} style={{ color: accentColor }} />
        {isActive && (
          <span
            className="text-[0.55rem] font-black px-1.5 py-0.5 rounded-full text-white"
            style={{ background: accentColor }}
          >
            فعّال
          </span>
        )}
      </div>
      <div className="text-2xl font-black leading-none tabular-nums" style={{ color: accentColor }}>
        {value}
      </div>
      <div className="text-[0.65rem] font-bold text-gray-500 leading-tight">{label}</div>
    </div>
  );
}

// ─── Action Item Card ─────────────────────────────────────────────

interface ActionCardProps {
  item:     ActionItem;
  onAction: (url: string) => void;
}

function ActionCard({ item, onAction }: ActionCardProps) {
  const pcfg  = PRIORITY_CFG[item.priority];
  const ccfg  = CATEGORY_CFG[item.category];
  const etLabel = ENTITY_TYPE_LABELS[item.entityType];
  const PIcon = pcfg.icon;
  const CIcon = ccfg.icon;

  return (
    <div
      className="bg-white rounded-xl overflow-hidden transition-all hover:shadow-lg hover:-translate-y-px group"
      style={{ border: `1px solid ${pcfg.border}`, boxShadow: '0 1px 4px rgba(0,0,0,.04)' }}
    >
      {/* Priority accent bar */}
      <div className="h-[3px]" style={{ background: pcfg.color }} />

      <div className="p-4">
        {/* Top row: category icon + title + priority badge */}
        <div className="flex items-start gap-2.5 mb-2.5">
          <CIcon size={18} strokeWidth={2.2} className="mt-0.5 flex-shrink-0" style={{ color: pcfg.color }} />
          <div className="flex-1 min-w-0">
            <p className="text-[0.8rem] font-black text-gray-800 leading-snug">{item.title}</p>
            <p className="text-[0.65rem] text-gray-400 mt-0.5 font-bold truncate">{item.entityRef}</p>
          </div>
          <div className="flex-shrink-0 flex flex-col items-end gap-1.5">
            {/* Priority badge */}
            <span
              className="inline-flex items-center gap-1 text-[0.6rem] font-black px-2 py-0.5 rounded-full whitespace-nowrap"
              style={{ background: pcfg.bg, color: pcfg.color, border: `1px solid ${pcfg.border}` }}
            >
              <PIcon size={11} strokeWidth={2.4} />
              {pcfg.label}
            </span>
            {/* Risk score mini bar */}
            <div className="flex items-center gap-1.5">
              <div className="w-14 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${item.riskScore}%`, background: pcfg.color }}
                />
              </div>
              <span className="text-[0.55rem] text-gray-400 font-bold">{item.riskScore}</span>
            </div>
          </div>
        </div>

        {/* Description */}
        <p className="text-[0.7rem] text-gray-500 leading-relaxed mb-2.5">{item.description}</p>

        {/* Recommendation box */}
        <div
          className="rounded-lg px-3 py-2 mb-3 text-[0.7rem] leading-relaxed font-bold flex items-start gap-2"
          style={{ background: pcfg.bg, color: pcfg.color, borderRight: `3px solid ${pcfg.color}` }}
        >
          <Lightbulb size={13} strokeWidth={2.2} className="flex-shrink-0 mt-0.5" />
          <span>{item.recommendation}</span>
        </div>

        {/* Meta badges row */}
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          {/* Entity type */}
          <span className="inline-flex items-center gap-1 text-[0.6rem] font-bold text-gray-500 bg-gray-50 border border-gray-100 px-1.5 py-0.5 rounded">
            {etLabel}
          </span>
          {/* Category */}
          <span className="inline-flex items-center gap-1 text-[0.6rem] font-bold text-gray-500 bg-gray-50 border border-gray-100 px-1.5 py-0.5 rounded">
            <CIcon size={10} strokeWidth={2.2} />
            {ccfg.label}
          </span>
          {/* Age */}
          {item.ageInDays > 0 && (
            <span className="inline-flex items-center gap-1 text-[0.6rem] font-bold text-gray-500 bg-gray-50 border border-gray-100 px-1.5 py-0.5 rounded">
              <Clock size={10} strokeWidth={2.2} />
              {String(item.metadata.ageLabel ?? `${item.ageInDays} يوم`)}
            </span>
          )}
          {/* Overdue badge */}
          {item.isOverdue && (
            <span className="inline-flex items-center gap-1 text-[0.6rem] font-black px-1.5 py-0.5 rounded text-white" style={{ background: '#DC2626' }}>
              <AlertTriangle size={10} strokeWidth={2.4} />
              متأخر
            </span>
          )}
          {/* Assigned to me */}
          {item.assignedToMe && (
            <span
              className="inline-flex items-center gap-1 text-[0.6rem] font-black px-1.5 py-0.5 rounded"
              style={{ background: '#E8F4F4', color: '#045859', border: '1px solid #045859' }}
            >
              <UserIcon size={10} strokeWidth={2.4} />
              بانتظارك
            </span>
          )}
          {/* Utilization pct if present */}
          {item.metadata.utilizationPct !== undefined && (
            <span className="inline-flex items-center gap-1 text-[0.6rem] font-bold text-gray-500 bg-gray-50 border border-gray-100 px-1.5 py-0.5 rounded">
              <BarChart3 size={10} strokeWidth={2.2} />
              {String(item.metadata.utilizationPct)}٪ استخدام
            </span>
          )}
          {/* Return count if present */}
          {item.metadata.returnCnt !== undefined && Number(item.metadata.returnCnt) > 0 && (
            <span className="inline-flex items-center gap-1 text-[0.6rem] font-bold px-1.5 py-0.5 rounded" style={{ background: '#FAEEE8', color: '#C05728' }}>
              <RotateCcw size={10} strokeWidth={2.4} />
              إرجاع ×{String(item.metadata.returnCnt)}
            </span>
          )}
        </div>

        {/* Action buttons — from action engine */}
        <div className="flex flex-wrap items-center gap-1.5">
          {item.actions && item.actions.length > 0 ? (
            <>
              {/* Show workflow + business actions as real buttons */}
              {[...getWorkflowActions(item.actions), ...getBusinessActions(item.actions)]
                .filter(a => a.visible)
                .slice(0, 3)
                .map((action, i) => (
                  <button
                    key={`${action.type}-${i}`}
                    onClick={() => onAction(item.quickActionUrl)}
                    disabled={!action.enabled}
                    title={action.enabled ? action.description_ar : (action.reason_if_disabled || '')}
                    className={`
                      flex items-center gap-1 text-[0.68rem] font-black
                      px-2.5 py-1.5 rounded-lg transition-all
                      ${action.enabled
                        ? 'hover:-translate-y-px hover:shadow-md active:translate-y-0'
                        : 'opacity-50 cursor-not-allowed'}
                    `}
                    style={{
                      background: action.enabled
                        ? action.type === 'reject'
                          ? '#C05728'
                          : action.type === 'return'
                            ? '#FFC845'
                            : action.type === 'upload_documents' || action.type === 'fix_validation'
                              ? '#00A79D'
                              : '#045859'
                        : '#9CA3AF',
                      color: action.type === 'return' ? '#1A1A2E' : '#FFFFFF',
                    }}
                  >
                    {action.label_ar}
                  </button>
                ))}
              {/* Fallback: open claim link */}
              <button
                onClick={() => onAction(item.quickActionUrl)}
                className="flex items-center gap-1 text-[0.68rem] font-bold text-gray-500 hover:text-gray-700 px-2 py-1.5 rounded-lg border border-gray-200 hover:border-gray-300 transition-all"
              >
                فتح المطالبة ←
              </button>
            </>
          ) : (
            /* Non-claim items or claims with no actions: fallback button */
            <button
              onClick={() => onAction(item.quickActionUrl)}
              className="
                flex items-center gap-1.5 text-[0.72rem] font-black text-white
                px-3.5 py-1.5 rounded-lg transition-all
                hover:-translate-y-px hover:shadow-md active:translate-y-0
              "
              style={{
                background: `linear-gradient(135deg, ${pcfg.color} 0%, ${pcfg.color}bb 100%)`,
                boxShadow:  `0 2px 6px ${pcfg.color}30`,
              }}
            >
              <span>{item.quickActionLabel}</span>
              <span className="text-xs opacity-80">←</span>
            </button>
          )}
        </div>

        {/* SLA + Owner badges */}
        {(item.sla || item.currentOwner) && (
          <div className="flex flex-wrap items-center gap-1.5 mt-2 pt-2 border-t border-gray-50">
            {item.currentOwner && (
              <span className="inline-flex items-center gap-1 text-[0.6rem] font-bold text-gray-500 bg-gray-50 border border-gray-100 px-1.5 py-0.5 rounded">
                <UserIcon size={10} strokeWidth={2.2} />
                المسؤول: {item.currentOwner}
              </span>
            )}
            {item.sla && (
              <span
                className="inline-flex items-center gap-1 text-[0.6rem] font-black px-1.5 py-0.5 rounded"
                style={{
                  background: item.sla.level === 'overdue' ? '#FEF2F2' : item.sla.level === 'warning' ? '#FFFBEB' : '#F0FDF4',
                  color: item.sla.level === 'overdue' ? '#DC2626' : item.sla.level === 'warning' ? '#B45309' : '#166534',
                }}
              >
                <Clock size={10} strokeWidth={2.4} />
                {item.sla.daysElapsed}/{item.sla.config.limitDays} يوم ({item.sla.slaPct}٪)
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Section header ───────────────────────────────────────────────

function SectionHeader({
  priority,
  count,
}: { priority: ActionPriority; count: number }) {
  const cfg = PRIORITY_CFG[priority];
  const Ic = cfg.icon;
  return (
    <div className="flex items-center gap-3 mb-4">
      <Ic size={20} strokeWidth={2.2} style={{ color: cfg.color }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-[0.95rem] font-black text-gray-800">{cfg.sectionTitle}</h2>
          <span
            className="text-[0.65rem] font-black px-2 py-0.5 rounded-full text-white flex-shrink-0 tabular-nums"
            style={{ background: cfg.color }}
          >
            {count} {count === 1 ? 'بند' : 'بنود'}
          </span>
        </div>
        <p className="text-[0.67rem] text-gray-400 mt-0.5">{cfg.sectionSubtitle}</p>
      </div>
      <div className="h-px flex-1 hidden sm:block" style={{ background: cfg.border }} />
    </div>
  );
}

// ─── Empty section state ──────────────────────────────────────────

function EmptySection({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 rounded-xl border border-gray-100 mb-4">
      <CheckCircle2 size={14} className="text-gray-300" strokeWidth={2.2} />
      <span className="text-[0.72rem] text-gray-400 font-bold">{message}</span>
    </div>
  );
}

// ─── Cards grid ───────────────────────────────────────────────────

function CardsGrid({ items, onAction }: { items: ActionItem[]; onAction: (url: string) => void }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mb-2">
      {items.map(item => (
        <ActionCard key={item.id} item={item} onAction={onAction} />
      ))}
    </div>
  );
}

// ─── Compact list row (used in the full-list section) ────────────

function ListRow({ item, onAction }: { item: ActionItem; onAction: (url: string) => void }) {
  const pcfg = PRIORITY_CFG[item.priority];
  const ccfg = CATEGORY_CFG[item.category];
  const PIcon = pcfg.icon;
  const CIcon = ccfg.icon;

  return (
    <div
      className="bg-white rounded-xl border transition-all hover:shadow-md flex items-stretch overflow-hidden"
      style={{ borderColor: pcfg.border }}
    >
      {/* Left accent */}
      <div className="w-1 flex-shrink-0" style={{ background: pcfg.color }} />

      <div className="flex-1 px-3 py-2.5 flex flex-wrap items-center gap-2">
        {/* Category icon */}
        <CIcon size={16} strokeWidth={2.2} className="flex-shrink-0" style={{ color: pcfg.color }} />

        {/* Title + ref */}
        <div className="flex-1 min-w-0">
          <span className="text-[0.78rem] font-black text-gray-800">{item.title}</span>
          <span className="text-[0.62rem] text-gray-400 font-bold mr-2">{item.entityRef}</span>
        </div>

        {/* Badges */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span
            className="inline-flex items-center gap-1 text-[0.58rem] font-black px-2 py-0.5 rounded-full"
            style={{ background: pcfg.bg, color: pcfg.color, border: `1px solid ${pcfg.border}` }}
          >
            <PIcon size={9} strokeWidth={2.4} />
            {pcfg.label}
          </span>
          {item.isOverdue && (
            <span className="text-[0.58rem] font-black text-white px-1.5 py-0.5 rounded" style={{ background: '#DC2626' }}>
              متأخر
            </span>
          )}
          {item.assignedToMe && (
            <span className="inline-flex items-center gap-1 text-[0.58rem] font-black px-1.5 py-0.5 rounded" style={{ background: '#E8F4F4', color: '#045859' }}>
              <UserIcon size={9} strokeWidth={2.4} />
              بانتظارك
            </span>
          )}
          {item.ageInDays > 0 && (
            <span className="text-[0.58rem] text-gray-400 font-bold hidden sm:inline">
              {String(item.metadata.ageLabel ?? `${item.ageInDays}ي`)}
            </span>
          )}
        </div>

        {/* Quick action */}
        <button
          onClick={() => onAction(item.quickActionUrl)}
          className="flex-shrink-0 text-[0.68rem] font-black text-white px-2.5 py-1 rounded-lg transition-all hover:opacity-90"
          style={{ background: pcfg.color }}
        >
          {item.quickActionLabel} ←
        </button>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────

export default function ActionCenterPage() {
  const router = useRouter();
  const { profile, loading: authLoading } = useAuth();

  const [items,       setItems]       = useState<ActionItem[]>([]);
  const [summary,     setSummary]     = useState({
    totalCritical: 0, totalHigh: 0, totalMedium: 0, totalLow: 0,
    totalOverdue: 0, totalMine: 0,
  });
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
  const [sortMode,    setSortMode]    = useState<SortMode>('priority');
  const [runningAuto, setRunningAuto] = useState(false);
  const [autoMsg,     setAutoMsg]     = useState<string | null>(null);

  // ── Load data ─────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/action-center', { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const d = json.data;
      setItems(d.items ?? []);
      setSummary({
        totalCritical: d.totalCritical ?? 0,
        totalHigh:     d.totalHigh     ?? 0,
        totalMedium:   d.totalMedium   ?? 0,
        totalLow:      d.totalLow      ?? 0,
        totalOverdue:  d.totalOverdue  ?? 0,
        totalMine:     d.totalMine     ?? 0,
      });
      setGeneratedAt(d.generatedAt ?? null);
    } catch (e) {
      console.error('ActionCenter error:', e);
      setError('تعذّر تحميل بيانات مركز الإجراءات');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading) load();
  }, [load, authLoading]);

  // ── Run automation ────────────────────────────────────────────
  const runAutomation = async () => {
    if (!profile) return;
    setRunningAuto(true);
    setAutoMsg(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/executive/automation/run', { method: 'POST', headers });
      if (!res.ok) throw new Error();
      const json = await res.json();
      const d = json.data;
      setAutoMsg(`✅ ${d.rules_evaluated} قاعدة — ${d.actions_run} إجراء تلقائي`);
      load();
    } catch {
      setAutoMsg('❌ فشل تشغيل الأتمتة');
    } finally {
      setRunningAuto(false);
    }
  };

  // ── Navigate to entity ────────────────────────────────────────
  const handleAction = useCallback((url: string) => {
    router.push(url);
  }, [router]);

  // ── Filtered + sorted items ───────────────────────────────────
  const displayItems = useMemo(() => {
    let filtered = items;

    switch (activeFilter) {
      case 'critical':      filtered = items.filter(i => i.priority === 'CRITICAL'); break;
      case 'high':          filtered = items.filter(i => i.priority === 'HIGH'); break;
      case 'overdue':       filtered = items.filter(i => i.isOverdue); break;
      case 'mine':          filtered = items.filter(i => i.assignedToMe); break;
      case 'claims':        filtered = items.filter(i => i.entityType === 'claim'); break;
      case 'contracts':     filtered = items.filter(i => i.entityType === 'contract'); break;
      case 'change_orders': filtered = items.filter(i => i.entityType === 'change_order'); break;
    }

    const PRIORITY_ORDER: Record<ActionPriority, number> = {
      CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3,
    };

    return [...filtered].sort((a, b) => {
      switch (sortMode) {
        case 'priority':
          return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || b.riskScore - a.riskScore;
        case 'age_desc':
          return b.ageInDays - a.ageInDays;
        case 'age_asc':
          return a.ageInDays - b.ageInDays;
        case 'mine_first':
          if (a.assignedToMe !== b.assignedToMe) return a.assignedToMe ? -1 : 1;
          return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
        default:
          return 0;
      }
    });
  }, [items, activeFilter, sortMode]);

  // ── Grouped for "all" view ────────────────────────────────────
  const criticalItems = useMemo(() => items.filter(i => i.priority === 'CRITICAL'), [items]);
  const highItems     = useMemo(() => items.filter(i => i.priority === 'HIGH'), [items]);
  const medLowItems   = useMemo(() => items.filter(i => i.priority === 'MEDIUM' || i.priority === 'LOW'), [items]);

  const totalItems = items.length;

  // ── Time display ──────────────────────────────────────────────
  const timeStr = generatedAt
    ? new Date(generatedAt).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })
    : null;

  // ── Early states ──────────────────────────────────────────────
  if (authLoading || (loading && items.length === 0)) return <LoadingState />;

  if (error) {
    return (
      <div className="py-12" dir="rtl">
        <AlertCard
          level="danger"
          title={error}
          action={
            <button
              onClick={load}
              className="text-sm text-white font-bold px-4 py-2 rounded-lg"
              style={{ background: '#045859' }}
            >
              إعادة المحاولة
            </button>
          }
        />
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="space-y-5 pb-12" dir="rtl">

      {/* ── Page Header ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-[#045859]">
            مركز الإجراءات
          </h1>
          <p className="text-[0.75rem] text-gray-500 mt-0.5">
            {totalItems > 0
              ? `${totalItems} بند يحتاج اهتمامك${timeStr ? ` — آخر تحديث ${timeStr}` : ''}`
              : `المنصة بخير${timeStr ? ` — تحديث ${timeStr}` : ''}`
            }
          </p>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 flex-wrap">
          {autoMsg && (
            <span className="text-[0.68rem] font-bold text-gray-600 bg-gray-50 px-2.5 py-1.5 rounded-lg border border-gray-200">
              {autoMsg}
            </span>
          )}
          {(profile?.role === 'director' || profile?.role === 'admin') && (
            <button
              onClick={runAutomation}
              disabled={runningAuto}
              className="flex items-center gap-1.5 text-[0.72rem] font-black text-white px-3 py-1.5 rounded-lg transition-all hover:-translate-y-px disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #502C7C 0%, #7B4DB5 100%)' }}
            >
              <Settings size={12} strokeWidth={2.4} />
              {runningAuto ? 'جاري...' : 'تشغيل الأتمتة'}
            </button>
          )}
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1 text-[0.72rem] font-bold text-teal hover:text-teal-dark transition-colors disabled:opacity-40"
          >
            <RefreshCw size={12} strokeWidth={2.4} className={loading ? 'animate-spin' : ''} />
            <span>تحديث</span>
          </button>
        </div>
      </div>

      {/* ── KPI Strip ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <AcKpiCard
          label="إجراءات حرجة"
          value={summary.totalCritical}
          icon={ShieldAlert}
          accentColor="#DC2626"
          isActive={activeFilter === 'critical'}
          onClick={() => setActiveFilter(f => f === 'critical' ? 'all' : 'critical')}
        />
        <AcKpiCard
          label="أولوية مرتفعة"
          value={summary.totalHigh}
          icon={AlertTriangle}
          accentColor="#C05728"
          isActive={activeFilter === 'high'}
          onClick={() => setActiveFilter(f => f === 'high' ? 'all' : 'high')}
        />
        <AcKpiCard
          label="بنود متأخرة"
          value={summary.totalOverdue}
          icon={Clock}
          accentColor="#B45309"
          isActive={activeFilter === 'overdue'}
          onClick={() => setActiveFilter(f => f === 'overdue' ? 'all' : 'overdue')}
        />
        <AcKpiCard
          label="بانتظار إجراءك"
          value={summary.totalMine}
          icon={UserIcon}
          accentColor="#045859"
          isActive={activeFilter === 'mine'}
          onClick={() => setActiveFilter(f => f === 'mine' ? 'all' : 'mine')}
        />
        <AcKpiCard
          label="توصيات"
          value={summary.totalMedium + summary.totalLow}
          icon={Lightbulb}
          accentColor="#87BA26"
          isActive={false}
        />
        <AcKpiCard
          label="إجمالي البنود"
          value={totalItems}
          icon={ListChecks}
          accentColor="#54565B"
          isActive={activeFilter === 'all'}
          onClick={() => setActiveFilter('all')}
        />
      </div>

      {/* ── Empty / Healthy state ────────────────────────────────── */}
      {totalItems === 0 && !loading && (
        <EmptyState
          size="lg"
          icon={CheckCircle2}
          title="المنصة بخير"
          description="لا توجد بنود تستدعي تدخلاً حالياً"
        />
      )}

      {totalItems > 0 && (
        <>
          {/* ── Filter + Sort Bar ───────────────────────────────── */}
          {(() => {
            const filterCount = (id: FilterTab): number =>
              id === 'all'            ? totalItems
            : id === 'critical'       ? summary.totalCritical
            : id === 'high'           ? summary.totalHigh
            : id === 'overdue'        ? summary.totalOverdue
            : id === 'mine'           ? summary.totalMine
            : id === 'claims'         ? items.filter(i => i.entityType === 'claim').length
            : id === 'contracts'      ? items.filter(i => i.entityType === 'contract').length
            : id === 'change_orders'  ? items.filter(i => i.entityType === 'change_order').length
            : 0;
            const filterItems: FilterItem<FilterTab>[] = (
              ['all','critical','high','overdue','mine','claims','contracts','change_orders'] as FilterTab[]
            ).map(id => {
              const Ic = FILTER_ICON[id];
              return {
                value: id,
                label: FILTER_TAB_LABEL[id],
                count: filterCount(id),
                icon: <Ic size={11} strokeWidth={2.4} />,
              };
            });
            return (
              <div className="flex flex-wrap items-center justify-between gap-2 bg-white rounded-xl border border-gray-100 px-3 py-2.5">
                <FilterBar<FilterTab>
                  size="sm"
                  items={filterItems}
                  value={activeFilter}
                  onChange={setActiveFilter}
                />
                <select
                  value={sortMode}
                  onChange={e => setSortMode(e.target.value as SortMode)}
                  className="text-[0.68rem] font-bold text-gray-600 border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-teal/40 font-sans"
                >
                  <option value="priority">ترتيب: الأولوية</option>
                  <option value="age_desc">ترتيب: الأقدم أولاً</option>
                  <option value="age_asc">ترتيب: الأحدث أولاً</option>
                  <option value="mine_first">ترتيب: المخصص لي أولاً</option>
                </select>
              </div>
            );
          })()}

          {/* ── Content ─────────────────────────────────────────── */}

          {/* Section view (activeFilter === 'all') */}
          {activeFilter === 'all' ? (
            <div className="space-y-6">

              {/* Section 1: Critical Actions */}
              <section>
                <SectionHeader priority="CRITICAL" count={criticalItems.length} />
                {criticalItems.length === 0
                  ? <EmptySection message="لا توجد إجراءات حرجة — أداء ممتاز" />
                  : <CardsGrid items={criticalItems} onAction={handleAction} />
                }
              </section>

              {/* Section 2: High — Attention Needed */}
              <section>
                <SectionHeader priority="HIGH" count={highItems.length} />
                {highItems.length === 0
                  ? <EmptySection message="لا توجد بنود مرتفعة الأولوية" />
                  : <CardsGrid items={highItems} onAction={handleAction} />
                }
              </section>

              {/* Section 3: Medium/Low — Recommendations */}
              {medLowItems.length > 0 && (
                <section>
                  <SectionHeader priority="MEDIUM" count={medLowItems.length} />
                  <CardsGrid items={medLowItems} onAction={handleAction} />
                </section>
              )}

            </div>
          ) : (
            /* Flat filtered list */
            <div className="space-y-2">
              {displayItems.length === 0 ? (
                <EmptyState
                  size="md"
                  icon={Search}
                  title="لا توجد بنود تطابق الفلتر المحدد"
                  action={
                    <button
                      onClick={() => setActiveFilter('all')}
                      className="text-sm font-bold text-teal underline"
                    >
                      عرض الكل
                    </button>
                  }
                />
              ) : (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[0.72rem] font-bold text-gray-500">
                      {displayItems.length} بند
                    </span>
                  </div>
                  {displayItems.map(item => (
                    <ListRow key={item.id} item={item} onAction={handleAction} />
                  ))}
                </>
              )}
            </div>
          )}

          {/* ── Full list section (always visible at bottom when in 'all' view) */}
          {activeFilter === 'all' && totalItems > 3 && (
            <section>
              {/* Divider */}
              <div className="flex items-center gap-3 mb-4 mt-6">
                <div className="h-px flex-1 bg-gray-100" />
                <span className="text-[0.68rem] font-bold text-gray-400 px-3 py-1 bg-gray-50 rounded-full border border-gray-100">
                  القائمة الكاملة ({totalItems} بند)
                </span>
                <div className="h-px flex-1 bg-gray-100" />
              </div>
              <div className="space-y-1.5">
                {items.map(item => (
                  <ListRow key={`list-${item.id}`} item={item} onAction={handleAction} />
                ))}
              </div>
            </section>
          )}

        </>
      )}

    </div>
  );
}
