/**
 * CONVERA Certificate Generation Service
 * Generates immutable PDFs for completion certificates and audit review forms
 * Uploads to Supabase Storage and tracks in database
 */

import { createBrowserSupabase } from '@/lib/supabase';
import type { GeneratedCertificate } from '@/lib/types';
import { friendlyError } from '@/lib/errors';

// ─── Type Definitions ────────────────────────────────────────────

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  success: boolean;
}

function createResponse<T>(data: T | undefined, error?: string): ApiResponse<T> {
  return { data: data as T, error, success: !error };
}

function createErrorResponse<T>(error: string): ApiResponse<T> {
  return { data: undefined as unknown as T, error, success: false };
}

interface CertificateData {
  claimId: string;
  claimNo: number;
  contractNo: string;
  contractTitle: string;
  companyName: string;
  companyNationalId: string;
  paymentNo: string;
  invoiceDate: string;
  executionPeriod: string;
  totalAmount: number;
  totalAmountAr: string;
  boqAmount: number;
  staffAmount: number;
  retentionAmount: number;
  vatAmount: number;
  approvedDate: string;
  approvedBy: string;
}

// ─── Helper: Convert number to Arabic words ──────────────────────

function numberToArabicWords(num: number): string {
  const ones = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'];
  const tens = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
  const hundreds = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];
  const teens = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];

  if (num === 0) return 'صفر';

  let result = '';
  const billionPart = Math.floor(num / 1000000000);
  const millionPart = Math.floor((num % 1000000000) / 1000000);
  const thousandPart = Math.floor((num % 1000000) / 1000);
  const remainingPart = num % 1000;

  if (billionPart > 0) result += convertHundreds(billionPart) + ' مليار ';
  if (millionPart > 0) result += convertHundreds(millionPart) + ' مليون ';
  if (thousandPart > 0) result += convertHundreds(thousandPart) + ' ألف ';
  if (remainingPart > 0) result += convertHundreds(remainingPart);

  return result.trim();

  function convertHundreds(n: number): string {
    if (n === 0) return '';
    const h = Math.floor(n / 100);
    const t = Math.floor((n % 100) / 10);
    const o = n % 10;

    let result = '';
    if (h > 0) result += hundreds[h] + ' ';
    if (t === 1) {
      result += teens[o];
    } else {
      if (t > 0) result += tens[t] + ' ';
      if (o > 0) result += ones[o];
    }
    return result.trim();
  }
}

// ─── SVG/HTML-based PDF generation (lightweight alternative) ─────

/**
 * Generate HTML content for completion certificate
 * This can be rendered and printed to PDF by browser or backend
 */
