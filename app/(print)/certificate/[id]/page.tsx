'use client';

/**
 * CONVERA — Certificate Print Page
 * Route: /print/certificate/[id]   (inside (print) route group — no sidebar/topbar)
 *
 * Renders two official Arabic RTL government documents for an approved claim:
 *
 *   Document 1:  شهادة الإنجاز              (Completion Certificate)
 *   Document 2:  استمارة المراجعة والتدقيق   (Audit / Review Form)
 *
 * Output method: browser window.print() → Save as PDF
 * Guard: data service throws if status !== 'approved'
 *
 * Print hardening applied:
 *  - A4 210 mm × 297 mm with 14 mm top/bottom / 16 mm sides margins
 *  - font: MasmakBHD Bold (custom OTF) with Tajawal fallback
 *  - table-layout: fixed + explicit column widths → no overflow
 *  - page-break-inside: avoid on table rows
 *  - -webkit-print-color-adjust: exact (Chromium)
 *  - Arabic RTL throughout
 */

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  loadCertificateData,
  fmtMoney,
  fmtDateAr,
  fmtDateShort,
  CONTRACT_TYPE_AR,
  type CertificateData,
  type CertBOQItem,
  type CertStaffItem,
  type CertWorkflowStep,
} from '@/services/certificate';

// ── Arabic label maps ──────────────────────────────────────────────

/** Maps claim_workflow.action values → human-readable Arabic */
const ACTION_LABEL: Record<string, string> = {
  submit:             'تقديم المطالبة',
  resubmit:           'إعادة تقديم بعد الإرجاع',
  comment:            'ملاحظة',
  consultant_review:  'أُحيلت للمشرف',
  consultant_return:  'أُعيدت من المشرف',
  admin_review:       'أُحيلت للمدقق',
  admin_return:       'أُعيدت من المدقق',
  forward:            'أُحيلت للمدير',
  approve:            'اعتماد نهائي',
  reject:             'رفض',
  director_return:    'إرجاع من المدير',
  close:              'إغلاق',
  reopen:             'إعادة فتح',
};

const STATUS_LABEL: Record<string, string> = {
  draft:                      'مسودة',
  submitted:                  'مقدّمة',
  under_supervisor_review:    'قيد مراجعة المشرف',
  returned_by_supervisor:     'أُعيدت من المشرف',
  under_auditor_review:       'قيد تدقيق المدقق',
  returned_by_auditor:        'أُعيدت من المدقق',
  under_reviewer_check:       'قيد مراجعة المراجع',
  pending_director_approval:  'بانتظار اعتماد المدير',
  approved:                   'معتمدة',
  rejected:                   'مرفوضة',
};

const ROLE_LABEL: Record<string, string> = {
  director:   'مدير الإدارة',
  admin:      'مدقق',
  reviewer:   'مراجع',
  consultant: 'مشرف',
  contractor: 'مقاول',
};

// ── Print styles ───────────────────────────────────────────────────
// Injected once into <head>. All layout is pure CSS — no Tailwind in print context.

