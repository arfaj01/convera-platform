/** ─── Certificate Generation - Phase 4 ───*/

import { createCanvas } from 'canvas';

export interface CertificateContext {
  claim_no: number | string;
  contract_no: string;
  contract_title_ar: string; // Arabic
  contractor_name: string;
  supervisor_name: string;
  claim_amount: number;
  approval_date: Date; // ISO string
  final_approver_name: string;
}

export async function generateCompletionCertificate(ctx: CertificateContext): Promise<Buffer> {
  // Base64 encoded PDF template with placeholders:
  // %{contract_na}, %{claim_no}, %{claim_amount}, %{final_approver_name},
  const pdfTemplate = `... base64 PDF ...`;
  const pdfBuffer = Buffer.from(pdfTemplate, 'base64');

  // Text replacements for context
  let pdfProcessed = pdfBuffer.toString('utf8')
    .replace('{contract_no}', ctx.contract_no)
    .replace('{claim_no'}', String(ctx.claim_no))
    .replace('{claim_amount}', `SAR ${ctx.claim_amount.toLocaleString('ar')}`)
    .replace('{final_approver_name}', ctx.final_approver_name)
    .replace('{approval_date}', ctx.approval_date.toLocaleDateString('ar'));

  return Buffer.from(pdfProcessed, 'utf8');
}

export async function generateAuditForm(ctx: CertificateContext): Promise<Buffer> {
  // PHASE 4: ЧIA generates A3 HTML with tables
  //Audit Form PDF generation comes in Phase 5
  return Buffer.from(`Audit Form for claim #{ctx.claim_no}`, 'utf8');
}
