# Attachment Existence Report

> Generated 2026-05-05. Verifies that files referenced in claim_documents.csv / approvals.csv / certificates.csv actually exist in the source folders.

**Total expected attachments:** 145
**Matched in source folders:** 67
**Not matched:** 78

## Per-claim summary

| claim_seq | expected | matched | gap |
|---:|---:|---:|---|
|  | 61 | 0 | ⚠ 61 not matched |
| 1 | 4 | 2 | ⚠ 2 not matched |
| 10 | 4 | 4 | ✅ all matched |
| 11 | 4 | 4 | ✅ all matched |
| 12 | 4 | 4 | ✅ all matched |
| 13 | 4 | 4 | ✅ all matched |
| 14 | 4 | 4 | ✅ all matched |
| 15 | 4 | 4 | ✅ all matched |
| 16 | 4 | 4 | ✅ all matched |
| 17 | 4 | 4 | ✅ all matched |
| 18 | 4 | 4 | ✅ all matched |
| 19 | 4 | 4 | ✅ all matched |
| 2 | 4 | 2 | ⚠ 2 not matched |
| 20 | 4 | 4 | ✅ all matched |
| 21 | 4 | 4 | ✅ all matched |
| 3 | 4 | 3 | ⚠ 1 not matched |
| 4 | 4 | 2 | ⚠ 2 not matched |
| 5 | 4 | 2 | ⚠ 2 not matched |
| 6 | 4 | 2 | ⚠ 2 not matched |
| 7 | 4 | 2 | ⚠ 2 not matched |
| 8 | 4 | 2 | ⚠ 2 not matched |
| 9 | 4 | 2 | ⚠ 2 not matched |

## Match strategy

The SMART workbook records expected filenames as `CMH_01-CLM-NNN-{INVOICE,APPROVAL,COMPLETION}.pdf` (canonical naming).
The actual files in `04_PAYMENTS/`/`05_APPROVALS/`/`06_CERTIFICATES/` use the team's working names: `المستخلص NN.pdf`, `شهادة اعتماد-NN.pdf`, `شهادة انجاز-NN.pdf`.

This report uses **numeric-token matching** (`claim_seq` zero-padded to 2 digits → search in actual filenames) rather than literal filename matching. The ATTACHMENT LINKING strategy at Phase 8 will follow the same approach.
