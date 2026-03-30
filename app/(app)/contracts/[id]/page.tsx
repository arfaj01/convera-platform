'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import PageHeader from '@/components/ui/PageHeader';
import Card, { CardHeader, CardBody } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { CustomBadge } from '@/components/ui/Badge';
import AmendmentList from '@/components/contracts/AmendmentList';
import { fetchContractById } from '@/services/contracts';
import { fetchClaims } from '@/services/claims';
import { fetchContractCeiling } from '@/services/amendments';
import { fmt, fmtDate, fmtCurrency } from '@/lib/formatters';
import { CONTRACT_TYPE_LABELS } from '@/lib/constants';
import { createBrowserSupabase } from '@/lib/supabase';
import type { ContractView, ClaimView, ContractCeiling } from '@/lib/types';

// ─── Types ────────────────────────────────────────────────────────

type Tab = 'summary' | 'boq_items' | 'staff_items' | 'amendments' | 'claims';

interface BOQTemplateRow {
  id:              string;
  item_no:         string;
  description_ar:  string | null;
  description:     string | null;
  unit:            string | null;
  unit_price:      string;
  contractual_qty: string;
  total_value?:    number;   // unit_price × contractual_qty
}

interface StaffTemplateRow {
  id:              string;
  item_no:         number;
  position:        string | null;
  position_ar:     string | null;
  monthly_rate:    number;
  contract_months: number;
  sort_order:      number;
  total_value:     number;   // monthly_rate × contract_months
  overtime_rate:   number;   // monthly_rate / 192 × 1.5  (per hour)
}

// ─── Data Fetchers ────────────────────────────────────────────────

async function fetchBOQTemplates(contractId: string): Promise<BOQTemplateRow[]> {
  const supabase = createBrowserSupabase();
  const { data, error } = await supabase
    .from('contract_boq_templates')
    .select('id, item_no, description_ar, description, unit, unit_price, contractual_qty')
    .eq('contract_id', contractId)
    .order('sort_order');

  if (error) throw error;

  return (data || []).map((r): BOQTemplateRow => ({
    ...r,
    total_value: (parseFloat(r.unit_price) || 0) * (parseFloat(r.contractual_qty) || 0),
  }));
}

async function fetchStaffTemplates(contractId: string): Promise<StaffTemplateRow[]> {
  const supabase = createBrowserSupabase();
  const { data, error } = await supabase
    .from('contract_staff_templates')
    .select('id, item_no, position, position_ar, monthly_rate, contract_months, sort_order')
    .eq('contract_id', contractId)
    .order('sort_order');

  if (error) throw error;

  return (data || []).map((r): StaffTemplateRow => ({
    ...r,
    total_value:   (r.monthly_rate || 0) * (r.contract_months || 0),
    overtime_rate: ((r.monthly_rate || 0) / 192) * 1.5,
  }));
}

// ─── Page Component ───────────────────────────────────────────────

