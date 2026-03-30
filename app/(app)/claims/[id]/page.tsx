'use client';

/**
 * Claim Detail Page — NOW POWERED BY Unified Action Engine
 *
 * All action logic (workflow buttons, upload visibility, fix_validation)
 * comes from getAvailableActionsForClaim() — no hardcoded conditions.
 */

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import PageHeader from '@/components/ui/PageHeader';
import Card, { CardHeader, CardBody } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import ClaimTimeline from '@/components/claims/ClaimTimeline';
import WorkflowActions from '@/components/claims/WorkflowActions';
import { fetchClaimById, fetchClaimBOQItems, fetchClaimStaffItems } from '@/services/claims';
import { fetchClaimWorkflow } from '@/services/workflow';
import { fetchClaimDocuments, uploadClaimDocument, downloadDocument, type ClaimDocument } from '@/services/documents';
import { fetchMyContractRoles } from '@/services/contracts';
import { fmt, fmtCurrency, fmtDate } from '@/lib/formatters';
import {
  buildActionContext,
  getAvailableActionsForClaim,
  getBusinessActions,
  hasExecutableAction,
  type ActionContext,
  type ClaimAction,
} from '@/lib/action-engine';
import type { ClaimWorkflow as ClaimWorkflowType, ClaimStatus, ClaimBOQItem, ClaimStaffItem, ContractRole } from '@/lib/types';
import { assessClaimSLA, type SLAAssessment } from '@/lib/sla-escalation';
import { filterVisibleDocuments } from '@/lib/document-access';

