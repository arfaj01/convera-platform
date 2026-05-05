# CMH_01 — Phase 1 File Inventory

> **Generated:** 2026-05-05
> **Source folder (READ-ONLY):** the project-data sub-tree under `<host>\PROJECTS\CMH_01` (path masked here per repo guard; see operator runbook for the actual location).
> **Inventory deliverables:** `data-imports/CMH_01/00_inventory/`
> **Files inspected:** 547  (1813.5 MB)
> **Source files modified:** 0 (read-only honoured)

---

## 1. Top-level structure

```
CMH_01/
├── 01_CONTRACT/         ← contract master + technical specs
├── 02_BOQ/              ← bill of quantities (PDF + XLSX)
├── 03_VO/               ← variation orders (5 numbered VOs + Original-Variants)
├── 04_PAYMENTS/         ← financial claims (المستخلصات 01-21)
├── 05_APPROVALS/        ← approval certificates (شهادات اعتماد)
├── 06_CERTIFICATES/     ← completion certificates (شهادات إنجاز)
├── 07_CORRESPONDENCE/   ← project correspondence
├── 08_TEMPLATES/        ← project-specific templates
├── 09_REPORTS_OUT/      ← auto-generated reports (high count, lower priority)
├── _ETL/                ← prior migration toolkit (Python + Supabase)
├── CMH_01_SMART.xlsx    ← master smart workbook ⚠ CORRUPTED ON DISK
└── README.md            ← project overview
```

---

## 2. Inventory summary by category

| Category | Files | Total size | Migration relevance |
|---|---:|---:|---|
| `project_metadata` | 2 | 0.8 MB | HIGH — anchors the smart workbook + README. |
| `contract_master` | 6 | 48.8 MB | HIGH — contract value, party names, dates. |
| `boq` | 6 | 184.5 MB | HIGH — line items, quantities, unit prices. |
| `change_order` | 15 | 433.4 MB | HIGH — five VOs; revised BOQ totals. |
| `financial_claim` | 22 | 196.6 MB | HIGH — the 21 claims to import as historical records. |
| `approval` | 22 | 197.5 MB | MEDIUM — اعتماد certificates per claim (attachments). |
| `completion_certificate` | 22 | 197.3 MB | MEDIUM — completion certificates per claim (attachments). |
| `correspondence` | 1 | 0.0 MB | LOW — single file; informational. |
| `template` | 6 | 0.5 MB | LOW — internal templates; not data. |
| `report_out` | 434 | 554.2 MB | LOW — auto-generated outputs; do NOT import as primary data. |
| `etl_toolkit` | 11 | 0.0 MB | INFORMATIONAL — prior ETL code (uses legacy schema; see §4). |
| **TOTAL** | **547** | **1813.5 MB** | |

---

## 3. Extension breakdown

| Extension | Count |
|---|---:|
| `.pdf` | 243 |
| `.xlsx` | 213 |
| `.docx` | 45 |
| `.pptx` | 20 |
| `.md` | 11 |
| `.py` | 5 |
| `.db` | 4 |
| `<none>` | 2 |
| `.example` | 1 |
| `.json` | 1 |
| `.txt` | 1 |
| `.jfif` | 1 |

PDFs dominate (243) — primarily evidence/attachments. Spreadsheets (213 .xlsx) and Word docs (45 .docx) are concentrated under `09_REPORTS_OUT/` (auto-generated). The 5 `.py` files are the existing ETL toolkit.

---

## 4. Critical findings (Phase 1)

### F1 — Smart workbook is corrupted on disk (P0)

`CMH_01_SMART.xlsx` (838,014 bytes) starts with a valid ZIP local-file-header (`50 4B 03 04`) but ends WITHOUT a ZIP end-of-central-directory signature. Three independent tools agree it is unreadable:
- `python -m openpyxl.load_workbook` → `BadZipFile: File is not a zip file`
- `python zipfile.ZipFile` → same error
- `unzip -l` → "End-of-central-directory signature not found"

**Last 32 bytes:** random binary, no ZIP EOCD signature. **Impact:** the canonical structured project data (12 sheets per the README — contract / BOQ / claims / VOs / movement log / readiness panel) **cannot be extracted from this file as-is**. Phase 3 (extraction) is blocked on this single artefact.

