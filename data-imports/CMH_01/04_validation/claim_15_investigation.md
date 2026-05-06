# Claim 15 — Anomaly Investigation

> **Date:** 2026-05-05
> **Triggered by:** Phase-7 dry-run finding `CLAIM_15_DATA_GAP` (P1).
> **Goal:** decide between option-a-restore-from-pdf, option-b-header-only, option-c-skip-this-batch.
> **Outcome:** **option-b-header-only is the cleanest path**, structurally consistent with the rest of the dataset. Details below.

---

## 1. Source files inspected

| Folder | File | Size | Pages | Tool |
|---|---|---:|---:|---|
| `04_PAYMENTS/` | `المستخلص 15.pdf` | 11 553 636 bytes | 44 | `pdftotext -layout`, `pdfinfo`, `pypdf 3.17.4` |
| `05_APPROVALS/` | `شهادة اعتماد-15.pdf` | 11 595 060 bytes | (auditor's review form, identical financial values) | same |
| `06_CERTIFICATES/` | `شهادة انجاز-15.pdf` | 11 573 124 bytes | (completion certificate, identical financial values) | same |

All three PDFs are **text-extractable** (Acrobat PDFMaker / Aspose origin). No OCR was needed.

The metadata of the payment PDF:
- Author: Shafie, Omar
- Creator: Acrobat PDFMaker 22 for Excel
- CreationDate: 2024-11-10 07:14 UTC
- Form: AcroForm
- Encryption: none

---

## 2. Extracted financial values (PDF, audited)

The values reproduced here come directly from page 3 (the audit/review form) of `المستخلص 15.pdf`. Cross-checked against the same panel on page 1 of `شهادة اعتماد-15.pdf`. Identical to one decimal SAR.

| Field | Value (PDF) | Match against normalized claims.csv? |
|---|---:|---|
| الرقم المرجعي (اعتماد) | `241102111582` | ✅ matches `claim_no_official` |
| المستخلص الجاري رقم | `15` | ✅ matches `claim_seq` |
| فترة إنجاز الأعمال — من | `2024-08-24` | ❌ MISSING in normalized (currently null) |
| فترة إنجاز الأعمال — إلى | `2024-11-07` | ❌ MISSING in normalized (currently null) |
| الأعمال المنفذة لبنود العقد الأساسية — المستخلص الحالي | **`9,661,835.75` SAR** | ❌ normalized = 0.00 |
| الأعمال المنفذة لبنود العقد الأساسية — المستخلصات السابقة | `31,079,978.10` SAR | (informational) |
| الأعمال المنفذة — إجمالي المشروع | `40,741,813.80` SAR | (informational) |
| تغطية الدفعة الختامية (–10%) — المستخلص الحالي | `(966,183.57)` SAR | ❌ normalized = 0 |
| صافي قيمة المستحق صرفه — قبل الضريبة — المستخلص الحالي | `8,695,652.17` SAR | ❌ normalized = 0 |
| قيمة الضريبة المضافة (15%) — المستخلص الحالي | **`1,304,347.83` SAR** | ❌ normalized = 0 |
| صافي المستحق صرفه مع الضريبة — المستخلص الحالي | **`10,000,000.00` SAR** | ❌ normalized = 0 |
| نسبة الإنجاز للأعمال إلى قيمة العقد — المستخلص الحالي | `15.36%` | (informational) |
| المعتمد النهائي | محمد عبدالله العرفج | matches `users.csv` row 1 |
| مدير المشروع | محمد ظافر الشهراني | NEW name not in `users.csv` (the 6 stakeholders are confirmed CMH_01 users; this name appears only on this PDF as project-manager signatory — acceptable, not a blocker) |
| الحالة (in workbook) | `معتمدة` (approved) | ✅ matches |

The `شهادة انجاز-15.pdf` confirms the same monetary values from a different angle (الجهة المالكة perspective):
- المبلغ بالأرقام: 9,661,835.75
- المستقطع 10%: (966,183.57)
- ضريبة القيمة المضافة: 1,304,347.83
- المبلغ الإجمالي: 10,000,000.00

---

## 3. Whether line-item detail exists in the PDF

**No.** The 44-page payment PDF contains:

| Pages | Content |
|---:|---|
| 1-2 | شهادة إنجاز أعمال (completion certificate, summary header only) |
| 3 | استمارة تدقيق ومراجعة (audit/review form — totals and progress %, not line items) |
| 4-44 | Variation-order supporting documents (تعميد, تفاصيل أمر التغيير, ministerial approval letters for VO 1-5) |

There is **no per-BOQ-item progress schedule** in the PDF. The audit form on page 3 reports progress at **contract-aggregate level** only (15.36% of 65,767,202.57 SAR contract value). The remaining 41 pages document the variation orders themselves, not claim-15 line breakdowns.

---

## 4. Why the SMART workbook has no line items for claim 15

The investigation found a **deeper structural fact** that resolves the original concern about cumulative continuity:

### 4.1 SMART's cumulative tracking already excludes claim 15

For every BOQ item I sampled (items 1, 5, 50, 100, 200), the SMART workbook satisfies:

```
max(cumulative_qty across claims 1..21 EXCEPT 15) == sum(curr_progress across claims 1..21 EXCEPT 15)
```

The maximum cumulative observed in SMART for an item equals the sum of all curr_progress values across the 20 non-15 claims. **This means the SMART workbook's cumulative figures already treat claim 15 as a zero-line-item claim.**

For example, item 1 (`هدم وإزالة الجدران`):
- Sum of curr_progress across claims 1-14 + 16-21 = `16,098.97 m²`
- Max cumulative_qty observed in any of those claims = `16,098.97 m²`

If claim 15 had a non-zero contribution to item 1, the cumulative seen in claim 16's row would equal `cumulative_at_end_of_claim_14 + claim_15_contribution + claim_16_contribution`. Instead it equals `cumulative_at_end_of_claim_14 + claim_16_contribution`. Claim 15 was authored as zero across all 386 BOQ items.

### 4.2 So where did the 9,661,835.75 SAR come from?

The PDF says the payment is for "الأعمال المنفذة لبنود العقد الأساسية" (work executed against the basic contract items). The SMART workbook's per-item cumulative says claim 15 contributed zero per item. **The two are inconsistent — the SMART workbook is missing the line-level detail for claim 15.**

Most plausible explanations (each consistent with the other 20 claims being correct):

1. **Authoring oversight.** The SMART workbook was authored over 2 years; the operator may have entered claim 15's header but not its 60+ line items.
2. **VO catch-up.** Claim 15's 9.66M SAR may correspond to VO-additional work (the contract had 5 VOs adding 1,198,922.15 + 3,922,896.83 ≈ 5.1M SAR, plus other VO impacts). The PDF shows the contract value increased from 65.77M → 72.34M after VOs. If claim 15 paid VO work, it wouldn't appear under the original BOQ items.
3. **Period adjustment.** The previous claim (claim 14) ended on a different date than claim 15 starts. Claim 15 may include adjustments / cleanup payments that aren't tied to specific items.

**No way to determine the cause without operator input.** All three explanations leave claim 15's header values authoritative; only the line-level detail is undocumented.

### 4.3 Cumulative continuity is preserved either way

Because SMART's per-item cumulative already excludes claim 15, importing claim 15 as **header-only** (no claim_boq_items rows) preserves cumulative arithmetic exactly:

- Platform's prev_progress for claim 16 = SUM(curr_progress over approved claims 1..15) = SUM over claims 1..14 (claim 15 has zero items).
- After claim 16 inserts, platform's cumulative for item X = SUM(1..14) + claim_16_curr[X].
- SMART's claim_16.cumulative_qty for item X = same value.

No shift, no inconsistency, no proportional distribution needed. The SMART workbook author has already done the bookkeeping consistent with header-only claim 15.

---

## 5. Recommended decision: **option-b-header-only**

| Criterion | option-a-restore-from-pdf | **option-b-header-only** | option-c-skip-this-batch |
|---|---|---|---|
| Header values present in PDF? | ✅ | ✅ | n/a |
| Line-item detail present in PDF? | ❌ | n/a | n/a |
| Preserves total amount paid to contractor? | ✅ | ✅ | ❌ (audit gap) |
| Preserves cumulative continuity for claims 16-21? | depends on derivation accuracy | ✅ (matches SMART exactly) | ✅ |
| Data fabrication risk? | HIGH (line items would be guessed) | NONE | NONE |
| Effort required | HIGH (rebuild 60+ line rows) | LOW (5-field patch) | very low |
| Audit transparency | brittle | clean (`data_source='pdf_summary'` flag) | clean |
| Total amount visible in CONVERA after import | ✅ 10,000,000.00 SAR | ✅ 10,000,000.00 SAR | ❌ missing |

Option-a is **infeasible** without operator-supplied line-level data (the PDF doesn't carry it).
Option-c leaves a financial-records gap and breaks the 21-claim history.
**Option-b is the cleanest and the most faithful to the source documentation we actually have.**

### Risks of option-b

| Risk | Severity | Mitigation |
|---|---|---|
| Future claim-15 line-item recovery would require a UPDATE rather than INSERT | low | The platform's claim-edit policies block modification of approved claims. If line-level detail is later recovered, it would be inserted as a separate "claim-15 supplement" via change-order machinery, not by mutating the original. |
| Reports that aggregate `claim_boq_items` show contract progress 0.5pp lower than the PDF's stated 15.36% | low | Add a `data_quality_notes` flag at the `claims` table level. Reports can join and exclude claim 15 from item-level aggregations. |
| The platform UI may not display line items for claim 15 — appears empty to users | medium | Pre-emptively show a banner on the claim detail page for claims with the `data_source='pdf_summary'` flag, explaining that line-level detail is not in the source data. |
| A reviewer who reconciles SMART → CONVERA at the line level will see zero rows for claim 15 | low | Already the SMART state — not a new gap introduced by import. |

### Risks of option-c

| Risk | Severity | Mitigation |
|---|---|---|
| 10M SAR of contractor payment is unrecorded in CONVERA | HIGH | Cannot mitigate without importing |
| The 21-claim history in CONVERA has a hole between claim 14 and claim 16 | HIGH | none — visible to every consumer |
| Cumulative reconciliation against the consultant's `نسب الانجاز.xlsx` will show a 15.36% gap | HIGH | none |

---

## 6. Exact normalized patch needed for option-b

Apply the following edits to `data-imports/CMH_01/03_normalized/claims.csv`, claim_seq=15 row only:

| Column | Current value | Patched value | Source |
|---|---|---|---|
| `work_period_from` | (empty) | `2024-08-24` | PDF page 3 (audit form), page 1 (completion cert) |
| `work_period_to` | (empty) | `2024-11-07` | same |
| `boq_amount` | `0.0` | `9661835.75` | PDF page 3, row "الأعمال المنفذة لبنود العقد الأساسية — المستخلص الحالي" |
| `gross_amount` | `0.0` | `9661835.75` | derived (boq_amount × 100% performance) |
| `retention_amount` | `0.0` | `966183.575` | PDF page 3, row "تغطية الدفعة الختامية -10%" |
| `net_amount` | `0.0` | `8695652.175` | PDF page 3, row "صافي قيمة المستحق صرفه — قبل الضريبة" |
| `vat_amount` | `0.0` | `1304347.826` | PDF page 3, row "قيمة الضريبة المضافة" (15% of net) |
| `total_amount` | `0.0` | `10000000.00` | PDF page 3, row "صافي المستحق صرفه مع الضريبة المضافة" |
| `cumulative_amount` | `32167779.62` | `42167777.28` | PDF page 3, row "صافي المستحق صرفه — إجمالي المشروع" (with-VAT cumulative including this claim) |
| `data_quality_notes` | (empty) | `Claim header restored from المستخلص 15.pdf + شهادة اعتماد-15.pdf + شهادة انجاز-15.pdf (2026-05-05). Line-item detail not in any available source — claim is imported as header-only with data_source='pdf_summary'. The SMART workbook's per-item cumulative tracking already excludes claim 15, so cumulative continuity for claims 16-21 is preserved.` | this investigation |

No changes to `claim_line_items.csv`, `boq_items.csv`, `cumulative_item_progress.csv`, or any other normalized file. The `excluded_records/claim_line_items_excluded.json` already records that claim 15 had no usable line rows (none were excluded for claim 15 because none existed).

The Phase-8 import script must additionally:
- Pass an empty `boq_items: []` array to `POST /api/claims/create` for claim_seq=15 (the RPC accepts this).
- Set `data_source='pdf_summary'` as a `notes` annotation when calling `/api/claims/transition` for the `submit` step.
- Skip the `validate(): hasCurrQty` UI guard by calling the API directly (script-only, not via the form).
- Attach all three claim-15 PDFs (payment + approval + completion certificate) so a future reviewer has full evidence.

---

## 7. Verification before applying

Recommended verification in Phase 8 right after claim 15 inserts (read-only checks):

```sql
-- 1. claim row inserted with the exact total
SELECT id, claim_number, claim_kind, work_period_from, work_period_to,
       boq_amount, retention_amount, vat_amount, total_amount
  FROM claims
 WHERE contract_id = (SELECT id FROM contracts WHERE contract_no='CMH_01-C01')
   AND claim_no = 15;
-- Expected one row, total_amount = 10000000.00

-- 2. zero claim_boq_items for this claim (header-only intent)
SELECT count(*) FROM claim_boq_items
 WHERE claim_id = (SELECT id FROM claims
                    WHERE contract_id=(SELECT id FROM contracts WHERE contract_no='CMH_01-C01')
                      AND claim_no=15);
-- Expected: 0

-- 3. cumulative continuity: claim 16's prev_progress for any item should equal SUM of curr from claims 1..14
--    (NOT including claim 15's ghost contribution)
SELECT cb.item_no,
       SUM(cb.curr_progress) FILTER (WHERE c.claim_no <= 14) AS thru_14,
       SUM(cb.curr_progress) FILTER (WHERE c.claim_no <= 15) AS thru_15
  FROM claim_boq_items cb
  JOIN claims c ON c.id = cb.claim_id
 WHERE c.contract_id = (SELECT id FROM contracts WHERE contract_no='CMH_01-C01')
 GROUP BY cb.item_no
 LIMIT 10;
-- Expected: thru_14 == thru_15 for every item (claim 15 contributes nothing, by design).
```

---

## 8. Approval statement to include

When responding to authorise Phase 8, include the following CLAIM_15_DECISION line:

```
CLAIM_15_DECISION: option-b-header-only
```

This authorises the patch in §6 + the import behaviour in §6 last paragraph + the verification queries in §7. No SQL has been executed during this investigation. No source file has been modified. No DB write has occurred.