const PRINT_STYLES = `
  @font-face {
    font-family: 'MasmakBHD';
    src: url('/fonts/MasmakBHD-Bold.otf') format('opentype');
    font-weight: 700;
    font-style: normal;
    font-display: block;
  }

  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  html, body {
    font-family: 'MasmakBHD', 'Tajawal', 'Arial', sans-serif;
    direction: rtl;
    background: #F0F0F0;
    color: #1A1A2E;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    color-adjust: exact;
  }

  /* ── A4 page simulation ──────────── */
  .cert-page {
    width: 210mm;
    min-height: 297mm;
    background: #FFFFFF;
    margin: 0 auto 28px;
    padding: 14mm 16mm 18mm;
    position: relative;
    overflow: hidden;
  }

  @media screen {
    body { padding: 12px 0 60px; }
    .cert-page {
      box-shadow:
        0 1px 3px rgba(0,0,0,0.06),
        0 4px 16px rgba(0,0,0,0.10),
        0 8px 32px rgba(0,0,0,0.06);
    }
    .screen-only { display: block; }
    .print-controls-bar {
      position: fixed;
      bottom: 0; left: 0; right: 0;
      background: rgba(4,88,89,0.97);
      backdrop-filter: blur(6px);
      padding: 10px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      z-index: 1000;
      box-shadow: 0 -4px 20px rgba(0,0,0,0.25);
    }
    .print-how {
      display: block;
      font-size: 12.5px;
      color: rgba(255,255,255,0.85);
      font-family: 'MasmakBHD','Tajawal',sans-serif;
      line-height: 1.5;
      direction: rtl;
    }
    .print-how strong { color: #87BA26; }
    .btn-print {
      display: flex;
      align-items: center;
      gap: 8px;
      background: #87BA26;
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 10px 24px;
      font-family: 'MasmakBHD','Tajawal',sans-serif;
      font-weight: 700;
      font-size: 14.5px;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .btn-print:hover { background: #6a9a1f; }
    .btn-back {
      display: flex;
      align-items: center;
      gap: 6px;
      background: transparent;
      color: rgba(255,255,255,0.75);
      border: 1.5px solid rgba(255,255,255,0.30);
      border-radius: 8px;
      padding: 8px 16px;
      font-family: 'MasmakBHD','Tajawal',sans-serif;
      font-weight: 700;
      font-size: 13px;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .btn-back:hover { border-color: rgba(255,255,255,0.60); color: #fff; }
  }

  @media print {
    html, body { background: #fff; }
    .cert-page {
      margin: 0;
      box-shadow: none;
      page-break-after: always;
    }
    .cert-page:last-child { page-break-after: auto; }
    .print-controls-bar { display: none !important; }
    .screen-only { display: none !important; }
    @page {
      size: A4 portrait;
      margin: 0;
    }
  }

  /* ── Header ───────────────────────── */
  .cert-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 3px solid #045859;
    padding-bottom: 9px;
    margin-bottom: 10px;
    gap: 8px;
  }
  .cert-header-logo { flex-shrink: 0; }
  .cert-header-logo img { height: 50px; width: auto; display: block; }
  .cert-header-center {
    text-align: center;
    flex: 1;
    padding: 0 10px;
  }
  .cert-header-ministry {
    font-size: 13.5px;
    font-weight: 700;
    color: #045859;
    letter-spacing: 0.2px;
  }
  .cert-header-dept {
    font-size: 10.5px;
    color: #54565B;
    margin-top: 2px;
  }
  .cert-header-platform {
    font-size: 9.5px;
    color: #00A79D;
    font-weight: 700;
    margin-top: 2px;
    letter-spacing: 0.4px;
  }
  .cert-header-meta {
    flex-shrink: 0;
    text-align: left;
    font-size: 9.5px;
    color: #54565B;
    line-height: 1.7;
    min-width: 130px;
  }
  .cert-header-meta strong { color: #045859; }

  /* ── Document title bar ─────────── */
  .cert-title-bar {
    background: #045859;
    color: #fff;
    text-align: center;
    padding: 8px 20px 7px;
    border-radius: 6px;
    margin-bottom: 10px;
  }
  .cert-title-bar h1 {
    font-size: 16.5px;
    font-weight: 700;
    letter-spacing: 0.4px;
  }
  .cert-title-bar p {
    font-size: 9.5px;
    color: rgba(255,255,255,0.68);
    margin-top: 2px;
  }

  /* ── Approval banner ─────────────── */
  .approval-banner {
    display: flex;
    align-items: center;
    gap: 10px;
    background: #F0F7E0;
    border: 1.5px solid #87BA26;
    border-radius: 7px;
    padding: 7px 12px;
    margin-bottom: 10px;
  }
  .approval-banner .ab-icon { font-size: 20px; flex-shrink: 0; }
  .approval-banner h3 { font-size: 11.5px; font-weight: 700; color: #3A5A0A; }
  .approval-banner p  { font-size: 9.5px;  color: #54565B; margin-top: 1px; }

  /* ── Section heading ─────────────── */
  .section-heading {
    background: #E8F4F4;
    border-right: 4px solid #045859;
    padding: 4px 9px;
    font-size: 10.5px;
    font-weight: 700;
    color: #045859;
    margin-bottom: 7px;
    border-radius: 0 4px 4px 0;
  }

  /* ── Info grid ───────────────────── */
  .info-grid {
    display: grid;
    gap: 6px 12px;
    margin-bottom: 10px;
  }
  .info-grid.cols-2 { grid-template-columns: 1fr 1fr; }
  .info-grid.cols-3 { grid-template-columns: 1fr 1fr 1fr; }
  .info-grid.cols-4 { grid-template-columns: 1fr 1fr 1fr 1fr; }
  .info-cell label {
    display: block;
    font-size: 8.5px;
    color: #54565B;
    font-weight: 700;
    margin-bottom: 1px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .info-cell .val {
    font-size: 11px;
    font-weight: 700;
    color: #1A1A2E;
    border-bottom: 1px dashed #DDE2E8;
    padding-bottom: 2px;
    min-height: 17px;
    display: block;
  }
  .val.col-teal  { color: #045859; }
  .val.col-green { color: #3A5A0A; }

  /* ── Financial summary ───────────── */
  .fin-box {
    border: 1.5px solid #DDE2E8;
    border-radius: 7px;
    overflow: hidden;
    margin-bottom: 10px;
  }
  .fin-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 4.5px 12px;
    font-size: 10.5px;
    border-bottom: 1px solid #F0F2F4;
  }
  .fin-row:last-child { border-bottom: none; }
  .fin-row.hdr  { background: #045859; color: #fff; font-size: 11px; font-weight: 700; }
  .fin-row.sub  { background: #F7F8FA; }
  .fin-row.ded  { color: #C05728; }
  .fin-row.sep  { border-top: 2px dashed #DDE2E8; }
  .fin-row.sub-total { font-weight: 700; border-top: 1px solid #DDE2E8; }
  .fin-row.total-row {
    background: #F0F7E0;
    font-weight: 700;
    font-size: 12px;
    color: #3A5A0A;
    border-top: 2px solid #87BA26;
  }
  .fin-row .lbl { flex: 1; opacity: 0.9; }
  .fin-row .amt { font-weight: 700; font-variant-numeric: tabular-nums; flex-shrink: 0; padding-right: 2px; }
  .fin-row.total-row .amt { color: #3A5A0A; }
  .fin-row.ded .amt { color: #C05728; }

  /* ── Tables ──────────────────────── */
  .cert-table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-size: 9.5px;
    margin-bottom: 10px;
  }
  .cert-table th {
    background: #045859;
    color: #fff;
    padding: 5px 6px;
    text-align: right;
    font-weight: 700;
    font-size: 9px;
    white-space: nowrap;
    overflow: hidden;
  }
  .cert-table td {
    padding: 4px 6px;
    border-bottom: 1px solid #ECEEF1;
    vertical-align: middle;
    color: #1A1A2E;
    overflow: hidden;
    word-break: break-word;
  }
  .cert-table tr { page-break-inside: avoid; }
  .cert-table tr:nth-child(even) td { background: #F9FAFB; }
  .cert-table td.num {
    text-align: left;
    font-variant-numeric: tabular-nums;
    font-weight: 700;
    white-space: nowrap;
  }
  .cert-table td.ctr { text-align: center; }
  .cert-table tfoot td {
    background: #045859;
    color: #fff;
    font-weight: 700;
    padding: 5px 6px;
    font-size: 10px;
  }
  .cert-table tfoot td.num { text-align: left; }

  /* ── Workflow table ──────────────── */
  .wf-chip {
    display: inline-block;
    background: #E8F4F4;
    color: #045859;
    border-radius: 10px;
    padding: 1px 7px;
    font-size: 8.5px;
    font-weight: 700;
  }
  .wf-chip.approved { background: #F0F7E0; color: #3A5A0A; }

  /* ── Signature block ─────────────── */
  .sig-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr 1fr;
    gap: 10px;
    margin-top: 16px;
    margin-bottom: 8px;
  }
  .sig-block {
    border: 1px solid #DDE2E8;
    border-radius: 6px;
    padding: 9px 7px 7px;
    text-align: center;
    page-break-inside: avoid;
  }
  .sig-title {
    font-size: 9px;
    font-weight: 700;
    color: #045859;
    margin-bottom: 4px;
    border-bottom: 1px solid #E8F4F4;
    padding-bottom: 3px;
  }
  .sig-name {
    font-size: 10px;
    font-weight: 700;
    color: #1A1A2E;
    min-height: 16px;
    margin-bottom: 2px;
  }
  .sig-line {
    border-bottom: 1px solid #aaa;
    margin: 20px 6px 3px;
  }
  .sig-date-lbl {
    font-size: 8px;
    color: #54565B;
  }

  /* ── Notes box ───────────────────── */
  .notes-box {
    border: 1px solid #DDE2E8;
    border-radius: 6px;
    padding: 7px 11px;
    min-height: 36px;
    margin-bottom: 10px;
    font-size: 10.5px;
    color: #54565B;
    line-height: 1.5;
  }

  /* ── Footer ──────────────────────── */
  .cert-footer {
    position: absolute;
    bottom: 8mm;
    left: 16mm;
    right: 16mm;
    border-top: 1px solid #DDE2E8;
    padding-top: 4px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 7.5px;
    color: #aaa;
  }
  .cert-footer .seal {
    color: #87BA26;
    font-weight: 700;
    font-size: 8px;
  }

  /* ── Print instructions (screen only) ─ */
  .how-to-print {
    width: 210mm;
    margin: 0 auto 16px;
    background: #FFF8E0;
    border: 1.5px solid #FFC845;
    border-radius: 8px;
    padding: 10px 16px;
    direction: rtl;
    font-family: 'MasmakBHD','Tajawal',sans-serif;
  }
  .how-to-print h4 {
    font-size: 12px;
    font-weight: 700;
    color: #5A3D00;
    margin-bottom: 6px;
  }
  .how-to-print ol {
    margin: 0 18px 0 0;
    font-size: 10.5px;
    color: #54565B;
    line-height: 1.7;
  }
  .how-to-print li { margin-bottom: 1px; }
  .how-to-print strong { color: #1A1A2E; }
`;