**Recovery options (operator action required, none autonomous):**
1. Re-export `CMH_01_SMART.xlsx` from the working spreadsheet on the host machine.
2. Provide a known-good copy from a backup / OneDrive / SharePoint.
3. Open the file in Excel — Excel often auto-recovers slightly damaged xlsx files; save-as a fresh copy.

Until a valid copy is provided, Phase 3 will fall back to extracting from the source PDFs alone, which produces lower-fidelity data (no row-by-row item progress; only summary totals from the المستخلص PDFs).

### F2 — Existing `_ETL/` toolkit predates Phase 2.6 (P1)

`_ETL/config.py::CLAIM_STATUS_MAP` and `ROLE_MAP` use the **legacy schema**:

| Smart-workbook value | _ETL maps to | Current platform value |
|---|---|---|
| `عند الجودة` | `under_admin_review` (legacy) | `under_quality_review` (Migration 046) |
| `عند مدير المشروع` | `under_admin_review` (legacy) | `under_project_manager_review` (Migration 046) |
| `جودة` (role) | `reviewer` | `quality` ContractRole (Migration 045) |
| `مدير مشروع` (role) | `reviewer` | `project_manager` ContractRole (Migration 045) |

Running `_ETL/migrate.py` against the **current** platform would (a) collapse the four post-Phase-2.6 stages back into two legacy ones, and (b) lose the multi-role distinction for quality / project_manager. The existing toolkit cannot be used as-is.

**Resolution:** Phase 4 (normalization) will introduce a refreshed mapping that targets the current schema. The legacy `_ETL/migrate.py` is preserved as historical evidence; migration will go through a new script under `convera-platform/scripts/import-cmh01-*.js` (or Python) that respects Migrations 045–050.

### F3 — `09_REPORTS_OUT/` is auto-generated; do NOT import as primary data (P1)

434 of the 547 files (79 %) live under `09_REPORTS_OUT/`. They are reports produced FROM the smart workbook, not source-of-truth data. Treat them as derivative; do not insert into the platform as claim items or certificates.

---

## 5. High-value source files (the migration targets)

### 5.1 Contract master (`01_CONTRACT/`, 6 files)

- `01_CONTRACT/README.md` (1 KB)
- `01_CONTRACT/العقد.pdf` (1558 KB)
- `01_CONTRACT/اللائحة التنفيذية لنظام المنافسات والمشتريات الحكومية المعدلة لعام 1441ه.pdf` (10216 KB)
- `01_CONTRACT/المواصفات الفنية.pdf` (11563 KB)
- `01_CONTRACT/عقد المشروع.pdf` (25015 KB)
- `01_CONTRACT/كراسة الشروط والمواصفات.pdf` (1585 KB)

### 5.2 BOQ (`02_BOQ/`, 6 files)

- `02_BOQ/2023-MOMRA-0150-S     طلب اعتماد جداول الزيادات والوفورات والعقد المعدل (الامر التغييري رقم5)  .pdf` (30379 KB)
- `02_BOQ/BOQ.pdf` (14670 KB)
- `02_BOQ/BOQ.xlsx` (97 KB)
- `02_BOQ/README.md` (1 KB)
- `02_BOQ/جداول الكميات.pdf` (7638 KB)
- `02_BOQ/طلب اعتماد جداول الزيادات والوفورات والبنود المستحدثة.pdf` (136121 KB)

Note: `BOQ.xlsx` (the master BOQ spreadsheet) is the structured data source for line items.

### 5.3 Change orders (`03_VO/`, 15 files)