export default function ContractDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { profile } = useAuth();

  const [contract,      setContract]      = useState<ContractView | null>(null);
  const [claims,        setClaims]        = useState<ClaimView[]>([]);
  const [boqTemplates,  setBoqTemplates]  = useState<BOQTemplateRow[]>([]);
  const [staffTemplates, setStaffTemplates] = useState<StaffTemplateRow[]>([]);
  const [ceiling,       setCeiling]       = useState<ContractCeiling | null>(null);
  const [tab,           setTab]           = useState<Tab>('summary');
  const [loading,       setLoading]       = useState(true);

  async function loadAll() {
    try {
      const [c, cl] = await Promise.all([
        fetchContractById(id),
        fetchClaims(id),
      ]);
      setContract(c);
      setClaims(cl);

      // BOQ + Staff templates (silently fail if tables missing)
      if (c) {
        try {
          setBoqTemplates(await fetchBOQTemplates(id));
        } catch {
          setBoqTemplates([]);
        }
        try {
          setStaffTemplates(await fetchStaffTemplates(id));
        } catch {
          setStaffTemplates([]);
        }
      }

      // Ceiling view may not exist if migration 007 hasn't been run yet
      try {
        const ceil = await fetchContractCeiling(id);
        setCeiling(ceil);
      } catch {
        if (c) {
          setCeiling({
            baseValue:      c.value,
            amendmentCount: 0,
            amendmentsTotal: 0,
            ceiling:        c.value * 1.10,
            hasAmendments:  false,
            totalSpent:     0,
            remaining:      c.value * 1.10,
          });
        }
      }
    } catch (e) {
      console.warn('Contract detail:', e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-sm text-gray-400 animate-pulse">جاري تحميل تفاصيل العقد...</p>
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-sm text-gray-400">العقد غير موجود</p>
      </div>
    );
  }

  const TABS: { key: Tab; label: string; count?: number }[] = [
    { key: 'summary',     label: 'ملخص' },
    { key: 'boq_items',   label: 'بنود التقارير', count: boqTemplates.length },
    { key: 'staff_items', label: 'القوى العاملة',  count: staffTemplates.length },
    { key: 'amendments',  label: 'التعديلات' },
    { key: 'claims',      label: 'المطالبات المالية', count: claims.length },
  ];

  const spentPct = ceiling && ceiling.ceiling > 0
    ? Math.round((ceiling.totalSpent / ceiling.ceiling) * 100)
    : 0;

  const isProvisionalZone =
    ceiling && !ceiling.hasAmendments && ceiling.totalSpent > ceiling.baseValue;

  return (
    <>
      <PageHeader
        title={contract.title}
        subtitle={`${contract.no} — ${contract.party}`}
      />

      {/* Tab bar */}
      <div className="flex gap-1 mb-4 border-b border-gray-100 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`
              px-4 py-2.5 text-sm font-bold border-b-2 cursor-pointer transition-all
              bg-transparent font-sans whitespace-nowrap flex items-center gap-1.5
              ${tab === t.key
                ? 'border-teal text-teal'
                : 'border-transparent text-gray-400 hover:text-teal-dark'}
            `}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className={`
                text-[0.65rem] px-1.5 py-px rounded-full font-bold
                ${tab === t.key ? 'bg-teal text-white' : 'bg-gray-100 text-gray-500'}
              `}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ═══ Summary Tab ═══ */}
      {tab === 'summary' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Contract Info */}
          <Card>
            <CardHeader title="بيانات العقد" />
            <CardBody>
              <div className="space-y-3">
                <InfoRow label="رقم العقد"         value={contract.no} />
                <InfoRow label="النوع"             value={contract.type} />
                <InfoRow label="الطرف المتعاقد"    value={contract.party} />
                <InfoRow label="تاريخ البداية"     value={fmtDate(contract.start)} />
                <InfoRow label="تاريخ النهاية"     value={fmtDate(contract.end)} />
                <InfoRow label="المدة"             value={`${contract.duration} شهر`} />
                <InfoRow label="نسبة الحجز"        value={`${contract.retentionPct}%`} />
                <InfoRow label="الحالة">
                  <CustomBadge
                    label={contract.status === 'active' ? 'نشط' : contract.status}
                    variant={contract.status === 'active' ? 'green' : 'gray'}
                  />
                </InfoRow>
              </div>
            </CardBody>
          </Card>

          {/* Financial Summary */}
          <Card>
            <CardHeader title="الملخص المالي" />
            <CardBody>
              <div className="space-y-3">
                <InfoRow label="القيمة الأصلية للعقد" value={fmtCurrency(ceiling?.baseValue)} highlight />

                {ceiling?.hasAmendments && (
                  <>
                    <InfoRow
                      label="إجمالي التعديلات المعتمدة"
                      value={`${ceiling.amendmentsTotal >= 0 ? '+' : ''}${fmtCurrency(ceiling.amendmentsTotal)}`}
                      color={ceiling.amendmentsTotal >= 0 ? 'text-green' : 'text-red'}
                    />
                    <InfoRow label="القيمة الحالية للعقد" value={fmtCurrency(ceiling.ceiling)} highlight />
                  </>
                )}

                {!ceiling?.hasAmendments && (
                  <InfoRow
                    label="السقف المؤقت (10%)"
                    value={fmtCurrency(ceiling?.ceiling)}
                    color="text-orange"
                  />
                )}

                <div className="border-t border-gray-100 pt-3 mt-3">
                  <InfoRow label="إجمالي المصروف" value={fmtCurrency(ceiling?.totalSpent)} />
                  <InfoRow
                    label="المتبقي"
                    value={fmtCurrency(ceiling?.remaining)}
                    color={(ceiling?.remaining ?? 0) < 0 ? 'text-red' : 'text-green'}
                    highlight
                  />
                </div>

                {/* Progress bar */}
                <div className="mt-2">
                  <div className="flex justify-between text-[0.73rem] text-gray-600 mb-1">
                    <span>نسبة الصرف</span>
                    <span>{spentPct}%</span>
                  </div>
                  <div className="h-[6px] bg-gray-100 rounded-[3px] overflow-hidden">
                    <div
                      className={`h-full rounded-[3px] transition-[width] duration-500 ${
                        spentPct > 100 ? 'bg-red' : spentPct > 90 ? 'bg-orange' : 'bg-gradient-to-l from-teal to-teal-light'
                      }`}
                      style={{ width: `${Math.min(spentPct, 100)}%` }}
                    />
                  </div>
                </div>

                {isProvisionalZone && (
                  <div className="mt-3 p-2.5 bg-orange-light border border-orange/20 rounded-sm text-xs text-orange font-bold">
                    تجاوز ضمن النطاق المؤقت المسموح (10%) — يتطلب تعديل عقد رسمي
                  </div>
                )}
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      {/* ═══ BOQ Items Tab (التقارير / أعمال التصاميم) ═══ */}
      {tab === 'boq_items' && (
        <BOQItemsTab boqTemplates={boqTemplates} contractValue={contract.value} />
      )}

      {/* ═══ Staff Items Tab (القوى العاملة / مهام الإشراف) ═══ */}
      {tab === 'staff_items' && (
        <StaffItemsTab staffTemplates={staffTemplates} contractValue={contract.value} />
      )}

      {/* ═══ Amendments Tab ═══ */}
      {tab === 'amendments' && (
        <AmendmentList
          contractId={id}
          profile={profile}
          onUpdate={loadAll}
        />
      )}

      {/* ═══ Claims Tab ═══ */}
      {tab === 'claims' && (
        <ClaimsTab claims={claims} onNavigate={claimId => router.push(`/claims/${claimId}`)} />
      )}
    </>
  );
}

// ─── BOQ Items Tab ────────────────────────────────────────────────

function BOQItemsTab({
  boqTemplates,
  contractValue,
}: {
  boqTemplates: BOQTemplateRow[];
  contractValue: number;
}) {
  const totalBOQValue = boqTemplates.reduce((sum, r) => sum + (r.total_value || 0), 0);

  if (boqTemplates.length === 0) {
    return (
      <Card>
        <CardBody>
          <div className="text-center py-12 text-gray-400">
            <p className="text-2xl mb-2">📋</p>
            <p className="text-sm font-bold">لا توجد بنود مضافة لهذا العقد</p>
            <p className="text-xs mt-1">يمكن إضافة البنود من إعدادات العقد</p>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {/* KPI bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm" style={{ borderRightColor: '#045859', borderRightWidth: 3 }}>
          <div className="text-[0.68rem] text-gray-500 font-bold">عدد البنود</div>
          <div className="text-xl font-bold text-[#045859]">{boqTemplates.length}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm" style={{ borderRightColor: '#87BA26', borderRightWidth: 3 }}>
          <div className="text-[0.68rem] text-gray-500 font-bold">إجمالي قيمة البنود</div>
          <div className="text-base font-bold text-[#87BA26]">{fmtCurrency(totalBOQValue)}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm" style={{ borderRightColor: '#00A79D', borderRightWidth: 3 }}>
          <div className="text-[0.68rem] text-gray-500 font-bold">نسبة من قيمة العقد</div>
          <div className="text-base font-bold text-[#00A79D]">
            {contractValue > 0 ? `${Math.round((totalBOQValue / contractValue) * 100)}%` : '—'}
          </div>
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardHeader title={`بنود العقد (${boqTemplates.length})`} />
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr style={{ background: '#045859' }}>
                  <th className="text-right px-3 py-2.5 text-[0.72rem] font-bold text-white w-16">رقم البند</th>
                  <th className="text-right px-3 py-2.5 text-[0.72rem] font-bold text-white">وصف البند</th>
                  <th className="text-right px-3 py-2.5 text-[0.72rem] font-bold text-white w-20">الوحدة</th>
                  <th className="text-right px-3 py-2.5 text-[0.72rem] font-bold text-white w-32">سعر الوحدة</th>
                  <th className="text-right px-3 py-2.5 text-[0.72rem] font-bold text-white w-28">الكمية التعاقدية</th>
                  <th className="text-right px-3 py-2.5 text-[0.72rem] font-bold text-white w-36">القيمة الإجمالية</th>
                </tr>
              </thead>
              <tbody>
                {boqTemplates.map((row, idx) => (
                  <tr
                    key={row.id}
                    className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}
                  >
                    <td className="px-3 py-[10px] text-[0.78rem] border-b border-gray-100 font-bold text-teal text-center">
                      {row.item_no}
                    </td>
                    <td className="px-3 py-[10px] text-[0.78rem] border-b border-gray-100">
                      {row.description_ar || row.description || '—'}
                    </td>
                    <td className="px-3 py-[10px] text-[0.78rem] border-b border-gray-100 text-gray-500">
                      {row.unit || '—'}
                    </td>
                    <td className="px-3 py-[10px] text-[0.8rem] border-b border-gray-100 font-bold">
                      {fmtCurrency(parseFloat(row.unit_price))}
                    </td>
                    <td className="px-3 py-[10px] text-[0.8rem] border-b border-gray-100 text-center">
                      {parseFloat(row.contractual_qty).toLocaleString('ar-SA')}
                    </td>
                    <td className="px-3 py-[10px] text-[0.8rem] border-b border-gray-100 font-bold text-teal">
                      {fmtCurrency(row.total_value || 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
              {/* Totals footer */}
              <tfoot>
                <tr style={{ background: '#E8F4F4' }}>
                  <td colSpan={4} className="px-3 py-2.5 text-[0.78rem] font-bold text-teal-dark text-right">
                    الإجمالي
                  </td>
                  <td className="px-3 py-2.5 text-[0.78rem] font-bold text-teal-dark text-center">—</td>
                  <td className="px-3 py-2.5 text-[0.85rem] font-bold text-teal">
                    {fmtCurrency(totalBOQValue)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

// ─── Staff Items Tab (القوى العاملة / مهام الإشراف) ──────────────

function StaffItemsTab({
  staffTemplates,
  contractValue,
}: {
  staffTemplates: StaffTemplateRow[];
  contractValue:  number;
}) {
  const totalStaffValue    = staffTemplates.reduce((s, r) => s + r.total_value, 0);
  const totalOvertimeHours = 0; // placeholder — overtime hours tracked at claim level
  // Grand overtime budget example: sum of max possible overtime per position
  // (monthly_rate / 192 × 1.5) × estimated 20 hrs/month × contract_months
  const estimatedOvertimeBudget = staffTemplates.reduce(
    (s, r) => s + r.overtime_rate * 20 * r.contract_months, 0
  );

  if (staffTemplates.length === 0) {
    return (
      <Card>
        <CardBody>
          <div className="text-center py-12 text-gray-400">
            <p className="text-2xl mb-2">👥</p>
            <p className="text-sm font-bold">لا توجد بنود قوى عاملة لهذا العقد</p>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {/* KPI bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm" style={{ borderRightColor: '#045859', borderRightWidth: 3 }}>
          <div className="text-[0.68rem] text-gray-500 font-bold">عدد الوظائف</div>
          <div className="text-xl font-bold text-[#045859]">{staffTemplates.length}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm" style={{ borderRightColor: '#87BA26', borderRightWidth: 3 }}>
          <div className="text-[0.68rem] text-gray-500 font-bold">إجمالي القوى العاملة</div>
          <div className="text-sm font-bold text-[#87BA26]">{fmtCurrency(totalStaffValue)}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm" style={{ borderRightColor: '#502C7C', borderRightWidth: 3 }}>
          <div className="text-[0.68rem] text-gray-500 font-bold">مدة التعاقد (أشهر)</div>
          <div className="text-xl font-bold text-[#502C7C]">
            {staffTemplates[0]?.contract_months ?? '—'}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm" style={{ borderRightColor: '#C05728', borderRightWidth: 3 }}>
          <div className="text-[0.68rem] text-gray-500 font-bold">ميزانية ساعات إضافية تقديرية</div>
          <div className="text-sm font-bold text-[#C05728]">{fmtCurrency(estimatedOvertimeBudget)}</div>
          <div className="text-[0.6rem] text-gray-400 mt-0.5">(20 ساعة/شهر — تقديري)</div>
        </div>
      </div>

      {/* Staff table */}
      <Card>
        <CardHeader title={`بنود القوى العاملة — مهام الإشراف (${staffTemplates.length})`} />
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr style={{ background: '#045859' }}>
                  <th className="text-right px-3 py-2.5 text-[0.72rem] font-bold text-white w-12">#</th>
                  <th className="text-right px-3 py-2.5 text-[0.72rem] font-bold text-white">المنصب / الوظيفة</th>
                  <th className="text-right px-3 py-2.5 text-[0.72rem] font-bold text-white w-32">الراتب الشهري</th>
                  <th className="text-right px-3 py-2.5 text-[0.72rem] font-bold text-white w-24">المدة (شهر)</th>
                  <th className="text-right px-3 py-2.5 text-[0.72rem] font-bold text-white w-36">إجمالي القيمة</th>
                  <th className="text-right px-3 py-2.5 text-[0.72rem] font-bold text-white w-36">سعر ساعة إضافية</th>
                </tr>
              </thead>
              <tbody>
                {staffTemplates.map((row, idx) => (
                  <tr
                    key={row.id}
                    className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}
                  >
                    <td className="px-3 py-[10px] text-[0.78rem] border-b border-gray-100 font-bold text-teal text-center">
                      {row.item_no}
                    </td>
                    <td className="px-3 py-[10px] text-[0.78rem] border-b border-gray-100">
                      <div className="font-bold">{row.position_ar || row.position || '—'}</div>
                      {row.position && row.position_ar && (
                        <div className="text-[0.65rem] text-gray-400 mt-0.5">{row.position}</div>
                      )}
                    </td>
                    <td className="px-3 py-[10px] text-[0.8rem] border-b border-gray-100 font-bold">
                      {fmtCurrency(row.monthly_rate)}
                    </td>
                    <td className="px-3 py-[10px] text-[0.8rem] border-b border-gray-100 text-center font-bold text-purple">
                      {row.contract_months}
                    </td>
                    <td className="px-3 py-[10px] text-[0.8rem] border-b border-gray-100 font-bold text-teal">
                      {fmtCurrency(row.total_value)}
                    </td>
                    <td className="px-3 py-[10px] text-[0.78rem] border-b border-gray-100">
                      <span className="font-bold text-orange">{fmtCurrency(row.overtime_rate)}</span>
                      <span className="text-gray-400 text-[0.65rem] mr-1">/ساعة</span>
                      <div className="text-[0.6rem] text-gray-400 mt-0.5">(الراتب ÷ 192 × 1.5)</div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: '#E8F4F4' }}>
                  <td colSpan={4} className="px-3 py-2.5 text-[0.78rem] font-bold text-teal-dark text-right">
                    الإجمالي
                  </td>
                  <td className="px-3 py-2.5 text-[0.85rem] font-bold text-teal">
                    {fmtCurrency(totalStaffValue)}
                  </td>
                  <td className="px-3 py-2.5 text-[0.72rem] text-gray-400 font-bold">
                    —
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="px-4 py-2.5 border-t border-gray-100 bg-orange-light/30">
            <p className="text-[0.7rem] text-orange font-bold">
              📌 سعر الساعة الإضافية = الراتب الشهري ÷ 192 ساعة × 1.5 — يُطبق عند إدخال ساعات العمل الإضافية في المستخلص
            </p>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

// ─── Claims Tab ───────────────────────────────────────────────────

function ClaimsTab({
  claims,
  onNavigate,
}: {
  claims: ClaimView[];
  onNavigate: (claimId: string) => void;
}) {
  // Calculate totals
  const totalApproved = claims
    .filter(c => c.status === 'approved')
    .reduce((sum, c) => sum + c.total, 0);

  const totalPending = claims
    .filter(c => !['draft', 'approved', 'rejected'].includes(c.status))
    .reduce((sum, c) => sum + c.total, 0);

  return (
    <div className="space-y-3">
      {/* KPI row */}
      {claims.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm" style={{ borderRightColor: '#045859', borderRightWidth: 3 }}>
            <div className="text-[0.68rem] text-gray-500 font-bold">إجمالي المطالبات</div>
            <div className="text-xl font-bold text-[#045859]">{claims.length}</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm" style={{ borderRightColor: '#87BA26', borderRightWidth: 3 }}>
            <div className="text-[0.68rem] text-gray-500 font-bold">إجمالي المعتمد</div>
            <div className="text-sm font-bold text-[#87BA26]">{fmtCurrency(totalApproved)}</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm" style={{ borderRightColor: '#FFC845', borderRightWidth: 3 }}>
            <div className="text-[0.68rem] text-gray-500 font-bold">قيد المراجعة</div>
            <div className="text-sm font-bold text-[#C05728]">{fmtCurrency(totalPending)}</div>
          </div>
        </div>
      )}

      <Card>
        <CardHeader title={`المطالبات المالية (${claims.length})`} />
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr style={{ background: '#045859' }}>
                  <th className="text-right px-3 py-2.5 text-[0.72rem] font-bold text-white w-14">#</th>
                  <th className="text-right px-3 py-2.5 text-[0.72rem] font-bold text-white">المرجع</th>
                  <th className="text-right px-3 py-2.5 text-[0.72rem] font-bold text-white">الفترة</th>
                  <th className="text-right px-3 py-2.5 text-[0.72rem] font-bold text-white">المبلغ الإجمالي</th>
                  <th className="text-right px-3 py-2.5 text-[0.72rem] font-bold text-white">الحالة</th>
                  <th className="px-3 py-2.5 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {claims.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-sm text-gray-400">
                      لا توجد مطالبات لهذا العقد
                    </td>
                  </tr>
                ) : (
                  claims.map(c => (
                    <tr
                      key={c.id}
                      onClick={() => onNavigate(c.id)}
                      className="hover:bg-teal-ultra cursor-pointer transition-colors"
                    >
                      <td className="px-3 py-[11px] text-[0.8rem] border-b border-gray-100 font-bold text-teal">
                        #{c.no}
                      </td>
                      <td className="px-3 py-[11px] text-[0.75rem] border-b border-gray-100 text-gray-500">
                        {c.ref || '—'}
                      </td>
                      <td className="px-3 py-[11px] text-[0.75rem] border-b border-gray-100">
                        {c.from && c.to
                          ? `${fmtDate(c.from)} — ${fmtDate(c.to)}`
                          : fmtDate(c.date) || '—'}
                      </td>
                      <td className="px-3 py-[11px] text-[0.8rem] border-b border-gray-100 font-bold">
                        {fmtCurrency(c.total)}
                      </td>
                      <td className="px-3 py-[11px] border-b border-gray-100">
                        <Badge status={c.status} />
                      </td>
                      <td className="px-3 py-[11px] border-b border-gray-100">
                        <span className="text-[0.7rem] text-teal font-bold hover:underline">
                          عرض ←
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Click hint */}
          {claims.length > 0 && (
            <div className="px-4 py-2 text-[0.65rem] text-gray-400 border-t border-gray-100">
              اضغط على أي مطالبة لعرض التفاصيل الكاملة والجدول الزمني
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

// ─── Shared InfoRow ───────────────────────────────────────────────

function InfoRow({
  label,
  value,
  children,
  highlight,
  color,
}: {
  label:      string;
  value?:     string;
  children?:  React.ReactNode;
  highlight?: boolean;
  color?:     string;
}) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-gray-400 font-bold">{label}</span>
      {children || (
        <span className={`text-sm ${highlight ? 'font-bold' : ''} ${color || 'text-teal-dark'}`}>
          {value}
        </span>
      )}
    </div>
  );
}
