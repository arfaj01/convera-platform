'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { getAuthHeaders } from '@/lib/supabase';
import { fmtCurrency } from '@/lib/formatters';
import type { BoqProgressModel, ContractType } from '@/lib/types';

// ─── Constants ────────────────────────────────────────────────────

const CONTRACT_TYPES: { value: ContractType; label: string }[] = [
  { value: 'consultancy',        label: 'استشارات هندسية' },
  { value: 'supervision',        label: 'استشارات هندسية اشرافية' },
  { value: 'construction',       label: 'مقاولات' },
  { value: 'supply',             label: 'توريد مواد' },
  { value: 'design',             label: 'دراسات وتصاميم' },
  { value: 'design_supervision', label: 'دراسات وتصاميم وإشراف' },
  { value: 'maintenance',        label: 'صيانة' },
];

const BOQ_MODELS: { value: BoqProgressModel; label: string; hint: string }[] = [
  { value: 'count',            label: 'كميات (عدد)',        hint: 'الدفع حسب الكميات المنجزة فعلياً' },
  { value: 'percentage',       label: 'نسبة مئوية (%)',    hint: 'الدفع حسب نسبة الإنجاز' },
  { value: 'monthly_lump_sum', label: 'مبلغ شهري ثابت',    hint: 'الدفع مبلغ ثابت شهرياً' },
];

// ─── Types ────────────────────────────────────────────────────────

interface BOQItem {
  id:              string;
  item_no:         string;
  description_ar:  string;
  unit:            string;
  unit_price:      number | '';
  contractual_qty: number | '';
  progress_model:  BoqProgressModel;
}

interface StaffItem {
  id:              string;
  position_ar:     string;
  position:        string;
  monthly_rate:    number | '';
  contract_months: number | '';
}

type Step = 1 | 2 | 3 | 4;

// ─── Step indicator ───────────────────────────────────────────────

const STEPS = [
  { n: 1, label: 'البيانات الأساسية' },
  { n: 2, label: 'بنود العقد (BOQ)' },
  { n: 3, label: 'القوى العاملة' },
  { n: 4, label: 'المراجعة والإنشاء' },
];