- `03_VO/01_05_03_24_VO_REHQ (1)(امر تغيير رقم-1 ).pdf` (1570 KB)
- `03_VO/02_29_07_24_VO_REHQ(امر تغيير رقم-2).pdf` (5899 KB)
- `03_VO/03_02_09_24_VO_REHQ)لمر تغيير رقم-3).pdf` (8236 KB)
- `03_VO/04_04_12_24_VO_REHQ)امر تغيير رقم-4).pdf` (31140 KB)
- `03_VO/05_01_06_25_VO_REHQ(امر تغيير رقم-5).pdf` (942 KB)
- `03_VO/2023-MOMRA-0018 - S   جداول الكميات المحدثة (المناقلة رقم 1 ).pdf` (49891 KB)
- `03_VO/2023-MOMRA-0072-S  الأوامر التغيرية.pdf` (137414 KB)
- `03_VO/2023-MOMRA-0073-S  طلب اعتماد البنود المستحدثة.pdf` (139686 KB)
- `03_VO/2023-MOMRA-0121- S  طلب اعتماد البنود المستحدثة.pdf` (21189 KB)
- `03_VO/OVs/01_05_03_24_VO_REHQ.pdf` (1570 KB)
- `03_VO/OVs/02_29_07_24_VO_REHQ.pdf` (5899 KB)
- `03_VO/OVs/03_02_09_24_VO_REHQ.pdf` (8236 KB)
- `03_VO/OVs/04_04_12_24_VO_REHQ.pdf` (31140 KB)
- `03_VO/OVs/05_01_06_25_VO_REHQ.pdf` (942 KB)
- `03_VO/README.md` (1 KB)

Five numbered VOs (`01_…` through `05_…`) plus the OVs sub-folder. Variation orders 1–5 are ready for normalization once the smart workbook (or BOQ.xlsx) is parsed.

### 5.4 Financial claims (`04_PAYMENTS/`, 22 files)

- `04_PAYMENTS/README.md` (1 KB)
- `04_PAYMENTS/المستخلص 01.pdf` (6136 KB)
- `04_PAYMENTS/المستخلص 02.pdf` (6366 KB)
- `04_PAYMENTS/المستخلص 03.pdf` (6649 KB)
- `04_PAYMENTS/المستخلص 04.pdf` (4254 KB)
- `04_PAYMENTS/المستخلص 05.pdf` (5653 KB)
- `04_PAYMENTS/المستخلص 06.pdf` (862 KB)
- `04_PAYMENTS/المستخلص 07.pdf` (1049 KB)
- `04_PAYMENTS/المستخلص 08.pdf` (621 KB)
- `04_PAYMENTS/المستخلص 09.pdf` (8521 KB)
- `04_PAYMENTS/المستخلص 10.pdf` (1502 KB)
- `04_PAYMENTS/المستخلص 11.pdf` (13124 KB)
- `04_PAYMENTS/المستخلص 12.pdf` (1253 KB)
- `04_PAYMENTS/المستخلص 13.pdf` (8866 KB)
- `04_PAYMENTS/المستخلص 14.pdf` (20302 KB)
- `04_PAYMENTS/المستخلص 15.pdf` (11283 KB)
- `04_PAYMENTS/المستخلص 16.pdf` (14966 KB)
- `04_PAYMENTS/المستخلص 17.pdf` (5844 KB)
- `04_PAYMENTS/المستخلص 18.pdf` (8279 KB)
- `04_PAYMENTS/المستخلص 19.pdf` (25843 KB)
- `04_PAYMENTS/المستخلص 20.pdf` (29547 KB)
- `04_PAYMENTS/المستخلص الختامي 21.pdf` (20366 KB)

21 numbered claims (المستخلص 01-20) plus the final closure claim (المستخلص الختامي 21). Each is a PDF — structured data must come from the smart workbook (when readable). Until then, only summary totals can be extracted via PDF text extraction.

### 5.5 Approvals (`05_APPROVALS/`, 22 files)

