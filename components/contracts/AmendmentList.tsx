'use client';

import { useEffect, useRef, useState } from 'react';
import Card, { CardHeader, CardBody } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { CustomBadge } from '@/components/ui/Badge';
import Modal from '@/components/ui/Modal';
import AmendmentForm from './AmendmentForm';
import { fetchAmendments, approveAmendment, rejectAmendment } from '@/services/amendments';
import { fmt, fmtDate } from '@/lib/formatters';
import { canCreateAmendment, canApproveAmendment } from '@/lib/permissions';
import type { Amendment, Profile } from '@/lib/types';

interface AmendmentListProps {
  contractId: string;
  profile: Profile | null;
  onUpdate: () => void;
}

const STATUS_BADGE: Record<string, { label: string; variant: 'green' | 'orange' | 'red' | 'gray' }> = {
  pending: { label: 'قيد الاعتماد', variant: 'orange' },
  approved: { label: 'معتمد', variant: 'green' },
  rejected: { label: 'مرفوض', variant: 'red' },
};

export default function AmendmentList({ contractId, profile, onUpdate }: AmendmentListProps) {
  const [amendments, setAmendments] = useState<Amendment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  async function load() {
    if (!mountedRef.current) return;
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchAmendments(contractId);
      if (mountedRef.current) setAmendments(data);
    } catch (e) {
      if (!mountedRef.current) return;
      const msg = (e as Error).message;
      setLoadError(
        msg === 'TIMEOUT'
          ? 'انتهت مهلة الاتصال — تحقق من الشبكة وأعد المحاولة'
          : `تعذّر تحميل التعديلات — ${msg}`
      );
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  useEffect(() => { load(); }, [contractId, retryKey]);

  const role = profile?.role;
  const showCreate = role && canCreateAmendment(role);
  const showApprove = role && canApproveAmendment(role);

  async function handleApprove(id: string) {
    if (!profile) return;
    setActionLoading(true);
    try {
      await approveAmendment(id, profile.id);
      await load();
      onUpdate();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleReject() {
    if (!profile || !rejectId) return;
    setActionLoading(true);
    try {
      await rejectAmendment(rejectId, profile.id, rejectReason);
      setRejectId(null);
      setRejectReason('');
      await load();
      onUpdate();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-3 py-12">
        <div className="w-4 h-4 border-2 border-teal border-t-transparent rounded-full animate-spin flex-shrink-0" />
        <p className="text-sm text-gray-400">جاري تحميل التعديلات...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <Card>
        <CardBody className="py-10 text-center">
          <div className="text-3xl mb-3">⚠️</div>
          <p className="text-sm font-bold text-orange mb-1">تعذّر تحميل التعديلات</p>
          <p className="text-xs text-gray-400 mb-4">{loadError}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRetryKey(k => k + 1)}
          >
            🔄 إعادة المحاولة
          </Button>
        </CardBody>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader
          title={`تعديلات العقد (${amendments.length})`}
          action={
            showCreate ? (
              <Button variant="teal" size="sm" onClick={() => setShowForm(true)}>
                طلب تعديل جديد
              </Button>
            ) : undefined
          }
        />
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="text-right px-3 py-2 text-[0.72rem] font-bold text-gray-400 bg-gray-50 border-b border-gray-100">#</th>
                  <th className="text-right px-3 py-2 text-[0.72rem] font-bold text-gray-400 bg-gray-50 border-b border-gray-100">العنوان</th>
                  <th className="text-right px-3 py-2 text-[0.72rem] font-bold text-gray-400 bg-gray-50 border-b border-gray-100">القيمة</th>
                  <th className="text-right px-3 py-2 text-[0.72rem] font-bold text-gray-400 bg-gray-50 border-b border-gray-100">تغيير المدة</th>
                  <th className="text-right px-3 py-2 text-[0.72rem] font-bold text-gray-400 bg-gray-50 border-b border-gray-100">الحالة</th>
                  <th className="text-right px-3 py-2 text-[0.72rem] font-bold text-gray-400 bg-gray-50 border-b border-gray-100">التاريخ</th>
                  {showApprove && (
                    <th className="text-right px-3 py-2 text-[0.72rem] font-bold text-gray-400 bg-gray-50 border-b border-gray-100">إجراءات</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {amendments.length === 0 ? (
                  <tr>
                    <td colSpan={showApprove ? 7 : 6} className="px-3 py-8 text-center text-sm text-gray-400">
                      لا توجد تعديلات على هذا العقد
                    </td>
                  </tr>
                ) : (
                  amendments.map(a => {
                    const badge = STATUS_BADGE[a.status] || STATUS_BADGE.pending;
                    return (
                      <tr key={a.id} className="hover:bg-teal-ultra">
                        <td className="px-3 py-[11px] text-[0.8rem] border-b border-gray-100 font-bold text-teal">
                          {a.amendment_no}
                        </td>
                        <td className="px-3 py-[11px] text-[0.8rem] border-b border-gray-100">
                          {a.title}
                          {a.document_name && (
                            <span className="text-[0.67rem] text-gray-400 block mt-0.5">
                              📎 {a.document_name}
                            </span>
                          )}
                        </td>
                        <td className={`px-3 py-[11px] text-[0.8rem] border-b border-gray-100 font-bold ${a.value_change >= 0 ? 'text-green' : 'text-red'}`}>
                          {a.value_change >= 0 ? '+' : ''}{fmt(a.value_change)} ر.س
                        </td>
                        <td className="px-3 py-[11px] text-[0.8rem] border-b border-gray-100">
                          {a.duration_change !== 0 ? `${a.duration_change > 0 ? '+' : ''}${a.duration_change} شهر` : '—'}
                        </td>
                        <td className="px-3 py-[11px] border-b border-gray-100">
                          <CustomBadge label={badge.label} variant={badge.variant} />
                        </td>
                        <td className="px-3 py-[11px] text-[0.8rem] border-b border-gray-100">
                          {fmtDate(a.created_at)}
                        </td>
                        {showApprove && (
                          <td className="px-3 py-[11px] border-b border-gray-100">
                            {a.status === 'pending' && (
                              <div className="flex gap-1">
                                <button
                                  onClick={() => handleApprove(a.id)}
                                  disabled={actionLoading}
                                  className="px-2 py-1 bg-green text-white text-[0.72rem] font-bold rounded-sm border-none cursor-pointer hover:opacity-80 disabled:opacity-50 font-sans"
                                >
                                  اعتماد
                                </button>
                                <button
                                  onClick={() => setRejectId(a.id)}
                                  disabled={actionLoading}
                                  className="px-2 py-1 bg-red text-white text-[0.72rem] font-bold rounded-sm border-none cursor-pointer hover:opacity-80 disabled:opacity-50 font-sans"
                                >
                                  رفض
                                </button>
                              </div>
                            )}
                            {a.status === 'rejected' && a.rejection_reason && (
                              <span className="text-[0.67rem] text-red">{a.rejection_reason}</span>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      {/* Create Amendment Modal */}
      {showForm && profile && (
        <AmendmentForm
          contractId={contractId}
          createdBy={profile.id}
          existingCount={amendments.length}
          onClose={() => setShowForm(false)}
          onCreated={() => {
            setShowForm(false);
            load();
            onUpdate();
          }}
        />
      )}

      {/* Reject Reason Modal */}
      <Modal
        open={!!rejectId}
        onClose={() => { setRejectId(null); setRejectReason(''); }}
        title="سبب الرفض"
        footer={
          <>
            <Button variant="outline" onClick={() => { setRejectId(null); setRejectReason(''); }}>
              إلغاء
            </Button>
            <Button variant="red" onClick={handleReject} disabled={!rejectReason.trim() || actionLoading}>
              رفض التعديل
            </Button>
          </>
        }
      >
        <textarea
          value={rejectReason}
          onChange={e => setRejectReason(e.target.value)}
          placeholder="أدخل سبب رفض التعديل..."
          className="w-full px-3 py-2.5 border-[1.5px] border-gray-100 rounded-sm text-sm font-sans bg-gray-50 focus:outline-none focus:border-teal text-right min-h-[80px] resize-y"
        />
      </Modal>
    </>
  );
}