function StepBar({ current }: { current: Step }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {STEPS.map((s, idx) => (
        <div key={s.n} className="flex items-center flex-1 last:flex-none">
          <div className="flex flex-col items-center">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black transition-all ${
              current === s.n   ? 'bg-teal text-white shadow-[0_0_0_3px_rgba(4,88,89,.2)]' :
              current >  s.n   ? 'bg-lime text-white' :
                                  'bg-gray-100 text-gray-400'
            }`}>
              {current > s.n ? '✓' : s.n}
            </div>
            <span className={`text-[0.65rem] mt-1 font-bold whitespace-nowrap ${
              current === s.n ? 'text-teal' : current > s.n ? 'text-lime' : 'text-gray-400'
            }`}>
              {s.label}
            </span>
          </div>
          {idx < STEPS.length - 1 && (
            <div className={`flex-1 h-[2px] mx-1 mt-[-10px] rounded-full transition-all ${
              current > s.n ? 'bg-lime' : 'bg-gray-100'
            }`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Form field helpers ───────────────────────────────────────────


const inputCls = 'w-full px-3.5 py-2.5 border border-gray-200 rounded-lg text-sm bg-white text-right transition-all focus:outline-none focus:border-teal focus:shadow-[0_0_0_3px_rgba(4,88,89,.1)]';
const selectCls = inputCls + ' cursor-pointer';

// ─── BOQ Row ──────────────────────────────────────────────────────

function BOQRow({ row, idx, progressModel, onChange, onRemove }: {
  row: BOQItem; idx: number; progressModel: BoqProgressModel;
  onChange: (id: string, field: keyof BOQItem, val: string | number) => void;
  onRemove: (id: string) => void;
}) {
  const price = typeof row.unit_price      === 'number' ? row.unit_price      : 0;
  const qty   = typeof row.contractual_qty === 'number' ? row.contractual_qty : 0;
  const total = price * qty;

  return (
    <tr className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}>
      <td className="px-2 py-1.5 border-b border-gray-100 text-center">
        <input
          value={row.item_no}
          onChange={e => onChange(row.id, 'item_no', e.target.value)}
          className="w-12 px-2 py-1.5 border border-gray-200 rounded text-xs text-center focus:outline-none focus:border-teal"
          placeholder="1"
        />
      </td>
      <td className="px-2 py-1.5 border-b border-gray-100">
        <input
          value={row.description_ar}
          onChange={e => onChange(row.id, 'description_ar', e.target.value)}
          className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs text-right focus:outline-none focus:border-teal"
          placeholder="وصف البند"
        />
      </td>
      <td className="px-2 py-1.5 border-b border-gray-100">
        <input
          value={row.unit}
          onChange={e => onChange(row.id, 'unit', e.target.value)}
          className="w-16 px-2 py-1.5 border border-gray-200 rounded text-xs text-center focus:outline-none focus:border-teal"
          placeholder="م²"
        />
      </td>
      <td className="px-2 py-1.5 border-b border-gray-100">
        <input
          type="number"
          value={row.unit_price}
          min={0}
          onChange={e => onChange(row.id, 'unit_price', parseFloat(e.target.value) || 0)}
          className="w-24 px-2 py-1.5 border border-gray-200 rounded text-xs text-left focus:outline-none focus:border-teal"
          placeholder="0"
        />
      </td>
      <td className="px-2 py-1.5 border-b border-gray-100">
        <input
          type="number"
          value={row.contractual_qty}
          min={0}
          onChange={e => onChange(row.id, 'contractual_qty', parseFloat(e.target.value) || 0)}
          className="w-20 px-2 py-1.5 border border-gray-200 rounded text-xs text-left focus:outline-none focus:border-teal"
          placeholder="0"
        />
      </td>
      <td className="px-2 py-1.5 border-b border-gray-100 text-xs font-bold text-teal text-left">
        {total > 0 ? fmtCurrency(total) : '—'}
      </td>
      <td className="px-2 py-1.5 border-b border-gray-100 text-center">
        <button
          onClick={() => onRemove(row.id)}
          className="text-red-400 hover:text-red-600 text-sm font-bold transition-colors"
          title="حذف البند"
        >×</button>
      </td>
    </tr>
  );
}

// ─── Staff Row ────────────────────────────────────────────────────

function StaffRow({ row, idx, onChange, onRemove }: {
  row: StaffItem; idx: number;
  onChange: (id: string, field: keyof StaffItem, val: string | number) => void;
  onRemove: (id: string) => void;
}) {
  const rate   = typeof row.monthly_rate    === 'number' ? row.monthly_rate    : 0;
  const months = typeof row.contract_months === 'number' ? row.contract_months : 0;
  const total  = rate * months;
  const ot     = ((rate / 192) * 1.5);

  return (
    <tr className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}>
      <td className="px-2 py-1.5 border-b border-gray-100">
        <input
          value={row.position_ar}
          onChange={e => onChange(row.id, 'position_ar', e.target.value)}
          className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs text-right focus:outline-none focus:border-teal"
          placeholder="مسمى الوظيفة"
        />
      </td>
      <td className="px-2 py-1.5 border-b border-gray-100">
        <input
          type="number"
          value={row.monthly_rate}
          min={0}
          onChange={e => onChange(row.id, 'monthly_rate', parseFloat(e.target.value) || 0)}
          className="w-24 px-2 py-1.5 border border-gray-200 rounded text-xs text-left focus:outline-none focus:border-teal"
          placeholder="0"
        />
      </td>
      <td className="px-2 py-1.5 border-b border-gray-100">
        <input
          type="number"
          value={row.contract_months}
          min={1}
          onChange={e => onChange(row.id, 'contract_months', parseFloat(e.target.value) || 0)}
          className="w-16 px-2 py-1.5 border border-gray-200 rounded text-xs text-center focus:outline-none focus:border-teal"
          placeholder="12"
        />
      </td>
      <td className="px-2 py-1.5 border-b border-gray-100 text-xs text-orange font-bold text-left">
        {rate > 0 ? fmtCurrency(ot) + '/س' : '—'}
      </td>
      <td className="px-2 py-1.5 border-b border-gray-100 text-xs font-bold text-teal text-left">
        {total > 0 ? fmtCurrency(total) : '—'}
      </td>
      <td className="px-2 py-1.5 border-b border-gray-100 text-center">
        <button
          onClick={() => onRemove(row.id)}
          className="text-red-400 hover:text-red-600 text-sm font-bold transition-colors"
        >×</button>
      </td>
    </tr>
  );
}

// ─── uid helper ───────────────────────────────────────────────────

let _uid = 0;
const uid = () => String(++_uid);

// ─── Main Page ────────────────────────────────────────────────────

export default function NewContractPage() {
  const router  = useRouter();
  const { profile } = useAuth();

  // Access guard
  if (profile && !['director', 'admin'].includes(profile.role)) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <p className="text-2xl">🔒</p>
        <p className="text-sm font-bold text-gray-600">غير مصرح — هذه الصفحة للمدير والمشرف فقط</p>
      </div>
    );
  }

  const [step, setStep]     = useState<Step>(1);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});

  // ── Step 1 state ──
  const [contractNo,    setContractNo]    = useState('');
  const [titleAr,       setTitleAr]       = useState('');
  const [contractType,  setContractType]  = useState<ContractType>('consultancy');
  const [partyNameAr,   setPartyNameAr]   = useState('');
  const [startDate,     setStartDate]     = useState('');
  const [endDate,       setEndDate]       = useState('');
  const [baseValue,     setBaseValue]     = useState<number | ''>('');
  const [retentionPct,  setRetentionPct]  = useState<number>(5);
  const [vatRate,       setVatRate]       = useState<number>(15);
  const [progressModel, setProgressModel] = useState<BoqProgressModel>('count');
  const [notes,         setNotes]         = useState('');
  const [saveAsDraft,   setSaveAsDraft]   = useState(true);

  // ── Step 2 state (BOQ) ──
  const [boqItems, setBoqItems] = useState<BOQItem[]>([]);

  // ── Step 3 state (Staff) ──
  const [staffItems, setStaffItems] = useState<StaffItem[]>([]);

  // ── Computed values ──
  const durationMonths = startDate && endDate ? (() => {
    const s = new Date(startDate), e = new Date(endDate);
    return Math.max(0, Math.round((e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth())));
  })() : 0;

  const boqTotal   = boqItems.reduce((s, r) => s + (Number(r.unit_price) || 0) * (Number(r.contractual_qty) || 0), 0);
  const staffTotal = staffItems.reduce((s, r) => s + (Number(r.monthly_rate) || 0) * (Number(r.contract_months) || 0), 0);
  const netValue   = Number(baseValue) || 0;
  const vatValue   = netValue * (vatRate / 100);
  const grossValue = netValue + vatValue;

  // ── BOQ handlers ──
  const addBOQRow = () => setBoqItems(prev => [...prev, {
    id: uid(), item_no: String(prev.length + 1), description_ar: '', unit: '',
    unit_price: '', contractual_qty: '', progress_model: progressModel,
  }]);

  const updateBOQ = useCallback((id: string, field: keyof BOQItem, val: string | number) => {
    setBoqItems(prev => prev.map(r => r.id === id ? { ...r, [field]: val } : r));
  }, []);

  const removeBOQ = useCallback((id: string) => {
    setBoqItems(prev => prev.filter(r => r.id !== id));
  }, []);

  // ── Staff handlers ──
  const addStaffRow = () => setStaffItems(prev => [...prev, {
    id: uid(), position_ar: '', position: '', monthly_rate: '', contract_months: durationMonths || '',
  }]);

  const updateStaff = useCallback((id: string, field: keyof StaffItem, val: string | number) => {
    setStaffItems(prev => prev.map(r => r.id === id ? { ...r, [field]: val } : r));
  }, []);

  const removeStaff = useCallback((id: string) => {
    setStaffItems(prev => prev.filter(r => r.id !== id));
  }, []);

  // ── Step 1 validation ──
  const validateStep1 = () => {
    const errs: Record<string, string> = {};
    if (!contractNo.trim())   errs.contractNo  = 'رقم العقد مطلوب';
    if (!titleAr.trim())      errs.titleAr     = 'عنوان العقد مطلوب';
    if (!partyNameAr.trim())  errs.partyNameAr = 'اسم الطرف المتعاقد مطلوب';
    if (!startDate)           errs.startDate   = 'تاريخ البداية مطلوب';
    if (!endDate)             errs.endDate     = 'تاريخ النهاية مطلوب';
    if (startDate && endDate && new Date(endDate) <= new Date(startDate))
      errs.endDate = 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية';
    if (!baseValue || Number(baseValue) <= 0)
      errs.baseValue = 'قيمة العقد يجب أن تكون أكبر من صفر';
    setFieldErr(errs);
    return Object.keys(errs).length === 0;
  };

  const nextStep = () => {
    if (step === 1 && !validateStep1()) return;
    setStep(s => Math.min(4, s + 1) as Step);
    window.scrollTo(0, 0);
  };
  const prevStep = () => {
    setStep(s => Math.max(1, s - 1) as Step);
    window.scrollTo(0, 0);
  };

  // ── Submit ──
  const handleCreate = async () => {
    if (!validateStep1()) { setStep(1); return; }
    setSaving(true);
    setError('');
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/contracts', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contract_no:        contractNo.trim(),
          title_ar:           titleAr.trim(),
          type:               contractType,
          party_name_ar:      partyNameAr.trim(),
          start_date:         startDate,
          end_date:           endDate,
          base_value:         Number(baseValue),
          retention_pct:      retentionPct,
          vat_rate:           vatRate,
          boq_progress_model: progressModel,
          notes,
          status:             saveAsDraft ? 'draft' : 'active',
          boq_items:          boqItems.map((r, i) => ({
            item_no: r.item_no || String(i + 1),
            description_ar: r.description_ar,
            unit: r.unit,
            unit_price: Number(r.unit_price) || 0,
            contractual_qty: Number(r.contractual_qty) || 0,
            progress_model: r.progress_model,
            sort_order: (i + 1) * 10,
          })),
          staff_items: staffItems.map((s, i) => ({
            position_ar: s.position_ar,
            position: s.position || s.position_ar,
            monthly_rate: Number(s.monthly_rate) || 0,
            contract_months: Number(s.contract_months) || 0,
            sort_order: (i + 1) * 10,
          })),
          linked_user_ids: [],
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'فشل إنشاء العقد');
        return;
      }
      router.push(`/contracts/${json.data.id}`);
    } catch {
      setError('خطأ في الاتصال — يرجى المحاولة مرة أخرى');
    } finally {
      setSaving(false);
    }
  };

  // ─── Render ─────────────────────────────────────────────────────

  return (
    <div className="max-w-4xl mx-auto">
      {/* Page title */}
      <div className="mb-6">
        <button onClick={() => router.back()} className="text-xs text-gray-400 hover:text-teal mb-2 flex items-center gap-1">
          → رجوع إلى العقود
        </button>
        <h1 className="text-xl font-black text-teal-dark">إضافة عقد جديد</h1>
        <p className="text-sm text-gray-400 mt-0.5">أدخل بيانات العقد في الخطوات التالية</p>
      </div>

      <StepBar current={step} />

      {/* ═══ STEP 1 — Basic Info ══════════════════════════════════ */}
      {step === 1 && (
        <div className="space-y-4">
          <SectionCard title="بيانات العقد الأساسية" icon="📋">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

              <Field label="رقم العقد" required error={fieldErr.contractNo}>
                <input
                  value={contractNo}
                  onChange={e => setContractNo(e.target.value)}
                  className={inputCls}
                  placeholder="231001101771"
                  dir="ltr"
                />
              </Field>

              <Field label="نوع العقد" required>
                <select
                  value={contractType}
                  onChange={e => setContractType(e.target.value as ContractType)}
                  className={selectCls}
                >
                  {CONTRACT_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </Field>

              <Field label="عنوان العقد" required error={fieldErr.titleAr} className="sm:col-span-2">
                <input
                  value={titleAr}
                  onChange={e => setTitleAr(e.target.value)}
                  className={inputCls}
                  placeholder="الدراسات والتصاميم والإشراف لمشاريع..."
                />
              </Field>

              <Field label="اسم الطرف المتعاقد / الشركة" required error={fieldErr.partyNameAr} className="sm:col-span-2">
                <input
                  value={partyNameAr}
                  onChange={e => setPartyNameAr(e.target.value)}
                  className={inputCls}
                  placeholder="شركة بيئة للاستشارات الهندسية"
                />
              </Field>

            </div>
          </SectionCard>

          <SectionCard title="التواريخ والمدة" icon="📅">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="تاريخ البداية" required error={fieldErr.startDate}>
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                  className={inputCls} dir="ltr" />
              </Field>
              <Field label="تاريخ النهاية" required error={fieldErr.endDate}>
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                  className={inputCls} dir="ltr" />
              </Field>
              <Field label="المدة (أشهر)" hint="تُحسب تلقائياً">
                <div className={`${inputCls} bg-gray-50 text-teal font-bold cursor-default`}>
                  {durationMonths > 0 ? `${durationMonths} شهر` : '—'}
                </div>
              </Field>
            </div>
          </SectionCard>

          <SectionCard title="القيمة المالية" icon="💰">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="القيمة الأصلية للعقد (ريال)" required error={fieldErr.baseValue}>
                <input
                  type="number" min={0} value={baseValue}
                  onChange={e => setBaseValue(parseFloat(e.target.value) || '')}
                  className={inputCls} dir="ltr" placeholder="0.00"
                />
              </Field>
              <Field label="نسبة الحجز %" hint="الافتراضي 5%">
                <input
                  type="number" min={0} max={50} value={retentionPct}
                  onChange={e => setRetentionPct(parseFloat(e.target.value) || 0)}
                  className={inputCls} dir="ltr"
                />
              </Field>
              <Field label="نسبة ضريبة القيمة المضافة %" hint="الافتراضي 15%">
                <input
                  type="number" min={0} max={30} value={vatRate}
                  onChange={e => setVatRate(parseFloat(e.target.value) || 0)}
                  className={inputCls} dir="ltr"
                />
              </Field>
            </div>

            {/* Live financial summary */}
            {netValue > 0 && (
              <div className="mt-4 p-3 bg-[#E8F4F4] rounded-lg grid grid-cols-3 gap-3 text-center">
                <div>
                  <div className="text-[0.63rem] text-gray-500 font-bold">القيمة الأصلية</div>
                  <div className="text-sm font-black text-teal-dark">{fmtCurrency(netValue)}</div>
                </div>
                <div>
                  <div className="text-[0.63rem] text-gray-500 font-bold">ضريبة القيمة المضافة</div>
                  <div className="text-sm font-black text-teal">{fmtCurrency(vatValue)}</div>
                </div>
                <div>
                  <div className="text-[0.63rem] text-gray-500 font-bold">الإجمالي شامل الضريبة</div>
                  <div className="text-sm font-black text-[#87BA26]">{fmtCurrency(grossValue)}</div>
                </div>
              </div>
            )}
          </SectionCard>

          <SectionCard title="إعدادات البوكيو والملاحظات" icon="⚙️">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="نموذج تقدم الكميات">
                <select value={progressModel}
                  onChange={e => setProgressModel(e.target.value as BoqProgressModel)}
                  className={selectCls}>
                  {BOQ_MODELS.map(m => (
                    <option key={m.value} value={m.value}>{m.label} — {m.hint}</option>
                  ))}
                </select>
              </Field>
              <Field label="حالة العقد عند الإنشاء">
                <select value={saveAsDraft ? 'draft' : 'active'}
                  onChange={e => setSaveAsDraft(e.target.value === 'draft')}
                  className={selectCls}>
                  <option value="draft">مسودة — قيد الإعداد</option>
                  <option value="active">نشط — سارٍ مباشرة</option>
                </select>
              </Field>
              <Field label="ملاحظات" hint="اختياري" className="sm:col-span-2">
                <textarea
                  value={notes} onChange={e => setNotes(e.target.value)}
                  className={inputCls + ' resize-none'} rows={3}
                  placeholder="أي ملاحظات إضافية على العقد..."
                />
              </Field>
            </div>
          </SectionCard>
        </div>
      )}

      {/* ═══ STEP 2 — BOQ Items ═══════════════════════════════════ */}
      {step === 2 && (
        <div className="space-y-4">
          <SectionCard title="بنود العقد (BOQ)" icon="📊"
            subtitle="أضف البنود التعاقدية — يمكن تخطي هذه الخطوة وإضافتها لاحقاً">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr style={{ background: '#045859' }}>
                    <th className="text-right px-2 py-2 text-[0.7rem] font-bold text-white w-14">رقم البند</th>
                    <th className="text-right px-2 py-2 text-[0.7rem] font-bold text-white">وصف البند</th>
                    <th className="text-right px-2 py-2 text-[0.7rem] font-bold text-white w-16">الوحدة</th>
                    <th className="text-right px-2 py-2 text-[0.7rem] font-bold text-white w-28">سعر الوحدة</th>
                    <th className="text-right px-2 py-2 text-[0.7rem] font-bold text-white w-24">الكمية</th>
                    <th className="text-right px-2 py-2 text-[0.7rem] font-bold text-white w-32">الإجمالي</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {boqItems.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-sm text-gray-400">
                        لا توجد بنود — اضغط &quot;إضافة بند&quot; للبدء
                      </td>
                    </tr>
                  ) : (
                    boqItems.map((row, idx) => (
                      <BOQRow key={row.id} row={row} idx={idx}
                        progressModel={progressModel}
                        onChange={updateBOQ} onRemove={removeBOQ} />
                    ))
                  )}
                </tbody>
                {boqItems.length > 0 && (
                  <tfoot>
                    <tr style={{ background: '#E8F4F4' }}>
                      <td colSpan={5} className="px-2 py-2 text-xs font-bold text-teal-dark text-right">الإجمالي</td>
                      <td className="px-2 py-2 text-sm font-black text-teal">{fmtCurrency(boqTotal)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <button onClick={addBOQRow}
              className="mt-3 flex items-center gap-1.5 text-xs font-bold text-teal hover:text-teal-dark transition-colors">
              <span className="text-base leading-none">＋</span> إضافة بند
            </button>
          </SectionCard>
        </div>
      )}

      {/* ═══ STEP 3 — Staff ═══════════════════════════════════════ */}
      {step === 3 && (
        <div className="space-y-4">
          <SectionCard title="القوى العاملة (مهام الإشراف)" icon="👥"
            subtitle="أضف الوظائف والرواتب — يمكن تخطي هذه الخطوة وإضافتها لاحقاً">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr style={{ background: '#045859' }}>
                    <th className="text-right px-2 py-2 text-[0.7rem] font-bold text-white">المنصب / الوظيفة</th>
                    <th className="text-right px-2 py-2 text-[0.7rem] font-bold text-white w-28">الراتب الشهري</th>
                    <th className="text-right px-2 py-2 text-[0.7rem] font-bold text-white w-24">المدة (شهر)</th>
                    <th className="text-right px-2 py-2 text-[0.7rem] font-bold text-white w-28">ساعة إضافية</th>
                    <th className="text-right px-2 py-2 text-[0.7rem] font-bold text-white w-32">الإجمالي</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {staffItems.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-sm text-gray-400">
                        لا توجد وظائف — اضغط &quot;إضافة وظيفة&quot; للبدء
                      </td>
                    </tr>
                  ) : (
                    staffItems.map((row, idx) => (
                      <StaffRow key={row.id} row={row} idx={idx}
                        onChange={updateStaff} onRemove={removeStaff} />
                    ))
                  )}
                </tbody>
                {staffItems.length > 0 && (
                  <tfoot>
                    <tr style={{ background: '#E8F4F4' }}>
                      <td colSpan={4} className="px-2 py-2 text-xs font-bold text-teal-dark text-right">الإجمالي</td>
                      <td className="px-2 py-2 text-sm font-black text-teal">{fmtCurrency(staffTotal)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <button onClick={addStaffRow}
              className="mt-3 flex items-center gap-1.5 text-xs font-bold text-teal hover:text-teal-dark transition-colors">
              <span className="text-base leading-none">＋</span> إضافة وظيفة
            </button>
          </SectionCard>
        </div>
      )}

      {/* ═══ STEP 4 — Review & Create ═════════════════════════════ */}
      {step === 4 && (
        <div className="space-y-4">
          <SectionCard title="مراجعة بيانات العقد" icon="✅">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
              <ReviewRow label="رقم العقد"         value={contractNo} />
              <ReviewRow label="نوع العقد"         value={CONTRACT_TYPES.find(t => t.value === contractType)?.label || contractType} />
              <ReviewRow label="عنوان العقد"       value={titleAr} fullWidth />
              <ReviewRow label="الطرف المتعاقد"    value={partyNameAr} fullWidth />
              <ReviewRow label="تاريخ البداية"     value={startDate} />
              <ReviewRow label="تاريخ النهاية"     value={endDate} />
              <ReviewRow label="المدة"             value={`${durationMonths} شهر`} />
              <ReviewRow label="حالة العقد"        value={saveAsDraft ? 'مسودة' : 'نشط'} />
            </div>
          </SectionCard>

          <SectionCard title="الملخص المالي" icon="💰">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <FinCard label="القيمة الأصلية"         value={fmtCurrency(netValue)}    color="#045859" />
              <FinCard label="ضريبة القيمة المضافة"   value={fmtCurrency(vatValue)}    color="#00A79D" />
              <FinCard label="إجمالي شامل الضريبة"    value={fmtCurrency(grossValue)}  color="#87BA26" />
              <FinCard label="نسبة الحجز"             value={`${retentionPct}%`}       color="#502C7C" />
            </div>
          </SectionCard>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <SectionCard title="بنود العقد (BOQ)" icon="📊">
              {boqItems.length === 0 ? (
                <p className="text-xs text-gray-400">لم تتم إضافة بنود</p>
              ) : (
                <>
                  <p className="text-xs text-gray-500 mb-2">{boqItems.length} بند — إجمالي: <span className="font-bold text-teal">{fmtCurrency(boqTotal)}</span></p>
                  <ul className="space-y-1">
                    {boqItems.slice(0, 5).map(r => (
                      <li key={r.id} className="text-xs text-gray-600 flex justify-between">
                        <span>{r.description_ar || '—'}</span>
                        <span className="font-bold text-teal">{fmtCurrency((Number(r.unit_price)||0)*(Number(r.contractual_qty)||0))}</span>
                      </li>
                    ))}
                    {boqItems.length > 5 && <li className="text-xs text-gray-400">+ {boqItems.length - 5} بنود أخرى</li>}
                  </ul>
                </>
              )}
            </SectionCard>

            <SectionCard title="القوى العاملة" icon="👥">
              {staffItems.length === 0 ? (
                <p className="text-xs text-gray-400">لم تتم إضافة وظائف</p>
              ) : (
                <>
                  <p className="text-xs text-gray-500 mb-2">{staffItems.length} وظيفة — إجمالي: <span className="font-bold text-teal">{fmtCurrency(staffTotal)}</span></p>
                  <ul className="space-y-1">
                    {staffItems.slice(0, 5).map(r => (
                      <li key={r.id} className="text-xs text-gray-600 flex justify-between">
                        <span>{r.position_ar || '—'}</span>
                        <span className="font-bold text-teal">{fmtCurrency((Number(r.monthly_rate)||0)*(Number(r.contract_months)||0))}</span>
                      </li>
                    ))}
                    {staffItems.length > 5 && <li className="text-xs text-gray-400">+ {staffItems.length - 5} وظائف أخرى</li>}
                  </ul>
                </>
              )}
            </SectionCard>
          </div>

          {notes && (
            <SectionCard title="الملاحظات" icon="📝">
              <p className="text-sm text-gray-600">{notes}</p>
            </SectionCard>
          )}

          {error && (
            <div className="p-3 bg-red-50 border-r-4 border-red-500 rounded-lg text-sm text-red-700 font-bold flex gap-2">
              <span>⚠</span> {error}
            </div>
          )}
        </div>
      )}

      {/* ═══ Navigation Buttons ═══════════════════════════════════ */}
      <div className="flex items-center justify-between mt-8 pt-5 border-t border-gray-100">
        <button
          onClick={prevStep}
          disabled={step === 1}
          className="px-5 py-2.5 text-sm font-bold text-gray-500 bg-gray-100 rounded-xl hover:bg-gray-200 disabled:opacity-40 transition-colors"
        >
          → الخطوة السابقة
        </button>

        <div className="flex items-center gap-3">
          {step < 4 ? (
            <>
              <button
                onClick={nextStep}
                className="px-6 py-2.5 text-sm font-bold text-white rounded-xl transition-all hover:-translate-y-px"
                style={{ background: 'linear-gradient(135deg, #045859, #038580)', boxShadow: '0 3px 10px rgba(4,88,89,.25)' }}
              >
                الخطوة التالية ←
              </button>
            </>
          ) : (
            <button
              onClick={handleCreate}
              disabled={saving}
              className="px-8 py-2.5 text-sm font-bold text-white rounded-xl transition-all hover:-translate-y-px disabled:opacity-60"
              style={{ background: saving ? '#666' : 'linear-gradient(135deg, #87BA26, #6a9320)', boxShadow: '0 3px 10px rgba(135,186,38,.30)' }}
            >
              {saving ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin inline-block" />
                  جاري الإنشاء...
                </span>
              ) : (
                `✓ ${saveAsDraft ? 'حفظ كمسودة' : 'إنشاء العقد'}`
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Small components ─────────────────────────────────────────────

function SectionCard({ title, icon, subtitle, children }: {
  title: string; icon?: string; subtitle?: string; children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2" style={{ background: 'linear-gradient(to left, #f9fafb, #f0f7f7)' }}>
        {icon && <span className="text-base">{icon}</span>}
        <div>
          <h3 className="text-sm font-black text-teal-dark">{title}</h3>
          {subtitle && <p className="text-[0.65rem] text-gray-400 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function ReviewRow({ label, value, fullWidth }: { label: string; value: string; fullWidth?: boolean }) {
  return (
    <div className={`flex justify-between items-center py-1.5 border-b border-gray-50 ${fullWidth ? 'sm:col-span-2' : ''}`}>
      <span className="text-xs text-gray-400 font-bold">{label}</span>
      <span className="text-sm font-bold text-teal-dark text-left max-w-[60%] text-right">{value || '—'}</span>
    </div>
  );
}

function FinCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-100 px-3 py-2.5 text-center"
         style={{ borderTopColor: color, borderTopWidth: 3 }}>
      <div className="text-[0.62rem] text-gray-400 font-bold mb-1">{label}</div>
      <div className="text-sm font-black" style={{ color }}>{value}</div>
    </div>
  );
}

function Field({ label, required, error, hint, className, children }: {
  label: string; required?: boolean; error?: string; hint?: string;
  className?: string; children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label className="block text-xs font-bold text-gray-600 mb-1.5">
        {label}{required && <span className="text-red-500 mr-1">*</span>}
      </label>
      {children}
      {hint  && !error && <p className="text-[0.63rem] text-gray-400 mt-1">{hint}</p>}
      {error && <p className="text-[0.65rem] text-red-500 mt-1 font-bold">{error}</p>}
    </div>
  );
}