// ── Page component ─────────────────────────────────────────────────

export default function CertificatePage() {
  const params   = useParams();
  const router   = useRouter();
  const claimId  = params.id as string;

  const [data,    setData]    = useState<CertificateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await loadCertificateData(claimId);
      setData(d);
    } catch (e) {
      setError((e as Error).message || 'تعذّر تحميل بيانات الشهادة');
    } finally {
      setLoading(false);
    }
  }, [claimId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = PRINT_STYLES;
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  if (loading) {
    return (
      <div style={{ display:'flex', justifyContent:'center', alignItems:'center', height:'100vh', fontFamily:'Tajawal,sans-serif', direction:'rtl' }}>
        <p style={{ color:'#045859', fontSize:16, fontWeight:700 }}>جاري تحميل الشهادة...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display:'flex', flexDirection:'column', justifyContent:'center', alignItems:'center', height:'100vh', gap:14, fontFamily:'Tajawal,sans-serif', direction:'rtl' }}>
        <span style={{ fontSize:38 }}>⚠️</span>
        <p style={{ color:'#C05728', fontWeight:700, fontSize:14, textAlign:'center', maxWidth:360 }}>{error}</p>
        <button onClick={() => router.back()} style={{ color:'#045859', fontWeight:700, cursor:'pointer', background:'none', border:'1.5px solid #045859', borderRadius:7, padding:'7px 20px', fontFamily:'Tajawal,sans-serif', fontSize:13 }}>
          ← العودة
        </button>
      </div>
    );
  }

  if (!data) return null;

  const { claim, contract, boqItems, staffItems, workflow, approvers, generatedAt } = data;

  const boqTotal   = boqItems.reduce((s, b) => s + b.afterPerf, 0);
  const staffTotal = staffItems.reduce((s, s2) => s + s2.afterPerf, 0);
  const claimLabel = `مطالبة رقم ${claim.claimNo}`;
  const contractTypeAr = CONTRACT_TYPE_AR[contract.type] || contract.type;
  const genDate    = fmtDateAr(generatedAt);
  const genDateSh  = fmtDateShort(generatedAt);

  return (
    <>
      {/* ── How-to-print guide (screen only) ─ */}
      <div className="how-to-print screen-only">
        <h4>📋 كيفية حفظ الشهادة كملف PDF</h4>
        <ol>
          <li>اضغط زر <strong>«🖨 طباعة / حفظ PDF»</strong> أدناه — أو اضغط <strong>Ctrl+P</strong> (Windows/Linux) أو <strong>⌘+P</strong> (Mac)</li>
          <li>في نافذة الطباعة، غيّر <strong>«الوجهة / Destination»</strong> إلى <strong>«Save as PDF / حفظ كـ PDF»</strong></li>
          <li>تأكد أن حجم الورق <strong>A4</strong> وأن الاتجاه <strong>عمودي (Portrait)</strong></li>
          <li>ضمن «المزيد من الإعدادات»: فعّل <strong>«الرسومات الخلفية / Background graphics»</strong> للحفاظ على الألوان</li>
          <li>اضغط <strong>«Save / حفظ»</strong> واختر مكان الحفظ</li>
        </ol>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          DOCUMENT 1 — شهادة الإنجاز  (Completion Certificate)
      ═══════════════════════════════════════════════════════════ */}
      <div className="cert-page">
        <CertHeader
          claimNo={claim.claimNo}
          referenceNo={claim.referenceNo}
          generatedDateShort={genDateSh}
        />

        <div className="cert-title-bar">
          <h1>شهادة إنجاز</h1>
          <p>Completion Certificate — إدارة التطوير والتأهيل | وزارة البلديات والإسكان</p>
        </div>

        {/* Approval confirmation banner */}
        <div className="approval-banner">
          <div className="ab-icon">✅</div>
          <div>
            <h3>اعتُمدت هذه المطالبة بموافقة مدير الإدارة</h3>
            <p>
              تاريخ الاعتماد: {fmtDateAr(claim.approvedAt)}
              {claim.referenceNo ? ` — المرجع: ${claim.referenceNo}` : ''}
            </p>
          </div>
        </div>

        {/* Contract info */}
        <div className="section-heading">بيانات العقد</div>
        <div className="info-grid cols-2">
          <div className="info-cell">
            <label>رقم العقد</label>
            <span className="val col-teal">{contract.contractNo}</span>
          </div>
          <div className="info-cell">
            <label>نوع العقد</label>
            <span className="val">{contractTypeAr}</span>
          </div>
          <div className="info-cell">
            <label>اسم المشروع</label>
            <span className="val">{contract.titleAr}</span>
          </div>
          <div className="info-cell">
            <label>اسم المقاول / المستشار</label>
            <span className="val">{contract.partyNameAr}</span>
          </div>
          <div className="info-cell">
            <label>تاريخ بداية العقد</label>
            <span className="val">{fmtDateAr(contract.startDate)}</span>
          </div>
          <div className="info-cell">
            <label>تاريخ نهاية العقد</label>
            <span className="val">{fmtDateAr(contract.endDate)}</span>
          </div>
          {contract.partyTaxNo && (
            <div className="info-cell">
              <label>الرقم الضريبي</label>
              <span className="val">{contract.partyTaxNo}</span>
            </div>
          )}
          {contract.region && (
            <div className="info-cell">
              <label>المنطقة</label>
              <span className="val">{contract.region}</span>
            </div>
          )}
        </div>

        {/* Claim period info */}
        <div className="section-heading">بيانات المطالبة</div>
        <div className="info-grid cols-4">
          <div className="info-cell">
            <label>رقم المطالبة</label>
            <span className="val col-teal">{claim.claimNo}</span>
          </div>
          <div className="info-cell">
            <label>الرقم المرجعي</label>
            <span className="val">{claim.referenceNo || '—'}</span>
          </div>
          <div className="info-cell">
            <label>الفترة من</label>
            <span className="val">{fmtDateAr(claim.periodFrom)}</span>
          </div>
          <div className="info-cell">
            <label>الفترة إلى</label>
            <span className="val">{fmtDateAr(claim.periodTo)}</span>
          </div>
          <div className="info-cell">
            <label>تاريخ الفاتورة</label>
            <span className="val">{fmtDateAr(claim.invoiceDate)}</span>
          </div>
          <div className="info-cell">
            <label>تاريخ التقديم</label>
            <span className="val">{fmtDateAr(claim.submittedAt)}</span>
          </div>
          <div className="info-cell">
            <label>تاريخ الاعتماد</label>
            <span className="val col-green">{fmtDateAr(claim.approvedAt)}</span>
          </div>
          <div className="info-cell">
            <label>تاريخ إصدار الشهادة</label>
            <span className="val">{genDate}</span>
          </div>
        </div>

        {/* Financial summary (compact — for certificate doc) */}
        <div className="section-heading">الملخص المالي</div>
        <FinancialSummary claim={claim} />

        {/* Submission notes */}
        {claim.submissionNotes && (
          <>
            <div className="section-heading">ملاحظات التقديم</div>
            <div className="notes-box">{claim.submissionNotes}</div>
          </>
        )}

        {/* Signature blocks */}
        <div className="section-heading">التوقيعات والاعتماد</div>
        <SignatureBlocks approvers={approvers} approvedAt={claim.approvedAt} />

        <CertFooter claimLabel={claimLabel} generatedAt={generatedAt} page={1} totalPages={2} />
      </div>

      {/* ═══════════════════════════════════════════════════════════
          DOCUMENT 2 — استمارة المراجعة والتدقيق  (Audit / Review Form)
      ═══════════════════════════════════════════════════════════ */}
      <div className="cert-page">
        <CertHeader
          claimNo={claim.claimNo}
          referenceNo={claim.referenceNo}
          generatedDateShort={genDateSh}
        />

        <div className="cert-title-bar">
          <h1>استمارة المراجعة والتدقيق</h1>
          <p>Audit &amp; Review Form — {contract.contractNo} | {claimLabel}</p>
        </div>

        {/* Contract + Claim snapshot */}
        <div className="section-heading">مرجع العقد والمطالبة</div>
        <div className="info-grid cols-4">
          <div className="info-cell">
            <label>رقم العقد</label>
            <span className="val col-teal">{contract.contractNo}</span>
          </div>
          <div className="info-cell">
            <label>المقاول / المستشار</label>
            <span className="val">{contract.partyNameAr}</span>
          </div>
          <div className="info-cell">
            <label>رقم المطالبة</label>
            <span className="val col-teal">{claim.claimNo}</span>
          </div>
          <div className="info-cell">
            <label>الحالة</label>
            <span className="val col-green">معتمدة ✓</span>
          </div>
          <div className="info-cell">
            <label>الفترة من</label>
            <span className="val">{fmtDateAr(claim.periodFrom)}</span>
          </div>
          <div className="info-cell">
            <label>الفترة إلى</label>
            <span className="val">{fmtDateAr(claim.periodTo)}</span>
          </div>
          <div className="info-cell">
            <label>تاريخ الاعتماد</label>
            <span className="val col-green">{fmtDateAr(claim.approvedAt)}</span>
          </div>
        </div>

        {/* BOQ items */}
        {boqItems.length > 0 && (
          <>
            <div className="section-heading">جدول كميات الأعمال (BOQ)</div>
            <BOQTable items={boqItems} total={boqTotal} />
          </>
        )}

        {/* Staff items */}
        {staffItems.length > 0 && (
          <>
            <div className="section-heading">الكوادر البشرية</div>
            <StaffTable items={staffItems} total={staffTotal} />
          </>
        )}

        {/* Full financial summary */}
        <div className="section-heading">الملخص المالي التفصيلي</div>
        <FinancialSummaryFull claim={claim} contract={contract} />

        {/* Workflow history */}
        <div className="section-heading">سجل مراحل الاعتماد</div>
        <WorkflowTable workflow={workflow} />

        {/* Signatures */}
        <div className="section-heading">اعتماد الاستمارة</div>
        <SignatureBlocks approvers={approvers} approvedAt={claim.approvedAt} />

        <CertFooter claimLabel={claimLabel} generatedAt={generatedAt} page={2} totalPages={2} />
      </div>

      {/* ── Persistent bottom bar (screen only) ─────────────────── */}
      <div className="print-controls-bar">
        <button className="btn-back" onClick={() => router.back()}>
          ← رجوع
        </button>
        <span className="print-how">
          بعد الضغط على الطباعة، غيّر الوجهة إلى{' '}
          <strong>«حفظ كـ PDF»</strong> وفعّل{' '}
          <strong>«الرسومات الخلفية»</strong>
        </span>
        <button className="btn-print" onClick={() => window.print()}>
          🖨 طباعة / حفظ PDF
        </button>
      </div>
    </>
  );
}