function generateCompletionCertificateHTML(data: CertificateData): string {
  const today = new Date().toLocaleDateString('ar-SA');
  const logoUrl = '/logo.svg'; // Ministry logo

  return `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>شهادة إتمام المطالبة</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Tajawal', 'Arial', sans-serif;
      direction: rtl;
      padding: 40px;
      background-color: #FFFFFF;
    }
    .certificate {
      max-width: 800px;
      margin: 0 auto;
      border: 3px solid #045859;
      padding: 40px;
      text-align: center;
      background-color: #FFFFFF;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 2px solid #045859;
    }
    .logo {
      height: 60px;
    }
    .ministry-info {
      text-align: right;
      flex: 1;
    }
    .ministry-name {
      font-size: 18px;
      font-weight: bold;
      color: #045859;
      margin-bottom: 4px;
    }
    .ministry-sub {
      font-size: 14px;
      color: #54565B;
    }
    .title {
      font-size: 24px;
      font-weight: bold;
      color: #045859;
      margin: 30px 0;
      text-decoration: underline;
    }
    .section {
      text-align: right;
      margin: 20px 0;
    }
    .section-title {
      font-size: 16px;
      font-weight: bold;
      color: #045859;
      margin-bottom: 12px;
      border-bottom: 1px solid #DDE2E8;
      padding-bottom: 8px;
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      padding: 10px 0;
      font-size: 14px;
    }
    .info-label {
      font-weight: bold;
      color: #1A1A2E;
    }
    .info-value {
      color: #54565B;
    }
    .amount-box {
      background-color: #F7F8FA;
      border: 2px solid #87BA26;
      padding: 20px;
      margin: 20px 0;
      border-radius: 8px;
      text-align: center;
    }
    .amount-number {
      font-size: 28px;
      font-weight: bold;
      color: #045859;
      margin: 10px 0;
    }
    .amount-words {
      font-size: 14px;
      color: #54565B;
      margin: 10px 0;
    }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 2px solid #045859;
    }
    .signature-row {
      display: flex;
      justify-content: space-between;
      margin-top: 40px;
    }
    .signature-block {
      text-align: center;
      width: 200px;
    }
    .signature-line {
      border-top: 1px solid #1A1A2E;
      margin-top: 60px;
      padding-top: 8px;
      font-size: 12px;
    }
    .date {
      text-align: center;
      margin-top: 30px;
      font-size: 12px;
      color: #54565B;
    }
  </style>
</head>
<body>
  <div class="certificate">
    <!-- Header with Logo -->
    <div class="header">
      <div class="ministry-info">
        <div class="ministry-name">وزارة البلديات والإسكان</div>
        <div class="ministry-sub">إدارة التطوير والتأهيل</div>
      </div>
      <img src="${logoUrl}" alt="وزارة البلديات والإسكان" class="logo">
    </div>

    <!-- Certificate Title -->
    <div class="title">شهادة إتمام المطالبة المالية</div>

    <!-- Contract Information -->
    <div class="section">
      <div class="section-title">معلومات العقد</div>
      <div class="info-row">
        <span class="info-label">رقم العقد:</span>
        <span class="info-value">${data.contractNo}</span>
      </div>
      <div class="info-row">
        <span class="info-label">عنوان العقد:</span>
        <span class="info-value">${data.contractTitle}</span>
      </div>
      <div class="info-row">
        <span class="info-label">اسم الشركة:</span>
        <span class="info-value">${data.companyName}</span>
      </div>
      <div class="info-row">
        <span class="info-label">الرقم الضريبي:</span>
        <span class="info-value">${data.companyNationalId}</span>
      </div>
    </div>

    <!-- Claim Information -->
    <div class="section">
      <div class="section-title">معلومات المطالبة</div>
      <div class="info-row">
        <span class="info-label">رقم المطالبة:</span>
        <span class="info-value">${data.claimNo}</span>
      </div>
      <div class="info-row">
        <span class="info-label">رقم الدفعة:</span>
        <span class="info-value">${data.paymentNo}</span>
      </div>
      <div class="info-row">
        <span class="info-label">تاريخ الفاتورة:</span>
        <span class="info-value">${data.invoiceDate}</span>
      </div>
      <div class="info-row">
        <span class="info-label">فترة التنفيذ:</span>
        <span class="info-value">${data.executionPeriod}</span>
      </div>
    </div>

    <!-- Amount Section -->
    <div class="amount-box">
      <div>المبلغ المعتمد</div>
      <div class="amount-number">ر.س ${data.totalAmount.toLocaleString('ar-SA')}</div>
      <div class="amount-words">${numberToArabicWords(data.totalAmount)} ريال سعودي</div>
    </div>

    <!-- Financial Breakdown -->
    <div class="section">
      <div class="section-title">تفصيل المبلغ</div>
      <div class="info-row">
        <span class="info-label">بنود العقد:</span>
        <span class="info-value">ر.س ${data.boqAmount.toLocaleString('ar-SA')}</span>
      </div>
      <div class="info-row">
        <span class="info-label">بدلات الموظفين:</span>
        <span class="info-value">ر.س ${data.staffAmount.toLocaleString('ar-SA')}</span>
      </div>
      <div class="info-row">
        <span class="info-label">خصم الضمان:</span>
        <span class="info-value">ر.س ${data.retentionAmount.toLocaleString('ar-SA')}</span>
      </div>
      <div class="info-row">
        <span class="info-label">ضريبة القيمة المضافة:</span>
        <span class="info-value">ر.س ${data.vatAmount.toLocaleString('ar-SA')}</span>
      </div>
    </div>

    <!-- Approval Information -->
    <div class="section">
      <div class="info-row">
        <span class="info-label">تاريخ الاعتماد:</span>
        <span class="info-value">${data.approvedDate}</span>
      </div>
      <div class="info-row">
        <span class="info-label">معتمد من:</span>
        <span class="info-value">${data.approvedBy}</span>
      </div>
    </div>

    <!-- Signatures -->
    <div class="signature-row">
      <div class="signature-block">
        <div class="signature-line">مدير مشروع الإشراف</div>
      </div>
      <div class="signature-block">
        <div class="signature-line">الجهة المنفذة</div>
      </div>
    </div>

    <!-- Date -->
    <div class="date">${today}</div>
  </div>
</body>
</html>
  `;
}

