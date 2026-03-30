'use client';

/**
 * CONVERA — User Create / Edit Modal
 *
 * Supports create (no initialUser) and edit (with initialUser).
 * Fields: full_name_ar, full_name (EN), email, role, phone, organization,
 *         contract_roles (per-contract role assignment).
 *
 * Contract-Role Assignment:
 *  - Each contract can be assigned a role: contractor, supervisor, auditor, reviewer, viewer
 *  - Same user can have different roles on different contracts
 *  - Director sees all contracts globally — no contract assignment needed
 *  - Saved via user_contract_roles table (migration 025+)
 */

import { useState, useEffect } from 'react';
import Button from '@/components/ui/Button';
import { ROLE_LABELS } from '@/lib/constants';
import type { UserRole, ContractRole } from '@/lib/types';
import type { AdminUser, CreateUserInput, UpdateUserInput, ContractRoleAssignment } from '@/services/admin-users';

// ── Role list (display order) ──────────────────────────────────────

const ROLE_OPTIONS: { value: UserRole; labelAr: string; desc: string }[] = [
  { value: 'director',   labelAr: 'مدير الإدارة',  desc: 'صلاحية كاملة — اعتماد نهائي' },
  { value: 'reviewer',   labelAr: 'مراجع',          desc: 'مراجعة المطالبات قبل المدير' },
  { value: 'auditor',    labelAr: 'مدقق',           desc: 'تدقيق فني للمطالبات' },
  { value: 'supervisor', labelAr: 'جهة الإشراف',    desc: 'مراجعة أولى من الاستشاري' },
  { value: 'contractor', labelAr: 'مقاول',          desc: 'تقديم وتتبع المطالبات' },
];

// Contract-scoped roles available for assignment
const CONTRACT_ROLE_OPTIONS: { value: ContractRole; labelAr: string }[] = [
  { value: 'contractor', labelAr: 'مقاول' },
  { value: 'supervisor', labelAr: 'جهة إشراف' },
  { value: 'auditor',    labelAr: 'مدقق' },
  { value: 'reviewer',   labelAr: 'مراجع' },
  { value: 'viewer',     labelAr: 'مطلع فقط' },
];

// Roles that should display the linked contracts selector
const ROLES_WITH_CONTRACT_LINKS: UserRole[] = ['contractor', 'supervisor', 'auditor', 'reviewer'];

// ── Contract item shape ────────────────────────────────────────────

export interface ContractOption {
  id:    string;
  no:    string;
  title: string;
}

// ── Props ──────────────────────────────────────────────────────────

interface Props {
  mode:                'create' | 'edit';
  initialUser?:        AdminUser;
  availableContracts:  ContractOption[];
  onConfirm:           (data: CreateUserInput | UpdateUserInput) => Promise<void>;
  onClose:             () => void;
}

// ── Component ──────────────────────────────────────────────────────

