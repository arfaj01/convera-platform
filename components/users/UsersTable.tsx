'use client';

/**
 * CONVERA — Users Management Table
 *
 * Displays all system users in a sortable, filterable table.
 * Actions: edit, activate/deactivate, reset password.
 * Director-only component — parent page enforces role guard.
 */

import { useState } from 'react';
import { ROLE_LABELS } from '@/lib/constants';
import type { UserRole } from '@/lib/types';
import type { AdminUser } from '@/services/admin-users';

// ── Role badge styles ─────────────────────────────────────────────

const ROLE_BADGE: Record<UserRole, { bg: string; text: string }> = {
  director:   { bg: '#E8F4F4', text: '#045859' },
  admin:      { bg: '#E0F4F3', text: '#00A79D' },
  reviewer:   { bg: '#F3E5FF', text: '#502C7C' },
  consultant: { bg: '#FFF8E0', text: '#B8860B' },
  contractor: { bg: '#F5F5F5', text: '#54565B' },
  // Legacy aliases
  auditor:    { bg: '#E0F4F3', text: '#00A79D' },
  supervisor: { bg: '#FFF8E0', text: '#B8860B' },
};

// ── Props ─────────────────────────────────────────────────────────

interface Props {
  users:          AdminUser[];
  loading:        boolean;
  onEdit:         (user: AdminUser) => void;
  onToggleActive: (user: AdminUser) => void;
  onResetPwd:     (user: AdminUser) => void;
}

// ── Component ─────────────────────────────────────────────────────

