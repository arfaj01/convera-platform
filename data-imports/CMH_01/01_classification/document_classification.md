# CMH_01 — Phase 2 Document Classification

> **Generated:** 2026-05-05
> **Source inventory:** `data-imports/CMH_01/00_inventory/file_inventory.csv` (547 files)
> **Output:** `data-imports/CMH_01/01_classification/document_classification.{csv,md}`
> **F1 status:** RESOLVED (commit `e32e664`); SMART workbook is the canonical primary source.

---

## 1. Distribution by canonical category

| Category | Count | Import relevance |
|---|---:|---|
| `contract_master` | 6 | HIGH — primary import |
| `boq` | 7 | HIGH — primary import |
| `financial_claim` | 22 | MEDIUM — PDF attachments |
| `completion_certificate` | 22 | MEDIUM — PDF attachments |
| `progress_evidence` | 1 | LOW — cross-validation |
| `attachment_supporting` | 17 | LOW — templates / code |
| `change_order` | 15 | HIGH — primary import |
| `ministry_correspondence` | 1 | LOW — informational |
| `approval` | 22 | MEDIUM — PDF attachments |
| `report` | 427 | LOW — auto-generated derivative |
| `drawing_technical` | 1 | LOW — informational |
| `staff_manpower` | 6 | LOW — informational |
| **TOTAL** | **547** |  |

---

## 2. High-relevance files (primary imports)

Files in the HIGH bucket are direct sources for the contract / BOQ / change-order tables in the platform. Most of these are PDFs that will be linked as attachments; the structured data comes from the SMART workbook.

| Path | Category | Confidence |
|---|---|---|
| `01_CONTRACT/README.md` | `contract_master` | high |
| `01_CONTRACT/العقد.pdf` | `contract_master` | high |
| `01_CONTRACT/اللائحة التنفيذية لنظام المنافسات والمشتريات الحكومية المعدلة لعام 1441ه.pdf` | `contract_master` | high |
| `01_CONTRACT/المواصفات الفنية.pdf` | `contract_master` | high |
| `01_CONTRACT/عقد المشروع.pdf` | `contract_master` | high |
| `01_CONTRACT/كراسة الشروط والمواصفات.pdf` | `contract_master` | high |
| `02_BOQ/2023-MOMRA-0150-S     طلب اعتماد جداول الزيادات والوفورات والعقد المعدل (الامر التغييري رقم5)  .pdf` | `boq` | high |
| `02_BOQ/BOQ.pdf` | `boq` | high |
| `02_BOQ/BOQ.xlsx` | `boq` | high |
| `02_BOQ/README.md` | `boq` | high |
| `02_BOQ/جداول الكميات.pdf` | `boq` | high |
| `02_BOQ/طلب اعتماد جداول الزيادات والوفورات والبنود المستحدثة.pdf` | `boq` | high |
| `03_VO/01_05_03_24_VO_REHQ (1)(امر تغيير رقم-1 ).pdf` | `change_order` | high |
| `03_VO/02_29_07_24_VO_REHQ(امر تغيير رقم-2).pdf` | `change_order` | high |
| `03_VO/03_02_09_24_VO_REHQ)لمر تغيير رقم-3).pdf` | `change_order` | high |
| `03_VO/04_04_12_24_VO_REHQ)امر تغيير رقم-4).pdf` | `change_order` | high |
| `03_VO/05_01_06_25_VO_REHQ(امر تغيير رقم-5).pdf` | `change_order` | high |
| `03_VO/2023-MOMRA-0018 - S   جداول الكميات المحدثة (المناقلة رقم 1 ).pdf` | `change_order` | high |
| `03_VO/2023-MOMRA-0072-S  الأوامر التغيرية.pdf` | `change_order` | high |
| `03_VO/2023-MOMRA-0073-S  طلب اعتماد البنود المستحدثة.pdf` | `change_order` | high |
| `03_VO/2023-MOMRA-0121- S  طلب اعتماد البنود المستحدثة.pdf` | `change_order` | high |
| `03_VO/OVs/01_05_03_24_VO_REHQ.pdf` | `change_order` | high |
| `03_VO/OVs/02_29_07_24_VO_REHQ.pdf` | `change_order` | high |
| `03_VO/OVs/03_02_09_24_VO_REHQ.pdf` | `change_order` | high |
| `03_VO/OVs/04_04_12_24_VO_REHQ.pdf` | `change_order` | high |
| `03_VO/OVs/05_01_06_25_VO_REHQ.pdf` | `change_order` | high |
| `03_VO/README.md` | `change_order` | high |
| `CMH_01_SMART.xlsx` | `boq` | high |

---

## 3. Medium-relevance files (attachment links)

These PDFs are attached to claim records as document evidence. Phase 4 (normalization) will produce a documents.normalized.json that maps each PDF to its claim_id via the SMART workbook's `سجل المرفقات` sheet.

Total medium-relevance files: **66** (22 financial_claim + 22 approval + 22 completion_certificate).

---

## 4. Low-relevance files (skipped or cross-reference only)

Total low-relevance files: **453**.

| Bucket | Count | Treatment |
|---|---:|---|
| `report` (auto-generated derivative) | 427 | Skip — not imported. |
| `attachment_supporting` (templates / code) | 17 | Skip — not project data. |
| `progress_evidence` | 1 | Cross-validation only. |
| `staff_manpower` | 6 | Informational only. |
| `ministry_correspondence` | 1 | Informational only. |
| `drawing_technical` | 1 | Informational only. |

---

## 5. NEEDS REVIEW files

None. Every file has a confident category assignment.

---

## 6. Phase 3 readiness

| Gate | Status |
|---|---|
| Source folder is read-only honoured | ✅ |
| Every file has a category + confidence + reason | ✅ |
| HIGH-relevance files identified for primary import | ✅ |
| MEDIUM-relevance files identified for attachment linking | ✅ |
| LOW-relevance files marked skip/cross-reference | ✅ |
| Canonical SMART workbook available (F1 resolved) | ✅ |

**Phase 3 unblocked.** Begin structured extraction from `CMH_01_SMART.xlsx`, with PDF attachments linked through the `سجل المرفقات` sheet.