export default function UserFormModal({
  mode,
  initialUser,
  availableContracts,
  onConfirm,
  onClose,
}: Props) {
  const isCreate = mode === 'create';

  const [fullNameAr,    setFullNameAr]    = useState(initialUser?.full_name_ar || '');
  const [fullName,      setFullName]      = useState(initialUser?.full_name    || '');
  const [email,         setEmail]         = useState(initialUser?.email        || '');
  const [role,          setRole]          = useState<UserRole>(initialUser?.role || 'contractor');
  const [phone,         setPhone]         = useState(initialUser?.phone        || '');
  const [organization,  setOrganization]  = useState(initialUser?.organization || '');

  // Contract-role assignments: { contract_id → contract_role }
  const [contractRoles, setContractRoles] = useState<Map<string, ContractRole>>(
    () => {
      const map = new Map<string, ContractRole>();
      // Initialize from new contract_roles if available
      if (initialUser?.contract_roles) {
        for (const cr of initialUser.contract_roles) {
          map.set(cr.contract_id, cr.contract_role);
        }
      }
      // Fall back to legacy linked_contract_ids (assign default role matching user's profile role)
      else if (initialUser?.linked_contract_ids) {
        const defaultRole = userRoleToContractRole(initialUser.role);
        for (const cid of initialUser.linked_contract_ids) {
          map.set(cid, defaultRole);
        }
      }
      return map;
    }
  );

  const [saving,  setSaving]  = useState(false);
  const [errors,  setErrors]  = useState<Record<string, string>>({});

  // When role changes to director, clear contract assignments
  useEffect(() => {
    if (role === 'director') setContractRoles(new Map());
  }, [role]);

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!fullNameAr.trim()) errs.fullNameAr = 'الاسم بالعربية مطلوب';
    if (!fullName.trim())   errs.fullName   = 'الاسم بالإنجليزية مطلوب';
    if (isCreate && !email.trim()) errs.email = 'البريد الإلكتروني مطلوب';
    if (isCreate && email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errs.email = 'البريد الإلكتروني غير صالح';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      // Build contract_roles array from the Map
      const crArray: ContractRoleAssignment[] = [];
      contractRoles.forEach((contractRole, contractId) => {
        crArray.push({ contract_id: contractId, contract_role: contractRole });
      });

      // Also build legacy linked_contract_ids for backward compatibility
      const linkedIds = role === 'director' ? [] : Array.from(contractRoles.keys());

      if (isCreate) {
        await onConfirm({
          email:               email.trim().toLowerCase(),
          full_name:           fullName.trim(),
          full_name_ar:        fullNameAr.trim(),
          role,
          phone:               phone.trim() || undefined,
          organization:        organization.trim() || undefined,
          linked_contract_ids: linkedIds,
          contract_roles:      crArray,
        } as CreateUserInput);
      } else {
        await onConfirm({
          full_name:           fullName.trim(),
          full_name_ar:        fullNameAr.trim(),
          role,
          phone:               phone.trim() || null,
          organization:        organization.trim() || null,
          linked_contract_ids: linkedIds,
          contract_roles:      crArray,
        } as UpdateUserInput);
      }
    } finally {
      setSaving(false);
    }
  };

  // Toggle a contract: if already assigned → remove; if not → add with default role
  const toggleContract = (contractId: string) => {
    setContractRoles(prev => {
      const next = new Map(prev);
      if (next.has(contractId)) {
        next.delete(contractId);
      } else {
        // Default contract role matches the user's profile role
        next.set(contractId, userRoleToContractRole(role));
      }
      return next;
    });
  };

  // Change the role assigned on a specific contract
  const setContractRoleForContract = (contractId: string, newRole: ContractRole) => {
    setContractRoles(prev => {
      const next = new Map(prev);
      next.set(contractId, newRole);
      return next;
    });
  };

  const showContractSelector = ROLES_WITH_CONTRACT_LINKS.includes(role) && availableContracts.length > 0;
  const assignedCount = contractRoles.size;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">

        {/* Header */}
        <div className="bg-[#045859] px-5 py-4 flex items-center justify-between">
          <h2 className="text-white font-bold text-[15px]">
            {isCreate ? '➕ إضافة مستخدم جديد' : '✏️ تعديل بيانات المستخدم'}
          </h2>
          <button
            onClick={onClose}
            className="text-white/60 hover:text-white text-xl leading-none cursor-pointer bg-transparent border-none font-sans"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">

          {/* Name (Arabic) */}
          <Field label="الاسم الكامل (بالعربية)" required error={errors.fullNameAr}>
            <input
              type="text"
              value={fullNameAr}
              onChange={e => setFullNameAr(e.target.value)}
              placeholder="مثال: محمد عبدالله العرفج"
              dir="rtl"
              className={fieldCls(!!errors.fullNameAr)}
            />
          </Field>

          {/* Name (English) */}
          <Field label="الاسم الكامل (بالإنجليزية)" required error={errors.fullName}>
            <input
              type="text"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="e.g. Mohammed Al-Arfaj"
              dir="ltr"
              className={fieldCls(!!errors.fullName)}
            />
          </Field>

          {/* Email — only on create */}
          {isCreate && (
            <Field label="البريد الإلكتروني" required error={errors.email}>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="user@momah.gov.sa"
                dir="ltr"
                className={fieldCls(!!errors.email)}
              />
            </Field>
          )}

          {/* Role */}
          <div>
            <label className="block text-[0.75rem] font-bold text-gray-600 mb-1.5">
              الدور الوظيفي <span className="text-[#C05728]">*</span>
            </label>
            <div className="space-y-2">
              {ROLE_OPTIONS.map(opt => (
                <label
                  key={opt.value}
                  className={`
                    flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-all
                    ${role === opt.value
                      ? 'border-[#045859] bg-[#E8F4F4]'
                      : 'border-gray-200 hover:border-[#045859]/30 bg-white'}
                  `}
                >
                  <input
                    type="radio"
                    name="role"
                    value={opt.value}
                    checked={role === opt.value}
                    onChange={() => setRole(opt.value)}
                    className="accent-[#045859] flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[0.8rem] font-bold text-[#045859]">{opt.labelAr}</div>
                    <div className="text-[0.68rem] text-gray-400">{opt.desc}</div>
                  </div>
                  {role === opt.value && (
                    <span className="text-[#87BA26] text-base flex-shrink-0">✓</span>
                  )}
                </label>
              ))}
            </div>
          </div>

          {/* ── Contract-Role Assignment ──────────────────────────── */}
          {showContractSelector && (
            <div>
              <label className="block text-[0.75rem] font-bold text-gray-600 mb-1.5">
                العقود المرتبطة والأدوار
                <span className="text-gray-400 font-normal mr-1">
                  — {assignedCount === 0 ? 'لم يتم الربط بأي عقد' : `${assignedCount} عقد مرتبط`}
                </span>
              </label>
              <p className="text-[0.67rem] text-gray-400 mb-2">
                حدد العقود التي ينتمي إليها هذا المستخدم واختر دوره في كل عقد.
                يمكن أن يكون للمستخدم دور مختلف في كل عقد.
              </p>

              {/* Select All / Clear buttons */}
              <div className="flex gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => {
                    const defaultCR = userRoleToContractRole(role);
                    const map = new Map<string, ContractRole>();
                    availableContracts.forEach(c => map.set(c.id, defaultCR));
                    setContractRoles(map);
                  }}
                  className="text-[0.68rem] text-teal hover:text-teal-dark font-bold bg-transparent border-none cursor-pointer font-sans underline"
                >
                  تحديد الكل
                </button>
                <span className="text-gray-300 text-xs">|</span>
                <button
                  type="button"
                  onClick={() => setContractRoles(new Map())}
                  className="text-[0.68rem] text-gray-400 hover:text-gray-600 font-bold bg-transparent border-none cursor-pointer font-sans underline"
                >
                  إلغاء الكل
                </button>
              </div>

              {/* Contract rows with role dropdown */}
              <div className="space-y-1.5 max-h-64 overflow-y-auto border border-gray-100 rounded-lg p-2 bg-gray-50">
                {availableContracts.map(c => {
                  const isLinked = contractRoles.has(c.id);
                  const assignedRole = contractRoles.get(c.id);
                  return (
                    <div
                      key={c.id}
                      className={`
                        flex items-center gap-2.5 p-2.5 rounded-lg transition-all
                        ${isLinked
                          ? 'bg-[#E8F4F4] border border-[#045859]/20'
                          : 'bg-white border border-gray-100 hover:border-[#045859]/20'}
                      `}
                    >
                      {/* Checkbox */}
                      <input
                        type="checkbox"
                        checked={isLinked}
                        onChange={() => toggleContract(c.id)}
                        className="accent-[#045859] flex-shrink-0 cursor-pointer"
                      />

                      {/* Contract info */}
                      <div className="flex-1 min-w-0">
                        <div className="text-[0.78rem] font-bold text-[#045859] truncate">
                          {c.title}
                        </div>
                        <div className="text-[0.65rem] text-gray-400">{c.no}</div>
                      </div>

                      {/* Role dropdown (only when linked) */}
                      {isLinked && (
                        <select
                          value={assignedRole || 'contractor'}
                          onChange={e => setContractRoleForContract(c.id, e.target.value as ContractRole)}
                          className="text-[0.72rem] border border-[#045859]/20 rounded-md px-2 py-1.5 bg-white text-[#045859] font-bold focus:outline-none focus:ring-1 focus:ring-[#045859]/30 cursor-pointer"
                          dir="rtl"
                        >
                          {CONTRACT_ROLE_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>
                              {opt.labelAr}
                            </option>
                          ))}
                        </select>
                      )}

                      {isLinked && (
                        <span className="text-[#87BA26] text-sm flex-shrink-0">✓</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Director note */}
          {role === 'director' && (
            <div className="flex items-start gap-2 p-3 bg-[#FFF8E0] border border-[#FFC845]/30 rounded-lg text-[0.72rem]">
              <span>ℹ️</span>
              <p className="text-[#045859]">
                مدير الإدارة يرى جميع العقود تلقائياً بغض النظر عن الربط.
              </p>
            </div>
          )}

          {/* Phone */}
          <Field label="رقم الجوال (اختياري)">
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="05XXXXXXXX"
              dir="ltr"
              className={fieldCls(false)}
            />
          </Field>

          {/* Organization */}
          <Field label="الجهة / الشركة (اختياري)">
            <input
              type="text"
              value={organization}
              onChange={e => setOrganization(e.target.value)}
              placeholder="مثال: شركة الاستشارات الهندسية"
              dir="rtl"
              className={fieldCls(false)}
            />
          </Field>

        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 px-5 py-3.5 flex justify-end gap-2.5 bg-gray-50">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            إلغاء
          </Button>
          <Button variant="teal" onClick={handleSubmit} disabled={saving}>
            {saving
              ? <span className="animate-pulse">جاري الحفظ...</span>
              : isCreate ? 'إنشاء المستخدم' : 'حفظ التغييرات'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Small helpers ──────────────────────────────────────────────────

/** Map a UserRole to the most likely ContractRole default */
function userRoleToContractRole(role: UserRole): ContractRole {
  const map: Record<string, ContractRole> = {
    contractor: 'contractor',
    consultant: 'supervisor',
    supervisor: 'supervisor',
    admin:      'auditor',
    auditor:    'auditor',
    reviewer:   'reviewer',
    director:   'viewer',
  };
  return map[role] || 'viewer';
}

function fieldCls(hasError: boolean) {
  return [
    'w-full text-sm border rounded-lg px-3 py-2 bg-white font-sans',
    'focus:outline-none focus:ring-2 focus:ring-[#045859]/30',
    hasError ? 'border-[#C05728]' : 'border-gray-200 focus:border-[#045859]',
  ].join(' ');
}

function Field({ label, required, error, children }: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[0.75rem] font-bold text-gray-600 mb-1">
        {label}
        {required && <span className="text-[#C05728] mr-0.5">*</span>}
      </label>
      {children}
      {error && (
        <p className="text-[0.68rem] text-[#C05728] font-bold mt-1">{error}</p>
      )}
    </div>
  );
}
