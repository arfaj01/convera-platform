/**
 * Centralized Arabic labels and tooltips for DB-style field keys.
 *
 * Use through <FieldRow /> or directly via getLabel(key) / getTooltip(key).
 *
 * Goal: prevent raw column names like `contract_no` or `base_value`
 * from leaking into the user-facing UI, and let designers/PMs update
 * Arabic copy in one place.
 */

export type FieldGroup =
  | 'contract'         // بيانات العقد
  | 'finance'          // البيانات المالية
  | 'claim'            // بيانات المطالبة
  | 'attachment'       // المرفقات
  | 'approval'         // الاعتمادات
  | 'workflow'         // سجل الحركة
  | 'meta';            // (technical metadata)

export interface FieldLabel {
  /** Arabic label shown to the user */
  label: string;
  /** Optional Arabic tooltip explaining the field */
  tooltip?: string;
  /** Group used to bucket fields visually */
  group?: FieldGroup;
}

export const FIELD_LABELS: Record<string, FieldLabel> = {
  // ── Contract identity ──────────────────────────────────────────
  contract_no:        { label: 'رقم العقد',        tooltip: 'الرقم الفريد لتعريف العقد', group: 'contract' },
  title:              { label: 'عنوان العقد',       group: 'contract' },
  title_ar:           { label: 'العنوان (عربي)',    group: 'contract' },
  type:               { label: 'نوع العقد',         tooltip: 'استشاري / إشراف / إنشاء / صيانة', group: 'contract' },
  party_name:         { label: 'اسم المتعاقد',      group: 'contract' },
  party_name_ar:      { label: 'اسم المتعاقد (عربي)', group: 'contract' },
  party_tax_no:       { label: 'الرقم الضريبي',     group: 'contract' },
  region:             { label: 'المنطقة',           group: 'contract' },
  start_date:         { label: 'تاريخ البداية',      group: 'contract' },
  end_date:           { label: 'تاريخ النهاية',      group: 'contract' },
  duration_months:    { label: 'المدة بالأشهر',     group: 'contract' },
  status:             { label: 'الحالة',           group: 'contract' },

  // ── Financial ──────────────────────────────────────────────────
  base_value:         { label: 'القيمة التعاقدية',  tooltip: 'قيمة العقد قبل ضريبة القيمة المضافة', group: 'finance' },
  vat_value:          { label: 'قيمة الضريبة',       tooltip: 'ضريبة القيمة المضافة 15%',  group: 'finance' },
  total_value:        { label: 'القيمة الإجمالية',   tooltip: 'شاملة الضريبة',  group: 'finance' },
  retention_pct:      { label: 'نسبة الضمان (%)',   tooltip: 'النسبة المحجوزة كضمان حسن التنفيذ', group: 'finance' },
  vat_rate:           { label: 'نسبة الضريبة (%)',  group: 'finance' },
  performance_pct:    { label: 'نسبة الأداء (%)',   tooltip: 'نسبة احتساب الإنجاز — افتراضياً 100%', group: 'finance' },

  // ── Claim ──────────────────────────────────────────────────────
  claim_no:           { label: 'رقم المطالبة',      group: 'claim' },
  reference_no:       { label: 'الرقم المرجعي',     tooltip: 'الرقم المرجعي للمطالبة في منصة اعتماد', group: 'claim' },
  claim_type:         { label: 'نوع المطالبة',      group: 'claim' },
  period_from:        { label: 'بداية الفترة',       group: 'claim' },
  period_to:          { label: 'نهاية الفترة',       group: 'claim' },
  invoice_date:       { label: 'تاريخ الفاتورة',     group: 'claim' },
  boq_amount:         { label: 'قيمة بنود الكميات',  group: 'finance' },
  staff_amount:       { label: 'قيمة الكوادر',       group: 'finance' },
  gross_amount:       { label: 'القيمة قبل الضمان',  tooltip: 'مجموع بنود BOQ والكوادر قبل الخصومات',  group: 'finance' },
  retention_amount:   { label: 'قيمة الضمان',         tooltip: 'المبلغ المحجوز كضمان حسن التنفيذ',  group: 'finance' },
  net_amount:         { label: 'الصافي بعد الضمان',  group: 'finance' },
  vat_amount:         { label: 'قيمة الضريبة',        group: 'finance' },
  total_amount:       { label: 'إجمالي المطالبة',    group: 'finance' },

  // BOQ / Staff items (per-row)
  item_no:            { label: 'رقم البند',          group: 'claim' },
  description:        { label: 'الوصف',             group: 'claim' },
  description_ar:     { label: 'الوصف (عربي)',      group: 'claim' },
  unit:               { label: 'الوحدة',            group: 'claim' },
  unit_price:         { label: 'سعر الوحدة',        group: 'finance' },
  contractual_qty:    { label: 'الكمية التعاقدية',   group: 'claim' },
  prev_progress:      { label: 'الكمية السابقة',     tooltip: 'الكميات المُنجَزة في المطالبات السابقة', group: 'claim' },
  curr_progress:      { label: 'الكمية الحالية',     tooltip: 'كمية هذه الفترة', group: 'claim' },
  period_amount:      { label: 'قيمة الفترة',        group: 'finance' },
  cumulative:         { label: 'التراكمي',           group: 'claim' },
  position:           { label: 'المسمى الوظيفي',     group: 'claim' },
  position_ar:        { label: 'المسمى (عربي)',     group: 'claim' },
  monthly_rate:       { label: 'الراتب الشهري',      group: 'finance' },
  contract_months:    { label: 'مدة العقد بالأشهر',  group: 'contract' },
  working_days:       { label: 'أيام العمل',         group: 'claim' },
  overtime_hours:     { label: 'ساعات العمل الإضافي', group: 'claim' },

  // ── Attachments ────────────────────────────────────────────────
  file_name:          { label: 'اسم الملف',         group: 'attachment' },
  file_size:          { label: 'حجم الملف',         group: 'attachment' },
  document_type:      { label: 'نوع المستند',       group: 'attachment' },
  storage_path:       { label: 'موقع الحفظ',        group: 'attachment' },

  // ── Workflow / approval ────────────────────────────────────────
  submitted_by:       { label: 'قدّمها',           group: 'workflow' },
  submitted_at:       { label: 'تاريخ التقديم',      group: 'workflow' },
  reviewed_by:        { label: 'راجعها',            group: 'workflow' },
  reviewed_at:        { label: 'تاريخ المراجعة',     group: 'workflow' },
  approved_by:        { label: 'اعتمدها',           group: 'approval' },
  approved_at:        { label: 'تاريخ الاعتماد',     group: 'approval' },
  return_reason:      { label: 'سبب الإرجاع',       group: 'workflow' },
  rejection_reason:   { label: 'سبب الرفض',         group: 'workflow' },
  action:             { label: 'الإجراء',           group: 'workflow' },
  from_status:        { label: 'الحالة السابقة',     group: 'workflow' },
  to_status:          { label: 'الحالة الجديدة',     group: 'workflow' },
  notes:              { label: 'ملاحظات',          group: 'workflow' },

  // ── Meta ───────────────────────────────────────────────────────
  created_at:         { label: 'تاريخ الإنشاء',      group: 'meta' },
  updated_at:         { label: 'آخر تحديث',         group: 'meta' },
  created_by:         { label: 'أنشأها',           group: 'meta' },
};

export const FIELD_GROUP_LABELS: Record<FieldGroup, string> = {
  contract:    'بيانات العقد',
  finance:     'البيانات المالية',
  claim:       'بيانات المطالبة',
  attachment:  'المرفقات',
  approval:    'الاعتمادات',
  workflow:    'سجل الحركة',
  meta:        'البيانات الإدارية',
};

export function getLabel(fieldKey: string): string {
  return FIELD_LABELS[fieldKey]?.label ?? fieldKey;
}

export function getTooltip(fieldKey: string): string | undefined {
  return FIELD_LABELS[fieldKey]?.tooltip;
}

export function getGroup(fieldKey: string): FieldGroup | undefined {
  return FIELD_LABELS[fieldKey]?.group;
}