export default function UsersTable({ users, loading, onEdit, onToggleActive, onResetPwd }: Props) {
  const [search,     setSearch]     = useState('');
  const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // ── Filtering ──────────────────────────────────────────────────

  const filtered = users.filter(u => {
    const matchSearch =
      !search.trim() ||
      u.full_name_ar?.toLowerCase().includes(search.toLowerCase()) ||
      u.full_name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      u.organization?.toLowerCase().includes(search.toLowerCase());

    const matchRole   = roleFilter   === 'all' || u.role === roleFilter;
    const matchStatus = statusFilter === 'all' ||
      (statusFilter === 'active'   && u.is_active) ||
      (statusFilter === 'inactive' && !u.is_active);

    return matchSearch && matchRole && matchStatus;
  });

  // ── Empty / Loading states ────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="flex flex-col items-center gap-3 text-gray-400">
          <div className="w-8 h-8 border-2 border-[#045859] border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">جاري تحميل المستخدمين...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* ── Filters bar ────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3 items-center">

        {/* Search */}
        <div className="relative flex-1 min-w-[220px]">
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">
            🔍
          </span>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="بحث بالاسم أو البريد أو الجهة..."
            dir="rtl"
            className="w-full pr-9 pl-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#045859]/30 focus:border-[#045859] font-sans"
          />
        </div>

        {/* Role filter */}
        <select
          value={roleFilter}
          onChange={e => setRoleFilter(e.target.value as UserRole | 'all')}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[#045859]/30 font-sans"
        >
          <option value="all">كل الأدوار</option>
          {(Object.keys(ROLE_LABELS) as UserRole[]).map(r => (
            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
          ))}
        </select>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[#045859]/30 font-sans"
        >
          <option value="all">كل الحالات</option>
          <option value="active">مفعّل</option>
          <option value="inactive">موقوف</option>
        </select>

        {/* Count badge */}
        <span className="text-xs text-gray-500 mr-auto">
          {filtered.length} من {users.length} مستخدم
        </span>
      </div>

      {/* ── Table ──────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" dir="rtl">
            <thead>
              <tr className="bg-[#045859] text-white text-right">
                <th className="px-4 py-3 font-bold text-[0.75rem] whitespace-nowrap">الاسم (عربي)</th>
                <th className="px-4 py-3 font-bold text-[0.75rem] whitespace-nowrap">الاسم (إنجليزي)</th>
                <th className="px-4 py-3 font-bold text-[0.75rem] whitespace-nowrap">البريد الإلكتروني</th>
                <th className="px-4 py-3 font-bold text-[0.75rem] whitespace-nowrap">الدور</th>
                <th className="px-4 py-3 font-bold text-[0.75rem] whitespace-nowrap">الجهة</th>
                <th className="px-4 py-3 font-bold text-[0.75rem] whitespace-nowrap">الجوال</th>
                <th className="px-4 py-3 font-bold text-[0.75rem] whitespace-nowrap">الحالة</th>
                <th className="px-4 py-3 font-bold text-[0.75rem] whitespace-nowrap">تاريخ الإنشاء</th>
                <th className="px-4 py-3 font-bold text-[0.75rem] whitespace-nowrap text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-gray-400 text-sm">
                    {search || roleFilter !== 'all' || statusFilter !== 'all'
                      ? 'لا توجد نتائج مطابقة للبحث'
                      : 'لا يوجد مستخدمون مسجّلون بعد'}
                  </td>
                </tr>
              ) : (
                filtered.map((user, idx) => (
                  <tr
                    key={user.id}
                    className={`hover:bg-[#E8F4F4]/40 transition-colors ${
                      idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'
                    } ${!user.is_active ? 'opacity-60' : ''}`}
                  >
                    {/* Name AR */}
                    <td className="px-4 py-3 font-bold text-[#045859] whitespace-nowrap">
                      {user.full_name_ar || '—'}
                    </td>

                    {/* Name EN */}
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap" dir="ltr">
                      {user.full_name}
                    </td>

                    {/* Email */}
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap" dir="ltr">
                      <span className="font-mono text-xs">{user.email}</span>
                    </td>

                    {/* Role */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <RoleBadge role={user.role} />
                    </td>

                    {/* Organization */}
                    <td className="px-4 py-3 text-gray-600 text-xs max-w-[140px] truncate">
                      {user.organization || <span className="text-gray-300">—</span>}
                    </td>

                    {/* Phone */}
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap" dir="ltr">
                      <span className="text-xs">{user.phone || '—'}</span>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusBadge active={user.is_active} />
                    </td>

                    {/* Created at */}
                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                      {fmtDate(user.created_at)}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center justify-center gap-1.5">

                        {/* Edit */}
                        <ActionBtn
                          title="تعديل البيانات"
                          onClick={() => onEdit(user)}
                          color="teal"
                        >
                          ✏️
                        </ActionBtn>

                        {/* Activate / Deactivate */}
                        <ActionBtn
                          title={user.is_active ? 'إيقاف تفعيل الحساب' : 'تفعيل الحساب'}
                          onClick={() => onToggleActive(user)}
                          color={user.is_active ? 'orange' : 'green'}
                        >
                          {user.is_active ? '🔒' : '🔓'}
                        </ActionBtn>

                        {/* Reset Password */}
                        <ActionBtn
                          title="إعادة تعيين كلمة المرور"
                          onClick={() => onResetPwd(user)}
                          color="purple"
                        >
                          🔑
                        </ActionBtn>

                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────────

function RoleBadge({ role }: { role: UserRole }) {
  const style = ROLE_BADGE[role] ?? { bg: '#F5F5F5', text: '#54565B' };
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[0.68rem] font-bold"
      style={{ backgroundColor: style.bg, color: style.text }}
    >
      {ROLE_LABELS[role]}
    </span>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return active ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.68rem] font-bold bg-[#F0F7E0] text-[#87BA26]">
      <span className="w-1.5 h-1.5 rounded-full bg-[#87BA26] inline-block" />
      مفعّل
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.68rem] font-bold bg-[#FAEEE8] text-[#C05728]">
      <span className="w-1.5 h-1.5 rounded-full bg-[#C05728] inline-block" />
      موقوف
    </span>
  );
}

function ActionBtn({
  children, title, onClick, color,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  color: 'teal' | 'orange' | 'green' | 'purple';
}) {
  const colorMap = {
    teal:   'bg-[#E0F4F3] hover:bg-[#00A79D]/20 text-[#00A79D]',
    orange: 'bg-[#FAEEE8] hover:bg-[#C05728]/20 text-[#C05728]',
    green:  'bg-[#F0F7E0] hover:bg-[#87BA26]/20 text-[#87BA26]',
    purple: 'bg-[#F3E5FF] hover:bg-[#502C7C]/20 text-[#502C7C]',
  };
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors cursor-pointer text-base ${colorMap[color]}`}
    >
      {children}
    </button>
  );
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('ar-SA', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch {
    return '—';
  }
}
