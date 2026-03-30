/**
 * POST /api/contracts
 * Create a new contract with BOQ items, staff items, and linked users.
 *
 * Auth: director or admin only (enforced via withAuth guard)
 * Transactional: contract → BOQ → staff → user_contracts → audit_log
 */

import { NextRequest } from 'next/server';
import { withAuth, apiCreated, apiError, writeAuditLog } from '@/lib/api-guard';
import type { ContractType, BoqProgressModel } from '@/lib/types';

// ─── Types ────────────────────────────────────────────────────────

interface BOQItemInput {
  item_no:         string;
  description_ar:  string;
  unit:            string;
  unit_price:      number;
  contractual_qty: number;
  progress_model:  BoqProgressModel;
  sort_order:      number;
}

interface StaffItemInput {
  position_ar:     string;
  position:        string;
  monthly_rate:    number;
  contract_months: number;
  sort_order:      number;
}

interface CreateContractRequest {
  // Section A — Basic Info
  contract_no:          string;
  title_ar:             string;
  type:                 ContractType;
  party_name_ar:        string;
  start_date:           string;
  end_date:             string;
  base_value:           number;
  retention_pct:        number;
  vat_rate:             number;
  boq_progress_model:   BoqProgressModel;
  notes?:               string;
  status:               'draft' | 'active';

  // Section B — BOQ items
  boq_items:   BOQItemInput[];

  // Section C — Staff items
  staff_items: StaffItemInput[];

  // Section D — Linked user IDs
  linked_user_ids: string[];
}

// ─── Validation ───────────────────────────────────────────────────

function validate(body: CreateContractRequest): string | null {
  if (!body.contract_no?.trim())   return 'رقم العقد مطلوب';
  if (!body.title_ar?.trim())      return 'عنوان العقد مطلوب';
  if (!body.type)                  return 'نوع العقد مطلوب';
  if (!body.party_name_ar?.trim()) return 'اسم الطرف المتعاقد مطلوب';
  if (!body.start_date)            return 'تاريخ البداية مطلوب';
  if (!body.end_date)              return 'تاريخ النهاية مطلوب';

  if (new Date(body.end_date) <= new Date(body.start_date))
    return 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية';

  if (!body.base_value || body.base_value <= 0)
    return 'قيمة العقد يجب أن تكون أكبر من صفر';

  if (body.retention_pct < 0 || body.retention_pct > 50)
    return 'نسبة الحجز يجب أن تكون بين 0 و 50%';

  if (body.vat_rate < 0 || body.vat_rate > 30)
    return 'نسبة ضريبة القيمة المضافة يجب أن تكون بين 0 و 30%';

  // BOQ validation
  for (const item of body.boq_items) {
    if (!item.description_ar?.trim()) return 'وصف بند البوكيو مطلوب';
    if (!item.unit?.trim())           return 'وحدة القياس مطلوبة لكل بند';
    if (item.unit_price < 0)          return 'سعر الوحدة لا يمكن أن يكون سالباً';
    if (item.contractual_qty <= 0)    return 'الكمية التعاقدية يجب أن تكون أكبر من صفر';
  }

  // Staff validation
  for (const s of body.staff_items) {
    if (!s.position_ar?.trim())    return 'مسمى الوظيفة مطلوب';
    if (s.monthly_rate <= 0)       return 'الراتب الشهري يجب أن يكون أكبر من صفر';
    if (s.contract_months <= 0)    return 'مدة التعاقد يجب أن تكون أكبر من صفر';
  }

  return null;
}

// ─── POST Handler ─────────────────────────────────────────────────