// ── Sub-components ─────────────────────────────────────────────────

function CertHeader({ claimNo, referenceNo, generatedDateShort }: {
  claimNo: number;
  referenceNo: string | null;
  generatedDateShort: string;
}) {
  return (
    <div className="cert-header">
      <div className="cert-header-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/momah-logo-color.svg" alt="شعار وزارة البلديات والإسكان" />
      </div>
      <div className="cert-header-center">
        <div className="cert-header-ministry">المملكة العربية السعودية — وزارة البلديات والإسكان</div>
        <div className="cert-header-dept">إدارة التطوير والتأهيل</div>
        <div className="cert-header-platform">CONVERA — منصة حوكمة العقود والمستخلصات</div>
      </div>
      <div className="cert-header-meta">
        <div>رقم المطالبة: <strong>#{claimNo}</strong></div>
        {referenceNo && <div>المرجع: <strong>{referenceNo}</strong></div>}
        <div>تاريخ الإصدار: <strong>{generatedDateShort}</strong></div>
      </div>
    </div>
  );
}

/**
 * Compact financial summary — Document 1 (شهادة الإنجاز)
 *
 * Current operating model: NO per-claim retention deduction.
 * Chain: BOQ → Staff → Gross → VAT (15% of gross) → Approved Total
 *
 * Fields NOT shown (removed — belong to final-settlement flow):
 *   حجز ختامي (retention_amount)
 *   صافي (net_amount = gross − retention)
 *   مستحق نهائي based on net
 */