- `05_APPROVALS/README.md` (1 KB)
- `05_APPROVALS/المستخلص 03.pdf` (6675 KB)
- `05_APPROVALS/شهادة اعتماد-1.pdf` (6165 KB)
- `05_APPROVALS/شهادة اعتماد-10.pdf` (1554 KB)
- `05_APPROVALS/شهادة اعتماد-11.pdf` (13176 KB)
- `05_APPROVALS/شهادة اعتماد-12.pdf` (1309 KB)
- `05_APPROVALS/شهادة اعتماد-13.pdf` (8908 KB)
- `05_APPROVALS/شهادة اعتماد-14.pdf` (20355 KB)
- `05_APPROVALS/شهادة اعتماد-15.pdf` (11323 KB)
- `05_APPROVALS/شهادة اعتماد-16.pdf` (15075 KB)
- `05_APPROVALS/شهادة اعتماد-17.pdf` (5904 KB)
- `05_APPROVALS/شهادة اعتماد-18.pdf` (8279 KB)
- `05_APPROVALS/شهادة اعتماد-19.pdf` (25877 KB)
- `05_APPROVALS/شهادة اعتماد-2.pdf` (6399 KB)
- `05_APPROVALS/شهادة اعتماد-20.pdf` (29644 KB)
- `05_APPROVALS/شهادة اعتماد-21.pdf` (20408 KB)
- `05_APPROVALS/شهادة اعتماد-4 (2).pdf` (4289 KB)
- `05_APPROVALS/شهادة اعتماد-5 (2).pdf` (5679 KB)
- `05_APPROVALS/شهادة اعتماد-6.pdf` (894 KB)
- `05_APPROVALS/شهادة اعتماد-7.pdf` (1077 KB)
- `05_APPROVALS/شهادة اعتماد-8.pdf` (650 KB)
- `05_APPROVALS/شهادة اعتماد-9.pdf` (8579 KB)

### 5.6 Completion certificates (`06_CERTIFICATES/`, 22 files)

- `06_CERTIFICATES/README.md` (1 KB)
- `06_CERTIFICATES/شهادة انجاز-1.pdf` (6167 KB)
- `06_CERTIFICATES/شهادة انجاز-10.pdf` (1538 KB)
- `06_CERTIFICATES/شهادة انجاز-11.pdf` (13157 KB)
- `06_CERTIFICATES/شهادة انجاز-12.pdf` (1288 KB)
- `06_CERTIFICATES/شهادة انجاز-13.pdf` (8897 KB)
- `06_CERTIFICATES/شهادة انجاز-14.pdf` (20369 KB)
- `06_CERTIFICATES/شهادة انجاز-15.pdf` (11302 KB)
- `06_CERTIFICATES/شهادة انجاز-16.pdf` (15014 KB)
- `06_CERTIFICATES/شهادة انجاز-17.pdf` (5860 KB)
- `06_CERTIFICATES/شهادة انجاز-18.pdf` (8344 KB)
- `06_CERTIFICATES/شهادة انجاز-19.pdf` (25877 KB)
- `06_CERTIFICATES/شهادة انجاز-2.pdf` (6392 KB)
- `06_CERTIFICATES/شهادة انجاز-20.pdf` (29586 KB)
- `06_CERTIFICATES/شهادة انجاز-21.pdf` (20408 KB)
- `06_CERTIFICATES/شهادة انجاز-3.pdf` (6671 KB)
- `06_CERTIFICATES/شهادة انجاز-4.pdf` (4283 KB)
- `06_CERTIFICATES/شهادة انجاز-5.pdf` (5675 KB)
- `06_CERTIFICATES/شهادة انجاز-6.pdf` (893 KB)
- `06_CERTIFICATES/شهادة انجاز-7.pdf` (1077 KB)
- `06_CERTIFICATES/شهادة انجاز-8.pdf` (648 KB)
- `06_CERTIFICATES/شهادة انجاز-9.pdf` (8557 KB)

---

## 6. Phase 1 deliverables

| File | Purpose |
|---|---|
| `data-imports/CMH_01/00_inventory/file_inventory.csv` | Authoritative inventory — 547 rows × 8 columns. |
| `data-imports/CMH_01/00_inventory/file_inventory.md` | This document. Human-readable summary with critical findings. |

**No source files were modified.** All derived output lives under the official repo at `data-imports/CMH_01/`.

---

## 7. Phase 2 readiness

| Gate | Status | Notes |
|---|---|---|
| File enumeration complete | ✅ | 547 files inventoried |
| Source folder read-only honoured | ✅ | No writes / renames / deletes |
| Existing ETL detected and analysed | ✅ | F2 — uses legacy schema; cannot use as-is |
| Smart workbook readable | ❌ | F1 — corrupted on disk; recovery action required |
| Extension distribution captured | ✅ | PDFs dominate; Excel/Word in reports folder |

**Phase 2 (classification) can begin** without resolving F1 — every PDF and structural file is already category-tagged. **Phase 3 (extraction) is BLOCKED on F1** for any item-level structured data; it will degrade to PDF-text extraction only until a valid workbook is provided.

Awaiting operator decision on F1 recovery before proceeding to Phase 3.