/**
 * Generate HTML content for audit/review form
 */
function generateAuditReviewFormHTML(data: CertificateData): string {
  const today = new Date().toLocaleDateString('ar-SA');
  const logoUrl = '/logo.svg';

  return `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>نموذج التدقيق والمراجعة</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Tajawal', 'Arial', sans-serif;
      direction: rtl;
      padding: 40px;
      background-color: #FFFFFF;
    }
    .form {
      max-width: 800px;
      margin: 0 auto;
      border: 2px solid #045859;
      padding: 30px;
      background-color: #FFFFFF;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 25px;
      padding-bottom: 15px;
      border-bottom: 2px solid #045859;
    }
    .logo {
      height: 50px;
    }
    .ministry-info {
      text-align: right;
      flex: 1;
    }
    .ministry-name {
      font-size: 16px;
      font-weight: bold;
      color: #045859;
    }
    .ministry-sub {
      font-size: 12px;
      color: #54565B;
    }
    .title {
      font-size: 20px;
      font-weight: bold;
      color: #045859;
      margin: 20px 0;
      text-align: center;
      text-decoration: underline;
    }
    .section {
      margin: 20px 0;
      padding: 15px;
      background-color: #F7F8FA;
      border-right: 4px solid #87BA26;
    }
    .section-title {
      font-size: 14px;
      font-weight: bold;
      color: #045859;
      margin-bottom: 12px;
    }
    .form-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      font-size: 13px;
    }
    .form-label {
      font-weight: bold;
      color: #1A1A2E;
      flex: 1;
    }
    .form-value {
      color: #54565B;
      flex: 1;
      text-align: left;
    }
    .checkbox-section {
      margin: 15px 0;
      padding: 10px;
      background-color: #FFFFFF;
      border: 1px solid #DDE2E8;
    }
    .checkbox-item {
      display: flex;
      align-items: center;
      padding: 8px 0;
      font-size: 13px;
    }
    .checkbox {
      width: 20px;
      height: 20px;
      border: 2px solid #045859;
      margin-left: 12px;
      flex-shrink: 0;
    }
    .notes-section {
      margin: 20px 0;
      padding: 15px;
      border: 1px solid #DDE2E8;
      background-color: #FFFFFF;
      min-height: 100px;
    }
    .notes-label {
      font-weight: bold;
      color: #045859;
      margin-bottom: 10px;
    }
    .signature-row {
      display: flex;
      justify-content: space-between;
      margin-top: 40px;
    }
    .signature-block {
      text-align: center;
      width: 200px;
    }
    .signature-line {
      border-top: 1px solid #1A1A2E;
      margin-top: 60px;
      padding-top: 8px;
      font-size: 12px;
    }
    .date {
      text-align: center;
      margin-top: 30px;
      font-size: 12px;
      color: #54565B;
    }
  </style>
</head>
<body>
  <div class="form">
    <!-- Header -->
    <div class="header">
      <div class="ministry-info">
        <div class="ministry-name">وزارة البلديات والإسكان</div>
        <div class="ministry-sub">إدارة التطوير والتأهيل</div>
      </div>
      <img src="${logoUrl}" alt="وزارة البلديات والإسكان" class="logo">
    </div>

    <!-- Title -->
    <div class="title">نموذج التدقيق والمراجعة</div>

    <!-- Claim Information -->
    <div class="section">
      <div class="section-title">معلومات المطالبة</div>
      <div class="form-row">
        <span class="form-label">رقم المطالبة:</span>
        <span class="form-value">${data.claimNo}</span>
      </div>
      <div class="form-row">
        <span class="form-label">رقم العقد:</span>
        <span class="form-value">${data.contractNo}</span>
      </div>
      <div class="form-row">
        <span class="form-label">اسم المقاول:</span>
        <span class="form-value">${data.companyName}</span>
      </div>
      <div class="form-row">
        <span class="form-label">المبلغ الإجمالي:</span>
        <span class="form-value">ر.س ${data.totalAmount.toLocaleString('ar-SA')}</span>
      </div>
    </div>

    <!-- Audit Checklist -->
    <div class="section">
      <div class="section-title">قائمة التدقيق</div>
      <div class="checkbox-section">
        <div class="checkbox-item">
          <div class="checkbox"></div>
          <span>التحقق من صحة الوثائق والفواتير المرفقة</span>
        </div>
        <div class="checkbox-item">
          <div class="checkbox"></div>
          <span>التحقق من توافق المطالبة مع شروط العقد</span>
        </div>
        <div class="checkbox-item">
          <div class="checkbox"></div>
          <span>التحقق من عدم تجاوز حدود الميزانية المقررة</span>
        </div>
        <div class="checkbox-item">
          <div class="checkbox"></div>
          <span>التحقق من الحسابات والنسب المئوية</span>
        </div>
        <div class="checkbox-item">
          <div class="checkbox"></div>
          <span>التحقق من عدم تكرار المطالبة السابقة</span>
        </div>
        <div class="checkbox-item">
          <div class="checkbox"></div>
          <span>التحقق من توافق منصة اعتماد</span>
        </div>
      </div>
    </div>

    <!-- Notes Section -->
    <div class="notes-section">
      <div class="notes-label">ملاحظات التدقيق:</div>
      <div style="min-height: 80px; border: 1px solid #DDE2E8; padding: 10px;"></div>
    </div>

    <!-- Recommendation -->
    <div class="section">
      <div class="section-title">التوصية</div>
      <div class="checkbox-section">
        <div class="checkbox-item">
          <div class="checkbox"></div>
          <span>الموافقة على المطالبة</span>
        </div>
        <div class="checkbox-item">
          <div class="checkbox"></div>
          <span>الموافقة مع ملاحظات</span>
        </div>
        <div class="checkbox-item">
          <div class="checkbox"></div>
          <span>إعادة المطالبة للتصحيح</span>
        </div>
        <div class="checkbox-item">
          <div class="checkbox"></div>
          <span>الرفض</span>
        </div>
      </div>
    </div>

    <!-- Signatures -->
    <div class="signature-row">
      <div class="signature-block">
        <div class="signature-line">المراجع</div>
      </div>
      <div class="signature-block">
        <div class="signature-line">المدقق</div>
      </div>
    </div>

    <!-- Date -->
    <div class="date">${today}</div>
  </div>
</body>
</html>
  `;
}