function FinancialSummary({ claim }: {
  claim: CertificateData['claim'];
}) {
  return (
    <div className="fin-box">
      <div className="fin-row hdr">
        <span className="lbl">البيان</span>
        <span className="amt">المبلغ (ريال سعودي)</span>
      </div>
      <div className="fin-row">
        <span className="lbl">إجمالي أعمال المستخلص (BOQ)</span>
        <span className="amt">{fmtMoney(claim.boqAmount)}</span>
      </div>
      <div className="fin-row">
        <span className="lbl">إجمالي الكوادر البشرية</span>
        <span className="amt">{fmtMoney(claim.staffAmount)}</span>
      </div>
      <div className="fin-row sub-total">
        <span className="lbl">المجموع الإجمالي للمستخلص (قبل الضريبة)</span>
        <span className="amt">{fmtMoney(claim.grossAmount)}</span>
      </div>
      <div className="fin-row">
        <span className="lbl">ضريبة القيمة المضافة (١٥٪)</span>
        <span className="amt">{fmtMoney(claim.vatAmount)}</span>
      </div>
      <div className="fin-row total-row">
        <span className="lbl">الإجمالي المعتمد للصرف (شامل الضريبة)</span>
        <span className="amt">{fmtMoney(claim.approvedTotal)}</span>
      </div>
    </div>
  );
}

