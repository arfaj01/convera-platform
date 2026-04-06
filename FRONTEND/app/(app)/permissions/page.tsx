'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import Card, { CardBody } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';
import {
  getPermissionRequests,
  getPendingPermissionRequests,
  createPermissionRequest,
  approvePermissionRequest,
  rejectPermissionRequest,
} from '@/services/permission-requests';
import {
  getContractApprovers,
  addContractApprover,
  revokeContractApprover,
} from '@/services/approvers';
import { createBrowserSupabase } from '@/lib/supabase';
import type { PermissionRequest, ContractApprover, ApprovalScope } from '@/lib/types';

export default function PermissionsPage() {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const isDirector = profile?.role === 'director';
  const isAdmin = profile?.role === 'admin' || profile?.role === 'auditor';

  // ── State ─────────────────────────────────────────────────────
  const [requests, setRequests] = useState<PermissionRequest[]>([]);
  const [approvers, setApprovers] = useState<ContractApprover[]>([]);
  const [contracts, setContracts] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'requests' | 'approvers'>('requests');

  // ── New request form state ────────────────────────────────────
  const [showForm, setShowForm] = useState(false);
  const [formContractId, setFormContractId] = useState('');
  const [formUserId, setFormUserId] = useState('');
  const [formScope, setFormScope] = useState<ApprovalScope>('final_approver');
  const [formNotes, setFormNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // ── Reject modal state ────────────────────────────────────────
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // ── Load data ─────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [reqResult, supabase] = await Promise.all([
        getPermissionRequests(),
        Promise.resolve(createBrowserSupabase()),
      ]);

      if (reqResult.success) setRequests(reqResult.data || []);

      // Load contracts and internal users for dropdown
      const { data: contractList } = await supabase
        .from('contracts')
        .select('id, contract_no, title_ar')
        .eq('status', 'active')
        .order('contract_no');
      setContracts(contractList || []);

      const { data: userList } = await supabase
        .from('profiles')
        .select('id, full_name_ar, full_name, email, role')
        .eq('is_active', true)
        .in('role', ['director', 'admin', 'reviewer', 'consultant', 'auditor'])
        .order('full_name_ar');
      setUsers(userList || []);

      // Load all approvers
      if (contractList && contractList.length > 0) {
        const allApprovers: ContractApprover[] = [];
        for (const c of contractList) {
          const result = await getContractApprovers(c.id);
          if (result.success && result.data) {
            allApprovers.push(...result.data);
          }
        }
        setApprovers(allApprovers);
      }
    } catch (e) {
      console.warn('PermissionsPage load error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Handlers ──────────────────────────────────────────────────
  const handleCreateRequest = async () => {
    if (!profile || !formContractId || !formUserId) {
      showToast('يرجى تعبئة جميع الحقول المطلوبة', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const result = await createPermissionRequest({
        requestedBy: profile.id,
        targetUserId: formUserId,
        contractId: formContractId,
        requestedScope: formScope,
        notes: formNotes || undefined,
      });
      if (result.success) {
        showToast('تم إرسال طلب الصلاحية بنجاح', 'success');
        setShowForm(false);
        setFormContractId('');
        setFormUserId('');
        setFormNotes('');
        loadData();
      } else {
        showToast(result.error || 'فشل في إرسال الطلب', 'error');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async (requestId: string) => {
    if (!profile) return;
    const result = await approvePermissionRequest(requestId, profile.id);
    if (result.success) {
      showToast('تم اعتماد الطلب وتفعيل الصلاحية', 'success');
      loadData();
    } else {
      showToast(result.error || 'فشل في اعتماد الطلب', 'error');
    }
  };

  const handleReject = async () => {
    if (!profile || !rejectingId || !rejectReason.trim()) {
      showToast('يجب إدخال سبب الرفض', 'error');
      return;
    }
    const result = await rejectPermissionRequest(rejectingId, profile.id, rejectReason);
    if (result.success) {
      showToast('تم رفض الطلب', 'success');
      setRejectingId(null);
      setRejectReason('');
      loadData();
    } else {
      showToast(result.error || 'فشل في رفض الطلب', 'error');
    }
  };

  const handleRevokeApprover = async (approverId: string) => {
    const result = await revokeContractApprover(approverId);
    if (result.success) {
      showToast('تم إلغاء صلاحية المعتمد', 'success');
      loadData();
    } else {
      showToast(result.error || 'فشل في إلغاء الصلاحية', 'error');
    }
  };

  const handleDirectAdd = async () => {
    if (!profile || !formContractId || !formUserId) {
      showToast('يرجى تعبئة جميع الحقول المطلوبة', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const result = await addContractApprover({
        contractId: formContractId,
        userId: formUserId,
        scope: formScope,
        grantedBy: profile.id,
        notes: formNotes || undefined,
      });
      if (result.success) {
        showToast('تم إضافة المعتمد بنجاح', 'success');
        setShowForm(false);
        loadData();
      } else {
        showToast(result.error || 'فشل في إضافة المعتمد', 'error');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ── Scope label ───────────────────────────────────────────────
  const scopeLabel = (scope: string) => {
    const map: Record<string, string> = {
      final_approver: 'معتمد نهائي',
      reviewer: 'مراجع',
      auditor: 'مدقق',
    };
    return map[scope] || scope;
  };

  const statusBadge = (status: string) => {
    const map: Record<string, { label: string; variant: string }> = {
      pending: { label: 'قيد الانتظار', variant: 'warning' },
      approved: { label: 'معتمد', variant: 'success' },
      rejected: { label: 'مرفوض', variant: 'danger' },
    };
    const s = map[status] || { label: status, variant: 'default' };
    return <Badge variant={s.variant as any}>{s.label}</Badge>;
  };

  if (!profile) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="إدارة الصلاحيات والمعتمدين"
        subtitle="إدارة صلاحيات الاعتماد النهائي وطلبات التفويض"
        actions={
          (isAdmin || isDirector) ? (
            <Button onClick={() => setShowForm(true)}>
              {isDirector ? 'إضافة معتمد مباشرة' : 'طلب صلاحية جديد'}
            </Button>
          ) : undefined
        }
      />

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('requests')}
          className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors ${
            activeTab === 'requests'
              ? 'border-[#045859] text-[#045859]'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          طلبات الصلاحيات ({requests.length})
        </button>
        <button
          onClick={() => setActiveTab('approvers')}
          className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors ${
            activeTab === 'approvers'
              ? 'border-[#045859] text-[#045859]'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          المعتمدون النشطون ({approvers.length})
        </button>
      </div>

      {/* New Request / Direct Add Form */}
      {showForm && (
        <Card>
          <CardBody>
            <h3 className="font-bold text-[#045859] mb-4">
              {isDirector ? 'إضافة معتمد مباشرة' : 'طلب صلاحية جديد'}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">العقد</label>
                <select
                  value={formContractId}
                  onChange={e => setFormContractId(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">اختر العقد</option>
                  {contracts.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.contract_no} — {c.title_ar}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">المستخدم</label>
                <select
                  value={formUserId}
                  onChange={e => setFormUserId(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">اختر المستخدم</option>
                  {users.map(u => (
                    <option key={u.id} value={u.id}>
                      {u.full_name_ar || u.full_name} — {u.email}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">نطاق الصلاحية</label>
                <select
                  value={formScope}
                  onChange={e => setFormScope(e.target.value as ApprovalScope)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="final_approver">معتمد نهائي</option>
                  <option value="reviewer">مراجع</option>
                  <option value="auditor">مدقق</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">ملاحظات</label>
                <input
                  type="text"
                  value={formNotes}
                  onChange={e => setFormNotes(e.target.value)}
                  placeholder="ملاحظات اختيارية"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <Button
                onClick={isDirector ? handleDirectAdd : handleCreateRequest}
                disabled={submitting || !formContractId || !formUserId}
              >
                {submitting ? 'جاري...' : isDirector ? 'إضافة' : 'إرسال الطلب'}
              </Button>
              <Button variant="secondary" onClick={() => setShowForm(false)}>
                إلغاء
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Reject Modal */}
      {rejectingId && (
        <Card>
          <CardBody>
            <h3 className="font-bold text-red-600 mb-3">سبب الرفض</h3>
            <textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder="أدخل سبب رفض الطلب (إلزامي)"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm min-h-[80px]"
            />
            <div className="flex gap-2 mt-3">
              <Button variant="danger" onClick={handleReject} disabled={!rejectReason.trim()}>
                تأكيد الرفض
              </Button>
              <Button variant="secondary" onClick={() => { setRejectingId(null); setRejectReason(''); }}>
                إلغاء
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-400">جاري التحميل...</div>
      ) : activeTab === 'requests' ? (
        /* Permission Requests List */
        <Card>
          <CardBody>
            {requests.length === 0 ? (
              <div className="text-center py-8 text-gray-400">لا توجد طلبات صلاحيات</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#045859] text-white">
                      <th className="px-3 py-2 text-right">مقدم الطلب</th>
                      <th className="px-3 py-2 text-right">المستخدم المستهدف</th>
                      <th className="px-3 py-2 text-right">العقد</th>
                      <th className="px-3 py-2 text-center">النطاق</th>
                      <th className="px-3 py-2 text-center">الحالة</th>
                      <th className="px-3 py-2 text-center">التاريخ</th>
                      {isDirector && <th className="px-3 py-2 text-center">إجراء</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map(req => (
                      <tr key={req.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-3 py-2">
                          {(req.requester as any)?.full_name_ar || 'غير معروف'}
                        </td>
                        <td className="px-3 py-2">
                          {(req.target_user as any)?.full_name_ar || 'غير معروف'}
                        </td>
                        <td className="px-3 py-2">
                          {(req.contract as any)?.contract_no} — {(req.contract as any)?.title_ar}
                        </td>
                        <td className="px-3 py-2 text-center">{scopeLabel(req.requested_scope)}</td>
                        <td className="px-3 py-2 text-center">{statusBadge(req.status)}</td>
                        <td className="px-3 py-2 text-center text-xs">
                          {new Date(req.created_at).toLocaleDateString('ar-SA')}
                        </td>
                        {isDirector && (
                          <td className="px-3 py-2 text-center">
                            {req.status === 'pending' && (
                              <div className="flex gap-1 justify-center">
                                <button
                                  onClick={() => handleApprove(req.id)}
                                  className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700"
                                >
                                  اعتماد
                                </button>
                                <button
                                  onClick={() => setRejectingId(req.id)}
                                  className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
                                >
                                  رفض
                                </button>
                              </div>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      ) : (
        /* Active Approvers List */
        <Card>
          <CardBody>
            {approvers.length === 0 ? (
              <div className="text-center py-8 text-gray-400">لا يوجد معتمدون نشطون</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#045859] text-white">
                      <th className="px-3 py-2 text-right">المعتمد</th>
                      <th className="px-3 py-2 text-right">البريد</th>
                      <th className="px-3 py-2 text-center">النطاق</th>
                      <th className="px-3 py-2 text-center">تاريخ التعيين</th>
                      {isDirector && <th className="px-3 py-2 text-center">إجراء</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {approvers.map(a => (
                      <tr key={a.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-3 py-2">
                          {(a.profiles as any)?.full_name_ar || 'غير معروف'}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {(a.profiles as any)?.email || '—'}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Badge variant="info">{scopeLabel(a.approval_scope)}</Badge>
                        </td>
                        <td className="px-3 py-2 text-center text-xs">
                          {new Date(a.granted_at).toLocaleDateString('ar-SA')}
                        </td>
                        {isDirector && (
                          <td className="px-3 py-2 text-center">
                            <button
                              onClick={() => handleRevokeApprover(a.id)}
                              className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
                            >
                              إلغاء
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
