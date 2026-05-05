'use client';

/**
 * CONVERA — User Management & Permissions Page
 * Route: /users
 *
 * Director-only. Lists all system users, allows create/edit/activate/
 * deactivate, role assignment, and password reset.
 * All mutations go through /api/admin/users/* API routes (server-side auth).
 */

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import UsersTable   from '@/components/users/UsersTable';
import UserFormModal from '@/components/users/UserFormModal';
import type { ContractOption } from '@/components/users/UserFormModal';
import Button from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import {
  adminFetchUsers,
  adminCreateUser,
  adminUpdateUser,
  adminActivateUser,
  adminDeactivateUser,
  adminResetPassword,
} from '@/services/admin-users';
import type { AdminUser, CreateUserInput, UpdateUserInput } from '@/services/admin-users';
import { getUserLinkedContractIds } from '@/services/user-contracts';
import { fetchContracts } from '@/services/contracts';
import type { ContractRoleAssignment } from '@/services/admin-users';

// ── Types ─────────────────────────────────────────────────────────

type ModalState =
  | { type: 'closed' }
  | { type: 'create' }
  | { type: 'edit'; user: AdminUser }
  | { type: 'confirmToggle'; user: AdminUser }
  | { type: 'confirmReset'; user: AdminUser };

// ── Component ─────────────────────────────────────────────────────