/**
 * Full financial summary — Document 2 (استمارة المراجعة والتدقيق)
 *
 * Shows contract reference values + claim financials.
 * Current operating model: NO per-claim retention.
 * Chain (claim): BOQ → Staff → Gross → VAT (15%) → Approved Total
 *
 * Fields NOT shown (removed — belong to final-settlement flow):
 *   حجز ختامي | صافي | مستحق نهائي (net-based)
 */
function FinancialSummaryFull({ claim, contract }: {
  claim: CertificateData['claim'];
  contract: CertificateData['contract'];
}) {
  return (
    <div className="fin-box">
      <div className="fin-row hdr">
        <span className="lbl">البيان</span>
        <span className="amt">المبلغ (ريال سعودي)</span>
      </div>

      {/* ── Contract reference values ── */}
      <div className="fin-row sub" style={{ color:'#54565B', fontSize:'9px' }}>
        <span className="lbl">◂ مرجع: قيم العقد</span>
        <span></span>
      </div>
      <div className="fin-row">
        <span className="lbl">قيمة العقد الأساسية (قبل الضريبة)</span>
        <span className="amt">{fmtMoney(contract.baseValue)}</span>
      </div>
      <div className="fin-row">
        <span className="lbl">ضريبة القيمة المضافة على العقد (١٥٪)</span>
        <span className="amt">{fmtMoney(contract.vatValue)}</span>
      </div>
      <div className="fin-row sub-total">
        <span className="lbl">إجمالي قيمة العقد (شامل الضريبة)</span>
        <span className="amt">{fmtMoney(contract.totalValue)}</span>
      </div>

      {/* ── Claim financials ── */}
      <div className="fin-row sep sub" style={{ color:'#54565B', fontSize:'9px' }}>
        <span className="lbl">◂ قيم المستخلص المعتمد</span>
        <span></span>
      </div>
      <div className="fin-row">
        <span className="lbl">إجمالي أعمال المستخلص (BOQ — بعد نسبة الأداء)</span>
        <span className="amt">{fmtMoney(claim.boqAmount)}</span>
      </div>
      <div className="fin-row">
        <span className="lbl">إجمالي الكوادر البشرية (بعد نسبة الأداء)</span>
        <span className="amt">{fmtMoney(claim.staffAmount)}</span>
      </div>
      <div className="fin-row sub-total">
        <span className="lbl">المجموع الإجمالي للمستخلص (قبل الضريبة)</span>
        <span className="amt">{fmtMoney(claim.grossAmount)}</span>
      </div>
      <div className="fin-row">
        <span className="lbl">ضريبة القيمة المضافة (١٥٪)</span>
        <span className="amt">{fmtMoney(claim.vatAmount)}</span>
      </div>
      <div className="fin-row total-row">
        <span className="lbl">الإجمالي المعتمد للصرف (شامل الضريبة)</span>
        <span className="amt">{fmtMoney(claim.approvedTotal)}</span>
      </div>
    </div>
  );
}