// ─── Certificate Generation & Storage ────────────────────────────

/**
 * Generate completion certificate PDF
 * Converts HTML to PDF and uploads to Supabase Storage as immutable file
 */
export async function generateCompletionCertificate(
  claimId: string,
  actorId: string,
): Promise<ApiResponse<GeneratedCertificate>> {
  try {
    const supabase = createBrowserSupabase();

    // Fetch claim details
    const { data: claim, error: claimErr } = await supabase
      .from('claims')
      .select(
        `
        id, claim_no, contract_id, boq_amount, staff_amount,
        retention_amount, vat_amount, total_amount, approved_at,
        approved_by, period_from, period_to,
        contracts(
          contract_no, title_ar, party_name_ar, party_name,
          director_id
        )
      `,
      )
      .eq('id', claimId)
      .single();

    if (claimErr) throw claimErr;

    // Build certificate data
    const certificateData: CertificateData = {
      claimId,
      claimNo: claim.claim_no,
      contractNo: (claim.contracts as any)?.contract_no,
      contractTitle: (claim.contracts as any)?.title_ar || 'العقد',
      companyName: (claim.contracts as any)?.party_name_ar || (claim.contracts as any)?.party_name || '',
      companyNationalId: '---', // Would come from contract if available
      paymentNo: `DP-${claim.claim_no}`,
      invoiceDate: claim.period_to ? claim.period_to.split('T')[0] : '',
      executionPeriod: claim.period_from && claim.period_to
        ? `من ${claim.period_from.split('T')[0]} إلى ${claim.period_to.split('T')[0]}`
        : '',
      totalAmount: parseFloat(String(claim.total_amount)) || 0,
      totalAmountAr: numberToArabicWords(parseFloat(String(claim.total_amount)) || 0),
      boqAmount: parseFloat(String(claim.boq_amount)) || 0,
      staffAmount: parseFloat(String(claim.staff_amount)) || 0,
      retentionAmount: parseFloat(String(claim.retention_amount)) || 0,
      vatAmount: parseFloat(String(claim.vat_amount)) || 0,
      approvedDate: claim.approved_at ? claim.approved_at.split('T')[0] : new Date().toISOString().split('T')[0],
      approvedBy: 'مدير الإدارة',
    };

    // Generate HTML
    const html = generateCompletionCertificateHTML(certificateData);

    // Call backend to convert HTML to PDF and upload
    const response = await fetch('/api/certificates/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        claimId,
        certificateType: 'completion',
        html,
        actorId,
      }),
    });

    const result = await response.json();
    if (!response.ok) {
      return createErrorResponse(result.error || 'فشل في إنشاء شهادة الإتمام',
      );
    }

    return createResponse(result.data);
  } catch (error) {
    console.error('Failed to generate completion certificate:', error);
    return createErrorResponse(friendlyError(error),
    );
  }
}