export default function ClaimDetailPage() {
  const params = useParams();
  const { profile } = useAuth();
  const claimId = params.id as string;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [claim, setClaim] = useState<any | null>(null);
  const [boqItems, setBoqItems] = useState<ClaimBOQItem[]>([]);
  const [staffItems, setStaffItems] = useState<ClaimStaffItem[]>([]);
  const [workflow, setWorkflow] = useState<ClaimWorkflowType[]>([]);
  const [documents, setDocuments] = useState<ClaimDocument[]>([]);
  const [contractRole, setContractRole] = useState<ContractRole | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      const [c, boq, staff, wf, docs, myRoles] = await Promise.all([
        fetchClaimById(claimId),
        fetchClaimBOQItems(claimId),
        fetchClaimStaffItems(claimId),
        fetchClaimWorkflow(claimId),
        fetchClaimDocuments(claimId).catch(() => [] as ClaimDocument[]),
        fetchMyContractRoles().catch(() => []),
      ]);
      if (c) {
        setClaim(c);
        // Resolve contract role for this specific contract
        const contractId = c.contract_id;
        const role = myRoles.find((r: { contract_id: string }) => r.contract_id === contractId);
        if (role) {
          setContractRole(role.contract_role as ContractRole);
        }
      }
      setBoqItems(boq);
      setStaffItems(staff);
      setWorkflow(wf);
      setDocuments(docs);
    } catch (e) {
      console.warn('Claim detail:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [claimId]);

  if (loading || !claim) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-sm text-gray-400 animate-pulse">جاري تحميل المطالبة...</p>
      </div>
    );
  }

  const contract = claim.contracts as Record<string, string> | null;
  const retPct = parseFloat(contract?.retention_pct as string) || 5;

  // ─── Build unified action context ──────────────────────────────
  const isDirector = profile?.role === 'director';
  const actionContext: ActionContext | null = profile ? buildActionContext({
    userId: profile.id,
    globalRole: profile.role,
    contractRole: contractRole,
    isGlobalRole: isDirector,
    claim: {
      status: claim.status,
      submitted_by: claim.submitted_by,
      return_reason: claim.return_reason,
      has_completion_certificate: claim.has_completion_certificate,
    },
    documents: documents.map(d => ({ type: d.type })),
  }) : null;

  // ─── Derive business actions from action engine ────────────────
  const allActions = actionContext ? getAvailableActionsForClaim(actionContext) : [];
  const businessActions = getBusinessActions(allActions);
  const showUpload = businessActions.some(a => a.type === 'upload_documents');
  const showFixValidation = businessActions.some(a => a.type === 'fix_validation');
  const showCertificateUpload = businessActions.some(a => a.type === 'upload_certificate' && a.enabled);
  const showCertificateDownload = businessActions.some(a => a.type === 'download_certificate');
  const hasCertificate = claim.has_completion_certificate === true;

  return (
    <>
      <PageHeader
        title={`مطالبة #${claim.claim_no}`}
        subtitle={contract?.title_ar || contract?.title || ''}
        action={
          <div className="flex items-center gap-2">
            <Badge status={claim.status as ClaimStatus} />
            {claim.status === 'approved' && (
              <a
                href={`/print/certificate/${claimId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[0.72rem] font-bold bg-[#87BA26] text-white rounded-lg hover:bg-[#6a9a1f] transition-colors no-underline"
              >
                🖨 شهادة الإنجاز
              </a>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Main info */}
        <div className="lg:col-span-2 space-y-4">
          {/* Claim info */}
          <Card>
            <CardHeader title="بيانات المطالبة" />
            <CardBody>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="text-[0.67rem] text-gray-400 font-bold block">رقم العقد</label>
                  <span className="text-sm font-bold text-teal">{contract?.contract_no || '—'}</span>
                </div>
                <div>
                  <label className="text-[0.67rem] text-gray-400 font-bold block">المرجع</label>
                  <span className="text-sm font-bold">{claim.reference_no as string || '—'}</span>
                </div>
                <div>
                  <label className="text-[0.67rem] text-gray-400 font-bold block">من</label>
                  <span className="text-sm font-bold">{fmtDate(claim.period_from as string)}</span>
                </div>
                <div>
                  <label className="text-[0.67rem] text-gray-400 font-bold block">إلى</label>
                  <span className="text-sm font-bold">{fmtDate(claim.period_to as string)}</span>
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Fix validation banner — driven by action engine */}
          {showFixValidation && (
            <div className="flex items-start gap-2 p-3 bg-[#FFF8E0] border border-[#FFC845]/40 rounded-lg text-xs">
              <span className="text-base flex-shrink-0">⚠️</span>
              <div>
                <p className="font-bold text-[#7A4F00]">يجب تصحيح المتطلبات قبل إعادة التقديم</p>
                <p className="text-[#9A6A00] mt-0.5">
                  يرجى إرفاق المستندات المطلوبة (الفاتورة والتقرير الفني) ثم إعادة تقديم المطالبة
                </p>
              </div>
            </div>
          )}

          {/* BOQ items */}
          {boqItems.length > 0 && (
            <Card>
              <CardHeader title={`بنود الأعمال (${boqItems.length})`} />
              <CardBody className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        <th className="text-right px-3 py-2 text-[0.72rem] font-bold text-gray-400 bg-gray-50 border-b border-gray-100">#</th>
                        <th className="text-right px-3 py-2 text-[0.72rem] font-bold text-gray-400 bg-gray-50 border-b border-gray-100">البند</th>
                        <th className="text-right px-3 py-2 text-[0.72rem] font-bold text-gray-400 bg-gray-50 border-b border-gray-100">السعر</th>
                        <th className="text-right px-3 py-2 text-[0.72rem] font-bold text-gray-400 bg-gray-50 border-b border-gray-100">الإنجاز</th>
                        <th className="text-right px-3 py-2 text-[0.72rem] font-bold text-gray-400 bg-gray-50 border-b border-gray-100">المبلغ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {boqItems.map((item) => (
                        <tr key={item.id} className="hover:bg-teal-ultra">
                          <td className="px-3 py-[11px] text-[0.8rem] border-b border-gray-100">{item.item_no}</td>
                          <td className="px-3 py-[11px] text-[0.75rem] border-b border-gray-100">{item.description_ar || item.description}</td>
                          <td className="px-3 py-[11px] text-[0.8rem] border-b border-gray-100 font-bold">{fmt(item.unit_price)}</td>
                          <td className="px-3 py-[11px] text-[0.8rem] border-b border-gray-100">{item.curr_progress}%</td>
                          <td className="px-3 py-[11px] text-[0.8rem] border-b border-gray-100 font-bold text-teal">{fmt(item.period_amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardBody>
            </Card>
          )}

          {/* Staff items */}
          {staffItems.length > 0 && (
            <Card>
              <CardHeader title={`الكوادر (${staffItems.length})`} />
              <CardBody className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        <th className="text-right px-3 py-2 text-[0.72rem] font-bold text-gray-400 bg-gray-50 border-b border-gray-100">#</th>
                        <th className="text-right px-3 py-2 text-[0.72rem] font-bold text-gray-400 bg-gray-50 border-b border-gray-100">المسمى</th>
                        <th className="text-right px-3 py-2 text-[0.72rem] font-bold text-gray-400 bg-gray-50 border-b border-gray-100">أيام</th>
                        <th className="text-right px-3 py-2 text-[0.72rem] font-bold text-gray-400 bg-gray-50 border-b border-gray-100">إضافي</th>
                        <th className="text-right px-3 py-2 text-[0.72rem] font-bold text-gray-400 bg-gray-50 border-b border-gray-100">الإجمالي</th>
                      </tr>
                    </thead>
                    <tbody>
                      {staffItems.map((item) => (
                        <tr key={item.id} className="hover:bg-teal-ultra">
                          <td className="px-3 py-[11px] text-[0.8rem] border-b border-gray-100">{item.item_no}</td>
                          <td className="px-3 py-[11px] text-[0.75rem] border-b border-gray-100">{item.position_ar || item.position}</td>
                          <td className="px-3 py-[11px] text-[0.8rem] border-b border-gray-100">{item.working_days}</td>
                          <td className="px-3 py-[11px] text-[0.8rem] border-b border-gray-100">{item.overtime_hours} ساعة</td>
                          <td className="px-3 py-[11px] text-[0.8rem] border-b border-gray-100 font-bold text-teal">{fmt(item.total_amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardBody>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Financial summary */}
          <div className="bg-teal-dark rounded p-4 text-white">
            {[
              { label: 'إجمالي الأعمال', value: claim.boq_amount },
              { label: 'إجمالي الكوادر', value: claim.staff_amount },
              { label: 'الإجمالي', value: claim.gross_amount },
              { label: `حجز ختامي ${retPct}%`, value: -(claim.retention_amount as number), isDed: true },
              { label: 'الصافي', value: claim.net_amount },
              { label: 'الضريبة 15%', value: claim.vat_amount },
              { label: 'المستحق النهائي', value: claim.total_amount, isTotal: true },
            ].map((row, idx) => (
              <div
                key={idx}
                className={`flex justify-between items-center py-1.5 ${idx < 6 ? 'border-b border-white/[.07]' : ''} ${row.isTotal ? 'pt-2.5' : ''}`}
              >
                <span className={`text-[0.79rem] ${row.isTotal ? 'text-lime/90 font-bold' : row.isDed ? 'text-red-300' : 'text-white/60'}`}>
                  {row.label}
                </span>
                <span className={`font-bold ${row.isTotal ? 'text-lime/90 text-base' : 'text-sm'}`}>
                  {fmtCurrency(Math.abs(row.value as number))}
                </span>
              </div>
            ))}
          </div>

          {/* Workflow actions — from action engine */}
          {actionContext && (
            <WorkflowActions
              claimId={claimId}
              actionContext={actionContext}
              onActionComplete={loadData}
            />
          )}

          {/* Certificate upload — supervisor only, during supervisor review */}
          {showCertificateUpload && profile && (
            <CertificateUploadCard
              claimId={claimId}
              onUploadComplete={loadData}
            />
          )}

          {/* Certificate status indicator — when already uploaded */}
          {hasCertificate && claim.status === 'under_supervisor_review' && !showCertificateUpload && (
            <div className="flex items-center gap-2 p-3 bg-[#F0F7E0] border border-[#87BA26]/30 rounded-lg text-xs">
              <span className="text-base">✅</span>
              <p className="font-bold text-[#4A7A12]">تم رفع شهادة الإنجاز — يمكنك الآن الموافقة</p>
            </div>
          )}

          {/* Certificate download — contractor after approval */}
          {showCertificateDownload && (
            <CertificateDownloadCard documents={documents} />
          )}

          {/* Upload — visibility driven by action engine */}
          {showUpload && profile && (
            <ClaimAttachmentUpload
              claimId={claimId}
              uploadedBy={profile.id}
              onUploadComplete={loadData}
            />
          )}

          {/* Attachments */}
          <AttachmentsCard
            documents={documents}
            claimStatus={claim.status as ClaimStatus}
            contractRole={contractRole}
            isDirector={isDirector}
          />

          {/* Timeline — enhanced with SLA + owner */}
          <Card>
            <CardHeader title="سجل الإجراءات" />
            <CardBody>
              <ClaimTimeline
                workflow={workflow}
                currentStatus={claim.status as ClaimStatus}
                sla={claim ? assessClaimSLA(
                  { id: claim.id, claim_no: claim.claim_no, contract_id: claim.contract_id, status: claim.status as ClaimStatus },
                  claim.last_transition_at || claim.updated_at,
                ) : null}
              />
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

/* ── ClaimAttachmentUpload ───────────────────────────────────────
 * Upload zone — visibility is now controlled by the action engine.
 * No longer checks roles/statuses internally (action-engine does that).
 * ─────────────────────────────────────────────────────────────── */

function ClaimAttachmentUpload({
  claimId,
  uploadedBy,
  onUploadComplete,
}: {
  claimId: string;
  uploadedBy: string;
  onUploadComplete: () => void;
}) {
  const { showToast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState<'invoice' | 'other'>('invoice');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleFileSelect = (f: File | null) => {
    setFile(f);
    setError(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0] || null;
    if (f) handleFileSelect(f);
  };

  const handleUpload = async () => {
    if (!file) { setError('يرجى اختيار ملف أولاً'); return; }
    if (!file.type.includes('pdf') && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('يُقبل ملف PDF فقط');
      return;
    }
    const MAX_MB = 100;
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`حجم الملف يتجاوز الحد الأقصى (${MAX_MB} ميجابايت)`);
      return;
    }

    setUploading(true);
    setError(null);
    try {
      await uploadClaimDocument(claimId, file, docType, uploadedBy);
      showToast('تم رفع الملف بنجاح', 'ok');
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      onUploadComplete();
    } catch (e) {
      const msg = (e as Error).message || 'خطأ غير معروف';
      setError(`تعذّر الرفع: ${msg}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card>
      <CardHeader title="رفع مرفق جديد" />
      <CardBody className="space-y-3">
        {/* Doc type selector */}
        <div>
          <label className="block text-[0.72rem] font-bold text-gray-600 mb-1">
            نوع المرفق <span className="text-red">*</span>
          </label>
          <select
            value={docType}
            onChange={e => setDocType(e.target.value as 'invoice' | 'other')}
            className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:border-teal focus:outline-none font-sans"
          >
            <option value="invoice">🧾 الفاتورة المعتمدة</option>
            <option value="other">📎 مستند داعم</option>
          </select>
        </div>

        {/* Drop zone / selected file preview */}
        {!file ? (
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`
              border-2 border-dashed rounded-lg p-5 text-center cursor-pointer transition-all select-none
              ${dragOver
                ? 'border-teal bg-teal-ultra'
                : 'border-gray-200 bg-gray-50 hover:border-teal/40 hover:bg-teal-ultra/50'}
            `}
          >
            <div className="text-2xl mb-1.5">📎</div>
            <div className="text-[0.82rem] font-bold text-teal-dark mb-0.5">
              اسحب الملف هنا أو اضغط للاختيار
            </div>
            <div className="text-[0.68rem] text-gray-400">
              PDF فقط — حد أقصى 100 ميجابايت
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between p-3 bg-teal-ultra border border-teal/20 rounded-lg">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-lg flex-shrink-0">📄</span>
              <div className="min-w-0">
                <div className="text-[0.78rem] font-bold text-teal-dark truncate">{file.name}</div>
                <div className="text-[0.65rem] text-gray-400">{formatSize(file.size)}</div>
              </div>
            </div>
            <button
              type="button"
              disabled={uploading}
              onClick={() => { handleFileSelect(null); if (inputRef.current) inputRef.current.value = ''; }}
              className="text-red/60 hover:text-red text-sm cursor-pointer bg-transparent border-none px-2 py-1 font-sans disabled:opacity-40"
            >
              حذف
            </button>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="flex items-start gap-1.5 p-2.5 bg-red/5 border border-red/15 rounded text-[0.72rem]">
            <span className="flex-shrink-0">⚠️</span>
            <p className="text-red font-bold">{error}</p>
          </div>
        )}

        {/* Upload button */}
        <Button
          variant="teal"
          onClick={handleUpload}
          disabled={!file || uploading}
          className="w-full justify-center"
        >
          {uploading ? (
            <span className="animate-pulse">جاري الرفع...</span>
          ) : (
            'رفع الملف ⬆'
          )}
        </Button>

        {/* Hidden input */}
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          onChange={e => handleFileSelect(e.target.files?.[0] || null)}
          className="hidden"
        />
      </CardBody>
    </Card>
  );
}

/* ── AttachmentsCard ─────────────────────────────────────────────
 * Shows attached files. Flags missing invoice for pending claims.
 * ─────────────────────────────────────────────────────────────── */

const DOC_TYPE_LABELS: Record<string, string> = {
  invoice:                'الفاتورة المعتمدة',
  claim:                  'مستند المطالبة',
  approval:               'وثيقة الاعتماد',
  completion_certificate: 'شهادة الإنجاز',
  other:                  'مستند آخر',
};

const DOC_TYPE_ICONS: Record<string, string> = {
  invoice:                '🧾',
  claim:                  '📄',
  approval:               '✅',
  completion_certificate: '📜',
  other:                  '📎',
};

const STATUSES_NEEDING_INVOICE: ClaimStatus[] = [
  'submitted',
  'under_supervisor_review',
  'under_auditor_review',
  'under_reviewer_check',
  'pending_director_approval',
];

/* ── CertificateUploadCard ─────────────────────────────────────
 * Supervisor uploads completion certificate (شهادة الإنجاز).
 * Required before approve action is enabled.
 * ─────────────────────────────────────────────────────────────── */

function CertificateUploadCard({
  claimId,
  onUploadComplete,
}: {
  claimId: string;
  onUploadComplete: () => void;
}) {
  const { showToast } = useToast();
  const { profile } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async () => {
    if (!file || !profile) return;
    if (!file.type.includes('pdf') && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('يُقبل ملف PDF فقط');
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      setError('حجم الملف يتجاوز الحد المسموح (100 ميجابايت)');
      return;
    }

    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('claimId', claimId);
      formData.append('file', file);

      const token = (await (await import('@/lib/supabase')).createBrowserSupabase().auth.getSession()).data.session?.access_token;
      const res = await fetch('/api/claims/upload-certificate', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'فشل في رفع الشهادة');

      showToast('تم رفع شهادة الإنجاز بنجاح', 'ok');
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      onUploadComplete();
    } catch (e) {
      setError((e as Error).message || 'خطأ غير معروف');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card>
      <CardHeader title="📜 رفع شهادة الإنجاز" />
      <CardBody className="space-y-3">
        <div className="flex items-start gap-2 p-2.5 bg-[#FFF8E0] border border-[#FFC845]/30 rounded text-xs">
          <span className="flex-shrink-0">⚠️</span>
          <p className="text-[#7A4F00] font-bold">
            يجب رفع شهادة الإنجاز قبل الموافقة على المطالبة
          </p>
        </div>

        {!file ? (
          <div
            onClick={() => inputRef.current?.click()}
            className="border-2 border-dashed border-[#FFC845]/50 bg-[#FFF8E0]/30 rounded-lg p-4 text-center cursor-pointer hover:border-[#FFC845] transition-colors"
          >
            <div className="text-2xl mb-1">📜</div>
            <div className="text-[0.8rem] font-bold text-[#7A4F00]">اختر ملف شهادة الإنجاز (PDF)</div>
            <div className="text-[0.65rem] text-gray-400 mt-0.5">PDF فقط — حد أقصى 100 ميجابايت</div>
          </div>
        ) : (
          <div className="flex items-center justify-between p-3 bg-[#FFF8E0] border border-[#FFC845]/30 rounded-lg">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-lg flex-shrink-0">📜</span>
              <div className="min-w-0">
                <div className="text-[0.78rem] font-bold text-[#7A4F00] truncate">{file.name}</div>
                <div className="text-[0.65rem] text-gray-400">
                  {file.size < 1024 * 1024 ? `${(file.size / 1024).toFixed(1)} KB` : `${(file.size / (1024 * 1024)).toFixed(1)} MB`}
                </div>
              </div>
            </div>
            <button
              type="button"
              disabled={uploading}
              onClick={() => { setFile(null); if (inputRef.current) inputRef.current.value = ''; }}
              className="text-red/60 hover:text-red text-sm cursor-pointer bg-transparent border-none px-2 py-1 font-sans disabled:opacity-40"
            >
              حذف
            </button>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-1.5 p-2 bg-red/5 border border-red/15 rounded text-[0.72rem]">
            <span className="flex-shrink-0">⚠️</span>
            <p className="text-red font-bold">{error}</p>
          </div>
        )}

        <Button
          variant="teal"
          onClick={handleUpload}
          disabled={!file || uploading}
          className="w-full justify-center"
        >
          {uploading ? (
            <span className="animate-pulse">جاري رفع الشهادة...</span>
          ) : (
            '📜 رفع شهادة الإنجاز'
          )}
        </Button>

        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          onChange={e => { setFile(e.target.files?.[0] || null); setError(null); }}
          className="hidden"
        />
      </CardBody>
    </Card>
  );
}

/* ── CertificateDownloadCard ──────────────────────────────────
 * Contractor can download completion certificate after approval.
 * ─────────────────────────────────────────────────────────────── */

function CertificateDownloadCard({ documents }: { documents: ClaimDocument[] }) {
  const certDoc = documents.find(d => d.type === 'completion_certificate');
  const [downloading, setDownloading] = useState(false);
  const [dlError, setDlError] = useState<string | null>(null);
  const { showToast } = useToast();

  const handleDownload = async () => {
    if (!certDoc) return;
    setDownloading(true);
    setDlError(null);
    try {
      const result = await downloadDocument(certDoc.id, certDoc.original_name || certDoc.name);
      if (!result.ok) {
        const msg = result.error || 'تعذّر تحميل الشهادة';
        setDlError(msg);
        showToast(msg, 'error');
      }
    } catch {
      setDlError('حدث خطأ غير متوقع');
    } finally {
      setDownloading(false);
    }
  };

  if (!certDoc) return null;

  return (
    <Card>
      <CardHeader title="📜 شهادة الإنجاز" />
      <CardBody>
        {dlError && (
          <div className="flex items-start gap-1.5 p-2 mb-2 bg-red/5 border border-red/15 rounded text-[0.72rem]">
            <span className="flex-shrink-0">⚠️</span>
            <p className="text-red font-bold">{dlError}</p>
          </div>
        )}
        <div className="flex items-center justify-between p-3 bg-[#F0F7E0] border border-[#87BA26]/20 rounded-lg">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-lg flex-shrink-0">📜</span>
            <div className="min-w-0">
              <div className="text-[0.78rem] font-bold text-[#4A7A12] truncate">
                {certDoc.original_name || certDoc.name}
              </div>
              <div className="text-[0.65rem] text-gray-400">
                {fmtDate(certDoc.created_at)}
              </div>
            </div>
          </div>
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="flex-shrink-0 ms-2 px-3 py-1.5 text-[0.75rem] font-bold text-white bg-[#87BA26] rounded hover:bg-[#6a9a1f] transition-colors cursor-pointer border-none font-sans disabled:opacity-50"
          >
            {downloading ? '⏳ جاري...' : '⬇ تحميل'}
          </button>
        </div>
      </CardBody>
    </Card>
  );
}

function AttachmentsCard({
  documents,
  claimStatus,
  contractRole,
  isDirector,
}: {
  documents: ClaimDocument[];
  claimStatus: ClaimStatus;
  contractRole: string | null;
  isDirector: boolean;
}) {
  const { showToast } = useToast();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // ── Filter: hide completion_certificate from contractors before approval ──
  // Uses centralized rule from DocumentAccessService
  const visibleDocuments = filterVisibleDocuments(
    documents, contractRole as ContractRole | null, isDirector, claimStatus,
  ) as ClaimDocument[];

  const hasInvoice = documents.some(d => d.type === 'invoice');
  const invoiceRequired = STATUSES_NEEDING_INVOICE.includes(claimStatus);
  const showMissingInvoiceWarning = invoiceRequired && !hasInvoice;

  const formatBytes = (b: number | null) => {
    if (!b) return '';
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleDownload = async (doc: ClaimDocument) => {
    setDownloadingId(doc.id);
    try {
      const result = await downloadDocument(doc.id, doc.original_name || doc.name);
      if (!result.ok) {
        const msg = result.error || 'تعذّر تحميل المستند';
        showToast(msg, 'error');
      }
    } catch {
      showToast('حدث خطأ أثناء التحميل', 'error');
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <Card>
      <CardHeader title={`المرفقات (${visibleDocuments.length})`} />
      <CardBody className={visibleDocuments.length === 0 ? undefined : 'p-0'}>
        {/* Missing invoice warning */}
        {showMissingInvoiceWarning && (
          <div className="flex items-start gap-2 p-3 bg-red/5 border border-red/15 rounded mb-3 text-xs">
            <span className="text-base flex-shrink-0">🚨</span>
            <div>
              <p className="font-bold text-red">الفاتورة المعتمدة مطلوبة</p>
              <p className="text-gray-500 mt-0.5">
                لا يمكن المضي في سير الاعتماد بدون إرفاق الفاتورة المعتمدة
              </p>
            </div>
          </div>
        )}

        {visibleDocuments.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">لا توجد مرفقات</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {visibleDocuments.map(doc => (
              <div key={doc.id} className="flex items-center justify-between px-3.5 py-2.5 hover:bg-teal-ultra/40">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <span className="text-base flex-shrink-0">{DOC_TYPE_ICONS[doc.type] || '📎'}</span>
                  <div className="min-w-0">
                    <div className="text-[0.8rem] font-bold text-teal-dark truncate">
                      {doc.original_name || doc.name}
                    </div>
                    <div className="flex gap-2 mt-0.5">
                      <span className="text-[0.65rem] text-teal bg-teal/10 px-1.5 py-px rounded">
                        {DOC_TYPE_LABELS[doc.type] || doc.type}
                      </span>
                      {doc.file_size && (
                        <span className="text-[0.65rem] text-gray-400">
                          {formatBytes(doc.file_size)}
                        </span>
                      )}
                      <span className="text-[0.65rem] text-gray-400">
                        {fmtDate(doc.created_at)}
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => handleDownload(doc)}
                  disabled={downloadingId === doc.id}
                  className="flex-shrink-0 ms-2 px-2.5 py-1 text-[0.72rem] font-bold text-teal border border-teal/20 rounded hover:bg-teal/10 transition-colors bg-transparent cursor-pointer font-sans disabled:opacity-50 disabled:cursor-wait"
                  title="تنزيل"
                >
                  {downloadingId === doc.id ? '⏳' : '⬇'} تنزيل
                </button>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
