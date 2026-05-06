# CMH_01 — F1 Recovery Report

> **Date:** 2026-05-05
> **Triggered by:** finding F1 in `file_inventory.md` — `CMH_01_SMART.xlsx` corrupted on disk.
> **Action requested:** search for any recoverable structured workbook in the project tree and the official repo workspace; rank candidates; promote a Tier-A to `source-snapshot/CMH_01_SMART.xlsx` if found; otherwise produce this report and stop.
> **Scope:** read-only on the source folder (no rename/move/delete/overwrite). All copies live under the official repo at `data-imports/CMH_01/00_inventory/source-snapshot/candidates/`.

---

## 1. Outcome at a glance

**No Tier-A candidate was found.** The canonical multi-sheet SMART workbook is not recoverable from the source tree or the official repo. **F1 is still BLOCKED for the full canonical dataset (claims, VOs, certificates, movement log).**

However, two **Tier-C** candidates carry partial structured value:
- **`02_BOQ/BOQ.xlsx`** — a rich BOQ master with 1,419 rows in sheet `"BOQ"` and 17 rows in sheet `"Sheet2"` (auxiliary price list). **Allows item-level BOQ migration at full fidelity.**
- **`09_REPORTS_OUT/تقارير الاستشاري/Weekly Reports/نسب الانجاز.xlsx`** — week-by-week schedule progress. Useful as a cross-reference, not as primary data.

The other three candidates (CAL, RQS, drawing-approval) are project-internal templates, not project data. They are valid xlsx but not relevant to the migration.

**Mission stays paused.** Two paths forward are presented below; explicit operator approval required before either.

---

## 2. Search scope

