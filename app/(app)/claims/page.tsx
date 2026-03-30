'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from 'A/components/AuthProvider';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Card, { CardBody } from 'A/components/ui/Card';
import { fetchClaims } from '@/services/claims';
import { fetchContracts } from '@/services/contracts';
import { fmt, fmtDate } from '@/lib/formatters';
import { isExternal, canSubmitClaim } from '@/lib/permissions';
import type { ClaimView } from '@/lib/types';

// ─── No-scope empty state ─────────────────────────────────────────
function NoScopeState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: '#FFF8E0' }}>
        <svg className="w-8 h-8 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m0 0v2m0-2h2m-2 0H10m2-8V5m0 4v2m0 0V9" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3C6.48 3 2 7.48 2 13s4.48 10 10 10 10-4.48 10-10S17.52 3 12 3zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
        </svg>
      </div>
      <h3 className="text-base font-bold mb-2" style={{ color: '#045859' }}>
        لا توجد عقود مرتبطة بحسابك حالياً
      </h3>
      <p className="text-sm text-gray-500 max-w-sm leading-relaxed">
        تم تقييد صلاحياتك التشغيلية — لا يمكن رفع مطالبات أو عرضها بدون عقود مرتبطة.
        تواصل مع مدير الإدارة لتفعيل الصلاحيات.
      </p>
    </div>
  );
}

export default function ClaimsPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const [claims, setClaims] = useState<ClaimView[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  // Track whether scoped user has any linked contracts at all
  const [hasScope, setHasScope] = useState(true);

  const isScoped = profile && isExternal(profile.role);

  useEffect(() => {
    async function load() {
      try {
        // RLS already scopes results correctly after migration 017.
        // fetchContracts() returns only the contracts the current user is
        // allowed to see.  We use this count to detect zero-scope state for
        // external roles, rather than the old externalId filter which was
        // comparing against the deprecated contracts.external_user_id column.
        const [allClaims, contracts] = await Promise.all([
          fetchClaims(),
          fetchContracts(),
        ]);

        if (isScoped) {
          // If RLS returned no contracts at all, this scoped user has no scope.
          if (contracts.length === 0) {
            setHasScope(false);
            setClaims([]);
          } else {
            setHasScope(true);
            // Claims are already RLS-scoped; no manual filtering needed.
            setClaims(allClaims);
          }
        } else {
          // Internal/global roles — show everything RLS returns
          setClaims(allClaims);
        }
      } catch (e) {
        console.warn('Claims:', e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [profile, isScoped]);

  const PENDING_STATUSES = [
    'submitted',
    'under_supervisor_review',
    'under_auditor_review',
    'under_reviewer_check',
    'pending_director_approval',
    'returned_by_supervisor',
    'returned_by_auditor',
  ];
  const filtered = filter === 'all'
    ? claims
    : filter === 'pending'
      ? claims.filter(c => PENDING_STATUSES.includes(c.status))
      : claims.filter(c => c.status === filter);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-sm text-gray-400 animate-pulse">جاري تحميل المطالبات...</p>
      </div>
    );
  }

  // Scoped user (contractor / supervisor) with no linked contracts
  if (isScoped && !hasScope) {
    return (
      <>
        <PageHeader title="المطالبات المالية" subtitle="غير متاح" />
        <NoScopeState />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="المطالبات المالية"
        subtitle={`${claims.length} مطالبة مالية`}
        action={
          profile && canSubmitClaim(profile.role) && hasScope ? (
            <Button icon="➕" onClick={() => router.push('/claims/new')}>
              مطالبة مالية جديدة
            </Button>
          ) : undefined
        }
      />

      {/* Filter bar */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {[
          { value: 'all', label: 'الكل& },
          { value: 'draft', label: 'مسودة' },
          { value: 'submitted', label: 'مقدّم' },
          { value: 'pending', label: 'قيد المراجعة' },
          { value: 'approved', label: 'معتمد' },
          { value: 'rejected', label: 'مرفوض' },
        ].map(f => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`px-3 py-1.5 border-[1.5px] rounded-sm text-xs font-bold cursor-pointer transition-all font-sans
              ${filter === f.value
                ? 'bg-teal text-white border-teal'
                : 'bg-white border-gray-100 text-gray-600 hover:border-teal hover:text-teal'
              }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Claims table */}
      <Card>
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="text-right px-3 py-2 text-[0.72rem] font-bold text-gray-400 bg-gray-50 border-b border-gray-100">#</th>
                  <th className="text-right px-3 py-2 text-[0.72rem] font-bold text-gray-400 bg-gray-50 border-b border-gray-100">المرجع</th>
                  <th className="text-right px-3 py-2 text-[0.72rem] font-bold text-gray-400 bg-gray-50 border-b border-gray-100">العقد</th>
                  <th className="text-right px-3 py-2 text-[0.72rem] font-bold text-gray-400 bg-gray-50 border-b border-gray-100">التاريخ</th>
                  <th className="text-right px-3 py-2 text-[0.72rem] font-bold text-gray-400 bg-gray-50 border-b border-gray-100">المبلغ</th>
                  <th className="text-right px-3 py-2 text-[0.72rem] font-bold text-gray-400 bg-gray-50 border-b border-gray-100">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-sm text-gray-400">
                      لا توجد مطالبات
                    </td>
                  </tr>
                ) : (
                  filtered.map(c => (
                    <tr
                      key={c.id}
                      className="hover:bg-teal-ultra cursor-pointer"
                      onClick={() => router.push(`/claims/${c.id}`)}
                    >
                      <td className="px-3 py-[11px] text-[0.8rem] border-b border-gray-100 font-bold text-teal">
                        #{c.no}
                      </td>
                      <td className="px-3 py-[11px] text-[0.8rem] border-b border-gray-100">
                        {c.ref}
                      </td>
                      <td className="px-3 py-[11px] text-[0.8rem] border-b border-gray-100">
                        {c.contractNo}
                      </td>
                      <td className="px-3 py-[11px] text-[0.8rem] border-b border-gray-100">
                        {fmtDate(c.date)}
                      </td>
                      <td className="px-3 py-[11px] text-[0.8rem] border-b border-gray-100 font-bold">
                        {fmt(c.total)} ر.س
                      </td>
                      <td className="px-3 py-[11px] border-b border-gray-100">
                        <Badge status={c.status} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </>
  