/** BOQ items table with 9 fixed-width columns */
function BOQTable({ items, total }: { items: CertBOQItem[]; total: number }) {
  return (
    <table className="cert-table">
      <colgroup>
        <col style={{ width: '5%' }} />
        <col style={{ width: '30%' }} />
        <col style={{ width: '7%' }} />
        <col style={{ width: '10%' }} />
        <col style={{ width: '9%' }} />
        <col style={{ width: '9%' }} />
        <col style={{ width: '11%' }} />
        <col style={{ width: '8%' }} />
        <col style={{ width: '11%' }} />
      </colgroup>
      <thead>
        <tr>
          <th>#</th>
          <th>الوصف</th>
          <th style={{ textAlign:'center' }}>الوحدة</th>
          <th style={{ textAlign:'left' }}>سعر الوحدة</th>
          <th style={{ textAlign:'center' }}>الكمية التعاق.</th>
          <th style={{ textAlign:'center' }}>الإنجاز</th>
          <th style={{ textAlign:'left' }}>مبلغ الفترة</th>
          <th style={{ textAlign:'center' }}>الأداء٪</th>
          <th style={{ textAlign:'left' }}>بعد الأداء</th>
        </tr>
      </thead>
      <tbody>
        {items.map(item => (
          <tr key={item.itemNo}>
            <td className="ctr">{item.itemNo}</td>
            <td>{item.descriptionAr}</td>
            <td className="ctr">{item.unit}</td>
            <td className="num">{fmtMoney(item.unitPrice)}</td>
            <td className="ctr">{item.contractualQty}</td>
            <td className="ctr">{item.currProgress}</td>
            <td className="num">{fmtMoney(item.periodAmount)}</td>
            <td className="ctr">{item.performancePct}٪</td>
            <td className="num">{fmtMoney(item.afterPerf)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={8}>إجمالي الأعمال (بعد نسبة الأداء)</td>
          <td className="num">{fmtMoney(total)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

/**
 * Staff items table — full breakdown:
 * Monthly Rate | Days | Basic Amount | OT Hours | OT Amount | Pre-Perf Total | Perf% | After Perf
 *
 * Formula (per CLAUDE.md §6.2):
 *   basic_amount = (working_days / 30) × monthly_rate
 *   extra_amount = (monthly_rate / 192) × 1.5 × overtime_hours
 *   total_amount = basic_amount + extra_amount
 *   after_perf   = total_amount × (performance_pct / 100)
 */
function StaffTable({ items, total }: { items: CertStaffItem[]; total: number }) {
  return (
    <table className="cert-table">
      <colgroup>
        <col style={{ width: '5%' }} />
        <col style={{ width: '22%' }} />
        <col style={{ width: '11%' }} />
        <col style={{ width: '8%' }} />
        <col style={{ width: '11%' }} />
        <col style={{ width: '7%' }} />
        <col style={{ width: '10%' }} />
        <col style={{ width: '11%' }} />
        <col style={{ width: '7%' }} />
        <col style={{ width: '8%' }} />
      </colgroup>
      <thead>
        <tr>
          <th>#</th>
          <th>المسمى الوظيفي</th>
          <th style={{ textAlign:'left' }}>الراتب الشهري</th>
          <th style={{ textAlign:'center' }}>أيام</th>
          <th style={{ textAlign:'left' }}>المبلغ الأساسي</th>
          <th style={{ textAlign:'center' }}>OT ساعات</th>
          <th style={{ textAlign:'left' }}>مبلغ الإضافي</th>
          <th style={{ textAlign:'left' }}>المجموع قبل الأداء</th>
          <th style={{ textAlign:'center' }}>الأداء٪</th>
          <th style={{ textAlign:'left' }}>بعد الأداء</th>
        </tr>
      </thead>
      <tbody>
        {items.map(item => (
          <tr key={item.itemNo}>
            <td className="ctr">{item.itemNo}</td>
            <td>{item.positionAr}</td>
            <td className="num">{fmtMoney(item.monthlyRate)}</td>
            <td className="ctr">{item.workingDays}</td>
            <td className="num">{fmtMoney(item.basicAmount)}</td>
            <td className="ctr">{item.overtimeHours > 0 ? item.overtimeHours : '—'}</td>
            <td className="num">{item.extraAmount > 0 ? fmtMoney(item.extraAmount) : '—'}</td>
            <td className="num">{fmtMoney(item.totalAmount)}</td>
            <td className="ctr">{item.performancePct}٪</td>
            <td className="num">{fmtMoney(item.afterPerf)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={9}>إجمالي الكوادر (بعد نسبة الأداء)</td>
          <td className="num">{fmtMoney(total)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

function WorkflowTable({ workflow }: { workflow: CertWorkflowStep[] }) {
  if (!workflow.length) {
    return <p style={{ fontSize:10, color:'#54565B', marginBottom:10 }}>لا يوجد سجل إجراءات</p>;
  }
  return (
    <table className="cert-table">
      <colgroup>
        <col style={{ width: '19%' }} />
        <col style={{ width: '18%' }} />
        <col style={{ width: '18%' }} />
        <col style={{ width: '12%' }} />
        <col style={{ width: '17%' }} />
        <col style={{ width: '16%' }} />
      </colgroup>
      <thead>
        <tr>
          <th>التاريخ</th>
          <th>الإجراء</th>
          <th>المنفّذ</th>
          <th>الدور</th>
          <th>من الحالة</th>
          <th>إلى الحالة</th>
        </tr>
      </thead>
      <tbody>
        {workflow.map((step, i) => (
          <tr key={i}>
            <td style={{ fontSize:8.5 }}>{fmtDateAr(step.createdAt)}</td>
            <td style={{ fontWeight:700 }}>{ACTION_LABEL[step.action] || step.action}</td>
            <td>{step.actorName || '—'}</td>
            <td>{step.actorRole ? (ROLE_LABEL[step.actorRole] || step.actorRole) : '—'}</td>
            <td>
              {step.fromStatus ? (
                <span className="wf-chip">{STATUS_LABEL[step.fromStatus] || step.fromStatus}</span>
              ) : '—'}
            </td>
            <td>
              {step.toStatus ? (
                <span className={`wf-chip${step.toStatus === 'approved' ? ' approved' : ''}`}>
                  {STATUS_LABEL[step.toStatus] || step.toStatus}
                </span>
              ) : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SignatureBlocks({ approvers, approvedAt }: {
  approvers: CertificateData['approvers'];
  approvedAt: string | null;
}) {
  const blocks = [
    { title: 'المقاول / المستشار',  name: approvers.contractorName },
    { title: 'المدقق (مدقق الإدارة)', name: approvers.auditorName },
    { title: 'المراجع',              name: approvers.reviewerName },
    { title: 'مدير الإدارة',         name: approvers.directorName },
  ];

  return (
    <div className="sig-grid">
      {blocks.map((b, i) => (
        <div key={i} className="sig-block">
          <div className="sig-title">{b.title}</div>
          <div className="sig-name">{b.name || '—'}</div>
          <div className="sig-line" />
          <div className="sig-date-lbl">
            {i === 3 && approvedAt ? fmtDateShort(approvedAt) : 'التوقيع والتاريخ'}
          </div>
        </div>
      ))}
    </div>
  );
}

function CertFooter({ claimLabel, generatedAt, page, totalPages }: {
  claimLabel: string;
  generatedAt: string;
  page: number;
  totalPages: number;
}) {
  const genStr = new Date(generatedAt).toLocaleString('ar-SA', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
  return (
    <div className="cert-footer">
      <div className="seal">✦ CONVERA | وزارة البلديات والإسكان — سري للاستخدام الداخلي</div>
      <div style={{ textAlign:'center' }}>
        {claimLabel} — صفحة {page} من {totalPages}
      </div>
      <div style={{ textAlign:'left' }}>
        أُصدرت: {genStr}
      </div>
    </div>
  );
}