Searched recursively for `*.xlsx`, `*.xlsm`, `*.xlsb` across:
- `<host>\PROJECTS\CMH_01\` (the source tree)
- `<host>\PROJECTS\CMH_01\_ETL\` (legacy ETL toolkit folder)
- `<host>\PROJECTS\CMH_01\09_REPORTS_OUT\` (auto-generated reports)
- `convera-platform\data-imports\CMH_01\` (the official import workspace)

Excluded from candidate set:
- Excel lock files (`~$*.xlsx`)
- Daily-report files under `09_REPORTS_OUT/تقارير الاستشاري/التقارير اليومية/` and `…/التقرير اليومي المحدث/` (~150 files; auto-generated daily snapshots, not project-level data).

Six unique candidates remained; all six were copied into:

```
data-imports/CMH_01/00_inventory/source-snapshot/candidates/
├── A_smart_master.xlsx            ← <- CMH_01_SMART.xlsx
├── B_boq_master.xlsx              ← <- 02_BOQ/BOQ.xlsx
├── C_template_cal.xlsx            ← <- 08_TEMPLATES/CAL.xlsx
├── D_template_rqs.xlsx            ← <- 08_TEMPLATES/RQS.xlsx
├── E_template_drawing_approval.xlsx ← <- 08_TEMPLATES/طلب اعتماد مخططات.xlsx
└── F_progress_percentages.xlsx    ← <- 09_REPORTS_OUT/.../نسب الانجاز.xlsx
```

**No source files were modified.** Filenames in the candidates folder were ASCII-slugged so subsequent automation does not depend on Arabic file paths.

---

## 3. Validation results

| Slug | Origin | Size | ZIP | openpyxl | Sheets | Canonical match | **Tier** |
|---|---|---:|---|---|---:|---|---|
| `A_smart_master.xlsx` | `CMH_01_SMART.xlsx` | 838 014 | **FAIL** | **FAIL** | 0 | — | **D** |
| `B_boq_master.xlsx` | `02_BOQ/BOQ.xlsx` | 99 316 | OK | OK | 2 | (BOQ-only — see §4.2) | **C** |
| `C_template_cal.xlsx` | `08_TEMPLATES/CAL.xlsx` | 86 498 | OK | OK | 1 | — | C |
| `D_template_rqs.xlsx` | `08_TEMPLATES/RQS.xlsx` | 129 078 | OK | OK | 1 | — | C |
| `E_template_drawing_approval.xlsx` | `08_TEMPLATES/طلب اعتماد مخططات.xlsx` | 113 755 | OK | OK | 2 | — (drawing review, not project data) | C |
| `F_progress_percentages.xlsx` | `09_REPORTS_OUT/.../نسب الانجاز.xlsx` | 19 063 | OK | OK | 1 | — (schedule % only) | C |

**Tier definitions used:**
- **A** — fully valid; ≥ 8 of the 10 expected canonical-sheet name fragments present (`عقد / كميات / مطالبات / تغيير / إنجاز / اعتماد / حركة / موجز / كوادر / لوحة`).
- **B** — fully valid; 4–7 fragments present (partial SMART workbook).
- **C** — fully valid xlsx but unrelated to the SMART model, OR carrying single-purpose useful data (BOQ-only, schedule-only).
- **D** — invalid / corrupt.

The full per-sheet breakdown is preserved in:

```
data-imports/CMH_01/00_inventory/F1_candidate_validation.json
```

---

## 4. Per-candidate findings

### 4.1 `A_smart_master.xlsx` (Tier D — corrupt)

- `zipfile.ZipFile` → `BadZipFile: File is not a zip file`
- `unzip -l` → `End-of-central-directory signature not found`
- File starts with a valid ZIP local-file-header (`50 4B 03 04`) but ends without an EOCD record.
- **Verdict:** unrecoverable from this snapshot. Operator action required (re-export from source, OneDrive history, or backup).

### 4.2 `B_boq_master.xlsx` (Tier C — HIGHLY USEFUL)

Sheet `"BOQ"` — 1,419 rows × 8 columns. Header pattern:

| col | meaning |
|---|---|
| 3 | `م` (item_no) |
| 4 | `بيان الأعمال` (description) |
| 5 | `الوحدة` (unit, e.g. `م2`, `م3`, `عدد`) |
| 6 | `الكمية حسب العقد` (contractual_qty) |
| 7 | `ملاحظات` (notes) |

Sample (rows 8–11): item 1 demolition, 17,900 m²; item 2 floor tile demolition, 10,362 m²; item 3 ceiling demolition, 18,420 m²; item 4 reinforced concrete, 6 m³.

Sheet `"Sheet2"` — 17 rows × 4 columns. Pattern: `المجموع / السعر / الكمية / رقم البند` (total / unit_price / qty / item_no). This appears to be a **prices-and-totals reference table** for selected items only (not all 1,419 BOQ items have a price here — only 16 do).

**Implication:** the BOQ line items are extractable at full fidelity (descriptions + units + contractual quantities), but the **unit prices are only partially available** in this workbook (Sheet2). For the rest, prices must come from the contract PDF (`01_CONTRACT/عقد المشروع.pdf` or `العقد.pdf`) or from the corrupt SMART workbook once recovered.

This is the single most valuable structured data source still readable. Its sheet structure does not match the 10–12 canonical SMART sheets, so it is correctly classified as **Tier C** — single-purpose useful, not the canonical workbook.

### 4.3 Templates `C_template_cal.xlsx`, `D_template_rqs.xlsx`, `E_template_drawing_approval.xlsx`

- `CAL.xlsx` (53 × 9): single sheet `Sheet1`. Likely a calculation template.
- `RQS.xlsx` (51 × 9): single sheet `Sheet1`. Likely a request template.
- Drawing-approval (59 × 32 + 55 × 32): two sheets `3RD FLOORING` / `3RD FLOORING (2)`. Drawing-approval log per floor. Not project data.

These are **operationally interesting** to the team but **not relevant to the migration** of contract / BOQ / claims / certificates. They will not be imported.

### 4.4 `F_progress_percentages.xlsx` (Tier C — schedule cross-reference)

Single sheet (83 × 20). Rows 2+ show week-numbered planned-vs-actual progress percentages with start/end dates from 2022-11-08 onward. Columns labelled `نسبة الانجاز المخططة / نسبة الانجاز الفعلية / الفرق / معدل الاداء`.

**Implication:** useful to validate that imported claim progress percentages line up with the consultant's recorded weekly schedule, but not a primary import source.

---

## 5. What this means for Phase 3 — extraction options

| Data element | Available source | Fidelity | Path |
|---|---|---|---|
| Contract master metadata (no, value, dates, parties) | PDF only (`01_CONTRACT/`) | Medium — text extraction works, table cells require manual confirmation | Awaits operator approval for PDF extraction |
| BOQ line items (item_no, description, unit, contractual_qty) | **`02_BOQ/BOQ.xlsx`** | **HIGH — full fidelity from xlsx** | ✅ Can proceed immediately |
| BOQ unit prices | Partial in `02_BOQ/BOQ.xlsx` Sheet2 + full in PDF or recovered SMART | Medium without recovered SMART | Hybrid |
| Variation orders (5 numbered VOs) | PDF only (`03_VO/`) | Medium — VO structure is amenable to text extraction | Awaits operator approval |
| Financial claim totals (21 claims) | PDF only (`04_PAYMENTS/`) | Medium — totals readable from المستخلصات | Awaits operator approval |
| Claim-line-level progress per claim per BOQ item | **NOWHERE outside the corrupt SMART workbook** | **NONE** | Blocked on F1 |
| Approvals / Completion certificates | PDF only (`05_APPROVALS/`, `06_CERTIFICATES/`) | High — these are PDF attachments to be linked, not extracted as data | ✅ Linkable as documents |

The single most painful loss with the current set is **claim-line-level progress** — without the canonical SMART workbook, we cannot reconstruct which BOQ items each المستخلص touched at what cumulative quantity. Only summary totals can be migrated.

---

## 6. Two paths forward (operator chooses; both stop here)

### Path A — Wait for the canonical SMART workbook (recommended)

Operator recovers `CMH_01_SMART.xlsx` from a known-good source (Excel auto-recover, OneDrive version history, backup) and places it at:

```
convera-platform\data-imports\CMH_01\00_inventory\source-snapshot\CMH_01_SMART.xlsx
```

The four pre-resume checks A → D in `F1_RECOVERY_CHECKLIST.md` §3 are then run. On green, F1 is RESOLVED and Phase 2 → Phase 7 proceed autonomously to a clean dry-run report. Phase 8 (controlled migration) still requires explicit approval before any DB write.

This is the **highest-fidelity** path and is what your brief requires for "high-fidelity migration, including BOQ item-level progress and historical claim details."

### Path B — Hybrid plan (degraded but not pure-PDF)

If a valid SMART workbook cannot be recovered in a reasonable timeframe and the operator wants to make progress:

1. **Phase 4 BOQ**: extract item-level data from `02_BOQ/BOQ.xlsx` (1,419 rows, full fidelity).
2. **Phase 4 Contract master + VOs + claim totals**: PDF text extraction with manual confirmation gates per claim.
3. **Phase 4 attachments**: link the 22 financial-claim PDFs + 22 approval certificates + 22 completion certificates as documents to their respective claim records.
4. **Phase 4 claim-line-level progress**: NOT MIGRATED. Each claim record carries `data_source: 'pdf_summary'` versus future `'workbook_v5'` so the operations team knows which claims are header-only.
5. **Phase 5 validation**: reconciliation report flags every record where line-level data is missing.
6. **Phase 6 import plan + Phase 7 dry-run** proceed normally.
7. **Phase 8 controlled migration** still gated on explicit approval.

Path B is **the degraded path** the brief warns about. It is functional but loses item-level progress reconstruction. **Per your operating rules, this requires explicit operator approval before I begin Phase 3 extraction.**

---

## 7. Mission status

- Phase 1 (inventory) — ✅ complete and committed (a4f23b9).
- Phase 2 (classification) — ⏸ ready to start; not blocked on F1 (file paths already category-tagged in the inventory CSV).
- Phase 3 (extraction) — 🚫 BLOCKED. Operator must approve Path A (wait) or Path B (hybrid) before I extract anything.
- Phase 4–7 — gated on Phase 3.
- Phase 8 (controlled migration) — gated on explicit operator approval per §14 of your brief.

**Source folder modifications:** zero.
**Database writes:** zero.
**SQL execution:** zero.
**Pushes:** zero.

---

## 8. Files produced by this recovery attempt

| File | Purpose |
|---|---|
| `data-imports/CMH_01/00_inventory/source-snapshot/candidates/A_smart_master.xlsx` | Copy of corrupt SMART workbook (forensic evidence). |
| `data-imports/CMH_01/00_inventory/source-snapshot/candidates/B_boq_master.xlsx` | Copy of BOQ master (Tier C — usable). |
| `data-imports/CMH_01/00_inventory/source-snapshot/candidates/C_template_cal.xlsx` | Copy of CAL template (low value). |
| `data-imports/CMH_01/00_inventory/source-snapshot/candidates/D_template_rqs.xlsx` | Copy of RQS template (low value). |
| `data-imports/CMH_01/00_inventory/source-snapshot/candidates/E_template_drawing_approval.xlsx` | Copy of drawing-approval template (low value). |
| `data-imports/CMH_01/00_inventory/source-snapshot/candidates/F_progress_percentages.xlsx` | Copy of schedule percentages (cross-reference). |
| `data-imports/CMH_01/00_inventory/F1_candidate_validation.json` | Machine-readable per-candidate validation result (zip/openpyxl/sheet inspection). |
| `data-imports/CMH_01/00_inventory/F1_RECOVERY_REPORT.md` | This document. |

The `source-snapshot/` directory is NOT a substitute for the canonical SMART workbook — it is the staging area where Path A's recovered file should land.

---

**Awaiting operator decision on Path A or Path B before any further phase work.**