/**
 * Generate audit/review form PDF
 */
export async function generateReviewForm(
  claimId: string,
  actorId: string,
): Promise<ApiResponse<GeneratedCertificate>> {
  try {
    const supabase = createBrowserSupabase();

    // Fetch claim details
    const { data: claim, error: claimErr } = await supabase
      .from('claims')
      .select(
        `
        id, claim_no, contract_id, boq_amount, staff_amount,
        retention_amount, vat_amount, total_amount, approved_at,
        period_from, period_to,
        contracts(
          contract_no, title_ar, party_name_ar, party_name
        )
      `,
      )
      .eq('id', claimId)
      .single();

    if (claimErr) throw claimErr;

    // Build certificate data
    const certificateData: CertificateData = {
      claimId,
      claimNo: claim.claim_no,
      contractNo: (claim.contracts as any)?.contract_no,
      contractTitle: (claim.contracts as any)?.title_ar || 'العقد',
      companyName: (claim.contracts as any)?.party_name_ar || (claim.contracts as any)?.party_name || '',
      companyNationalId: '---',
      paymentNo: `DP-${claim.claim_no}`,
      invoiceDate: claim.period_to ? claim.period_to.split('T')[0] : '',
      executionPeriod: claim.period_from && claim.period_to
        ? `من ${claim.period_from.split('T')[0]} إلى ${claim.period_to.split('T')[0]}`
        : '',
      totalAmount: parseFloat(String(claim.total_amount)) || 0,
      totalAmountAr: numberToArabicWords(parseFloat(String(claim.total_amount)) || 0),
      boqAmount: parseFloat(String(claim.boq_amount)) || 0,
      staffAmount: parseFloat(String(claim.staff_amount)) || 0,
      retentionAmount: parseFloat(String(claim.retention_amount)) || 0,
      vatAmount: parseFloat(String(claim.vat_amount)) || 0,
      approvedDate: claim.approved_at ? claim.approved_at.split('T')[0] : new Date().toISOString().split('T')[0],
      approvedBy: 'جهات التدقيق والمراجعة',
    };

    // Generate HTML
    const html = generateAuditReviewFormHTML(certificateData);

    // Call backend to convert HTML to PDF and upload
    const response = await fetch('/api/certificates/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        claimId,
        certificateType: 'audit_review_form',
        html,
        actorId,
      }),
    });

    const result = await response.json();
    if (!response.ok) {
      return createErrorResponse(result.error || 'فشل في إنشاء نموذج التدقيق والمراجعة',
      );
    }

    return createResponse(result.data);
  } catch (error) {
    console.error('Failed to generate review form:', error);
    return createErrorResponse(friendlyError(error),
    );
  }
}

/**
 * Get generated certificates for a claim
 */
export async function getGeneratedCertificates(
  claimId: string,
): Promise<ApiResponse<GeneratedCertificate[]>> {
  try {
    const supabase = createBrowserSupabase();

    const { data, error } = await supabase
      .from('generated_certificates')
      .select('*')
      .eq('claim_id', claimId)
      .order('generated_at', { ascending: false });

    if (error) throw error;
    return createResponse(data || []);
  } catch (error) {
    return createErrorResponse(friendlyError(error),
    );
  }
}