export default function UsersPage() {
  const { profile, loading: authLoading } = useAuth();
  const router = useRouter();

  const { showToast } = useToast();
  const [users,     setUsers]     = useState<AdminUser[]>([]);
  const [contracts, setContracts] = useState<ContractOption[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [modal,     setModal]     = useState<ModalState>({ type: 'closed' });
  const [actionPending, setActionPending] = useState(false);

  // ── Director-only guard ────────────────────────────────────────

  useEffect(() => {
    if (!authLoading && profile && profile.role !== 'director') {
      router.replace('/dashboard');
    }
  }, [authLoading, profile, router]);

  // ── Load users ─────────────────────────────────────────────────

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch users + contracts in parallel
      const [rawUsers, rawContracts] = await Promise.all([
        adminFetchUsers(),
        fetchContracts().catch(() => []),
      ]);

      // Map contracts to ContractOption shape
      const contractOptions: ContractOption[] = rawContracts.map(c => ({
        id:    c.id,
        no:    c.no,
        title: c.title,
      }));
      setContracts(contractOptions);

      // Enrich each user with their linked contract IDs + contract roles
      const enriched = await Promise.all(
        rawUsers.map(async (u) => {
          // Fetch legacy linked_contract_ids
          const ids = await getUserLinkedContractIds(u.id).catch(() => []);

          // Fetch new contract_roles via admin RPC (if available)
          let contractRoles: ContractRoleAssignment[] = [];
          try {
            const res = await fetch(`/api/admin/users/${u.id}/contract-roles`, {
              headers: await import('@/lib/supabase').then(m => m.getAuthHeaders()),
            });
            if (res.ok) {
              const json = await res.json();
              contractRoles = json.contract_roles || [];
            }
          } catch { /* pre-027: graceful fallback */ }

          return { ...u, linked_contract_ids: ids, contract_roles: contractRoles };
        })
      );
      setUsers(enriched);
    } catch (err: unknown) {
      showToast('فشل تحميل قائمة المستخدمين: ' + String(err), 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && profile?.role === 'director') {
      loadUsers();
    }
  }, [authLoading, profile, loadUsers]);

  // ── Handlers ─────────────────────────────────────────────────

  async function handleFormConfirm(data: CreateUserInput | UpdateUserInput) {
    const linkedContractIds: string[] = (data as any).linked_contract_ids || [];

    // IAM-2 (2026-05-05) — wrap the entire flow in try/catch so any
    // failure (Supabase Auth, profiles upsert, contract-role sync,
    // network) surfaces as an Arabic toast instead of silently
    // disappearing into an unhandled promise rejection. The modal
    // is kept open on error so the user can correct and retry; the
    // success path closes the modal and refreshes the list as before.
    try {
      if (modal.type === 'create') {
        // Create user + linked contracts in a single API call (server-side, bypasses RLS)
        const { email, full_name, full_name_ar, role, phone, organization, contract_roles } = data as CreateUserInput;
        await adminCreateUser({
          email, full_name, full_name_ar, role, phone, organization,
          linked_contract_ids: linkedContractIds,
          contract_roles: contract_roles || [],
        });
        showToast('تم إنشاء المستخدم بنجاح — سيصله بريد لتعيين كلمة المرور', 'ok');
      } else if (modal.type === 'edit') {
        const { full_name, full_name_ar, role, phone, organization, is_active, contract_roles } = data as UpdateUserInput;
        // Pass linked_contract_ids + contract_roles to the API route so it syncs via admin client (bypasses RLS).
        // An empty array explicitly means "remove all contracts/roles".
        await adminUpdateUser(modal.user.id, {
          full_name, full_name_ar, role, phone, organization, is_active,
          linked_contract_ids: linkedContractIds,
          contract_roles: contract_roles || [],
        });
        showToast('تم تحديث بيانات المستخدم بنجاح', 'ok');
      }
      setModal({ type: 'closed' });
      await loadUsers();
    } catch (err: unknown) {
      // IAM-2 — surface the API's structured Arabic message in the toast.
      // Field-name fallbacks accommodate every shape the admin routes use
      // today plus the {code, messageAr, details} contract proposed by IAM-6.
      const e = err as {
        messageAr?: string;
        message?: string;
        error?: string | { messageAr?: string; message?: string };
      } | null | undefined;
      const message =
        e?.messageAr
        || (typeof e?.error === 'object' ? e.error?.messageAr : undefined)
        || (typeof e?.error === 'string' ? e.error : undefined)
        || (typeof e?.error === 'object' ? e.error?.message : undefined)
        || e?.message
        || 'فشل حفظ بيانات المستخدم';
      // Re-throwing would propagate to the modal's <Button onClick> handler
      // where React swallows it; surfacing the toast here is the contract.
      showToast(message, 'error');
      // Console-log a non-secret diagnostic snapshot for developer triage.
      // The error object only carries the API response body — no headers,
      // no env values — so this is safe even in production builds.
      // eslint-disable-next-line no-console
      console.warn('[users/page] handleFormConfirm failed:', err);
      // Modal is intentionally NOT closed — the user can correct and retry.
    }
  }

  async function handleToggleActive() {
    if (modal.type !== 'confirmToggle') return;
    const user = modal.user;
    setActionPending(true);
    try {
      if (user.is_active) {
        await adminDeactivateUser(user.id);
        showToast(`تم إيقاف تفعيل حساب ${user.full_name_ar || user.full_name}`, 'ok');
      } else {
        await adminActivateUser(user.id);
        showToast(`تم تفعيل حساب ${user.full_name_ar || user.full_name}`, 'ok');
      }
      setModal({ type: 'closed' });
      await loadUsers();
    } catch (err: unknown) {
      showToast('فشل تحديث حالة المستخدم: ' + String(err), 'error');
    } finally {
      setActionPending(false);
    }
  }

  async function handleResetPassword() {
    if (modal.type !== 'confirmReset') return;
    const user = modal.user;
    setActionPending(true);
    try {
      const msg = await adminResetPassword(user.id, user.email);
      showToast(msg || `تم إرسال رابط إعادة تعيين كلمة المرور إلى ${user.email}`, 'ok');
      setModal({ type: 'closed' });
    } catch (err: unknown) {
      showToast('فشل إرسال رابط إعادة تعيين كلمة المرور: ' + String(err), 'error');
    } finally {
      setActionPending(false);
    }
  }

  // ── Auth loading / redirect ────────────────────────────────────

  if (authLoading || !profile) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-2 border-[#045859] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (profile.role !== 'director') return null; // redirect in progress

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-[1280px] mx-auto space-y-5" dir="rtl">

      {/* Page header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-[#045859]">إدارة المستخدمين والصلاحيات</h1>
          <p className="text-[0.78rem] text-gray-500 mt-0.5">
            إدارة حسابات المستخدمين وأدوارهم في منصة CONVERA
          </p>
        </div>

        <Button
          variant="teal"
          onClick={() => setModal({ type: 'create' })}
        >
          ➕ إضافة مستخدم جديد
        </Button>
      </div>

      {/* Summary cards */}
      <SummaryCards users={users} loading={loading} />

      {/* Users table */}
      <UsersTable
        users={users}
        loading={loading}
        onEdit={user => setModal({ type: 'edit', user })}
        onToggleActive={user => setModal({ type: 'confirmToggle', user })}
        onResetPwd={user => setModal({ type: 'confirmReset', user })}
      />

      {/* ── Modals ─────────────────────────────────────────────── */}

      {/* Create / Edit */}
      {(modal.type === 'create' || modal.type === 'edit') && (
        <UserFormModal
          mode={modal.type === 'create' ? 'create' : 'edit'}
          initialUser={modal.type === 'edit' ? modal.user : undefined}
          availableContracts={contracts}
          onConfirm={handleFormConfirm}
          onClose={() => setModal({ type: 'closed' })}
        />
      )}

      {/* Confirm toggle active */}
      {modal.type === 'confirmToggle' && (
        <ConfirmModal
          title={modal.user.is_active ? 'إيقاف تفعيل الحساب' : 'تفعيل الحساب'}
          message={
            modal.user.is_active
              ? `هل أنت متأكد من إيقاف تفعيل حساب ${modal.user.full_name_ar || modal.user.full_name}؟ لن يتمكن من تسجيل الدخول.`
              : `هل تريد تفعيل حساب ${modal.user.full_name_ar || modal.user.full_name}؟ سيتمكن من تسجيل الدخول.`
          }
          confirmLabel={modal.user.is_active ? 'إيقاف التفعيل' : 'تفعيل الحساب'}
          confirmVariant={modal.user.is_active ? 'red' : 'teal'}
          pending={actionPending}
          onConfirm={handleToggleActive}
          onCancel={() => setModal({ type: 'closed' })}
        />
      )}

      {/* Confirm reset password */}
      {modal.type === 'confirmReset' && (
        <ConfirmModal
          title="إعادة تعيين كلمة المرور"
          message={`سيتم إرسال رابط إعادة تعيين كلمة المرور إلى: ${modal.user.email}\n\nهل تريد المتابعة؟`}
          confirmLabel="إرسال الرابط"
          confirmVariant="teal"
          pending={actionPending}
          onConfirm={handleResetPassword}
          onCancel={() => setModal({ type: 'closed' })}
        />
      )}

    </div>
  );
}