export const POST = withAuth(
  async (request: NextRequest, ctx) => {
    // 1. Parse & validate body
    const body: CreateContractRequest = await request.json();
    const validationError = validate(body);
    if (validationError) return apiError(validationError);

    const { admin, profile, user } = ctx;

    // 2. Check contract_no uniqueness
    const { data: existing } = await admin
      .from('contracts')
      .select('id')
      .eq('contract_no', body.contract_no.trim())
      .maybeSingle();

    if (existing) {
      return apiError(`رقم العقد "${body.contract_no}" مستخدم مسبقاً — يرجى استخدام رقم مختلف`);
    }

    // 3. Calculate duration in months
    const start = new Date(body.start_date);
    const end   = new Date(body.end_date);
    const duration_months = Math.round(
      (end.getFullYear() - start.getFullYear()) * 12 +
      (end.getMonth()   - start.getMonth()),
    );

    // 4. Insert contract
    const { data: contract, error: contractErr } = await admin
      .from('contracts')
      .insert({
        contract_no:        body.contract_no.trim(),
        title:              body.title_ar.trim(),
        title_ar:           body.title_ar.trim(),
        type:               body.type,
        party_name:         body.party_name_ar.trim(),
        party_name_ar:      body.party_name_ar.trim(),
        status:             body.status || 'draft',
        base_value:         body.base_value,
        retention_pct:      body.retention_pct,
        vat_rate:           body.vat_rate ?? 15,
        boq_progress_model: body.boq_progress_model || 'count',
        start_date:         body.start_date,
        end_date:           body.end_date,
        duration_months,
        notes:              body.notes?.trim() || null,
        director_id:        profile.role === 'director' ? user.id : null,
        admin_id:           profile.role === 'admin'    ? user.id : null,
      })
      .select('id, contract_no')
      .single();

    if (contractErr || !contract) {
      console.error('Contract insert error:', contractErr);
      return apiError('فشل إنشاء العقد — يرجى المحاولة مرة أخرى', 500);
    }

    const contractId = contract.id;

    // 5. Insert BOQ items
    if (body.boq_items.length > 0) {
      const boqRows = body.boq_items.map((item, idx) => ({
        contract_id:     contractId,
        item_no:         item.item_no || String(idx + 1),
        description:     item.description_ar,
        description_ar:  item.description_ar,
        unit:            item.unit,
        unit_price:      item.unit_price,
        contractual_qty: item.contractual_qty,
        progress_model:  item.progress_model || body.boq_progress_model || 'count',
        sort_order:      item.sort_order ?? (idx + 1) * 10,
      }));

      const { error: boqErr } = await admin
        .from('contract_boq_templates')
        .insert(boqRows);

      if (boqErr) {
        await admin.from('contracts').delete().eq('id', contractId);
        console.error('BOQ insert error:', boqErr);
        return apiError('فشل إضافة بنود البوكيو — تم إلغاء إنشاء العقد', 500);
      }
    }

    // 6. Insert staff items
    if (body.staff_items.length > 0) {
      const staffRows = body.staff_items.map((s, idx) => ({
        contract_id:     contractId,
        item_no:         idx + 1,
        position:        s.position || s.position_ar,
        position_ar:     s.position_ar,
        monthly_rate:    s.monthly_rate,
        contract_months: s.contract_months,
        sort_order:      s.sort_order ?? (idx + 1) * 10,
      }));

      const { error: staffErr } = await admin
        .from('contract_staff_templates')
        .insert(staffRows);

      if (staffErr) {
        await admin.from('contract_boq_templates').delete().eq('contract_id', contractId);
        await admin.from('contracts').delete().eq('id', contractId);
        console.error('Staff insert error:', staffErr);
        return apiError('فشل إضافة بنود القوى العاملة — تم إلغاء إنشاء العقد', 500);
      }
    }

    // 7. Link users to contract
    if (body.linked_user_ids?.length > 0) {
      const userContractRows = body.linked_user_ids
        .filter(uid => uid && uid !== user.id)
        .map(uid => ({ contract_id: contractId, user_id: uid }));

      if (userContractRows.length > 0) {
        await admin.from('user_contracts').insert(userContractRows);
        // Non-fatal — don't rollback if user linking fails
      }
    }

    // 8. Audit log via centralized helper
    await writeAuditLog(admin, ctx, {
      tableName:  'contracts',
      recordId:   contractId,
      action:     'CREATE',
      toStatus:   body.status || 'draft',
      newData: {
        contract_no:  body.contract_no,
        title_ar:     body.title_ar,
        type:         body.type,
        base_value:   body.base_value,
        boq_count:    body.boq_items.length,
        staff_count:  body.staff_items.length,
        linked_users: body.linked_user_ids?.length ?? 0,
      },
    });

    return apiCreated({ id: contractId, contract_no: contract.contract_no });
  },
  { roles: ['director', 'admin'] },
);