// ── Summary cards ─────────────────────────────────────────────────

function SummaryCards({ users, loading }: { users: AdminUser[]; loading: boolean }) {
  if (loading) return null;

  const total    = users.length;
  const active   = users.filter(u => u.is_active).length;
  const inactive = users.filter(u => !u.is_active).length;

  const byRole = {
    director:   users.filter(u => u.role === 'director').length,
    reviewer:   users.filter(u => u.role === 'reviewer').length,
    auditor:    users.filter(u => u.role === 'auditor').length,
    supervisor: users.filter(u => u.role === 'supervisor').length,
    contractor: users.filter(u => u.role === 'contractor').length,
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      <SummaryCard label="إجمالي المستخدمين" value={total}    color="#045859" />
      <SummaryCard label="مفعّلون"            value={active}   color="#87BA26" />
      <SummaryCard label="موقوفون"            value={inactive} color="#C05728" />
      <SummaryCard label="مدقّقون"            value={byRole.auditor}    color="#00A79D" />
      <SummaryCard label="مراجعون"            value={byRole.reviewer}   color="#502C7C" />
      <SummaryCard label="مقاولون"            value={byRole.contractor} color="#54565B" />
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm flex flex-col gap-1"
      style={{ borderRightColor: color, borderRightWidth: 3 }}
    >
      <span className="text-[0.68rem] text-gray-500 font-bold">{label}</span>
      <span className="text-xl font-bold" style={{ color }}>{value}</span>
    </div>
  );
}

// ── Confirm Modal ─────────────────────────────────────────────────

interface ConfirmModalProps {
  title:         string;
  message:       string;
  confirmLabel:  string;
  confirmVariant: 'teal' | 'red';
  pending:       boolean;
  onConfirm:     () => void;
  onCancel:      () => void;
}

function ConfirmModal({
  title, message, confirmLabel, confirmVariant, pending, onConfirm, onCancel
}: ConfirmModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">

        {/* Header */}
        <div className="bg-[#045859] px-5 py-4 flex items-center justify-between">
          <h2 className="text-white font-bold text-[15px]">{title}</h2>
          <button
            onClick={onCancel}
            className="text-white/60 hover:text-white text-xl leading-none cursor-pointer bg-transparent border-none font-sans"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="p-5">
          <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{message}</p>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 px-5 py-3.5 flex justify-end gap-2.5 bg-gray-50">
          <Button variant="ghost" onClick={onCancel} disabled={pending}>
            إلغاء
          </Button>
          <Button variant={confirmVariant} onClick={onConfirm} disabled={pending}>
            {pending ? <span className="animate-pulse">جاري التنفيذ...</span> : confirmLabel}
          </Button>
        </div>

      </div>
    </div>
  );
}
