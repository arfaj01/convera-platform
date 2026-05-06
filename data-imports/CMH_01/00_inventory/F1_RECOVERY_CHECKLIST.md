# CMH_01 — F1 Recovery Checklist

> **Purpose:** unblock Phase 3 (extraction) by replacing the corrupted master workbook with a known-good copy. This file is the operator runbook for that single step. **Phases 2 and 3 are paused until this is done.**

---

## 1. Where to put the recovered file

Place the recovered workbook **inside the official repo**, NOT in the source folder.

**Exact filename and path** (Windows host):

```
C:\Users\Administrator\Desktop\convera-platform\data-imports\CMH_01\00_inventory\source-snapshot\CMH_01_SMART.xlsx
```

The folder `source-snapshot\` does not exist yet. Create it during the copy (Explorer's "New folder" or `mkdir`). Filename must be exactly `CMH_01_SMART.xlsx` (case-sensitive in the bash sandbox).

> **Do NOT replace the original at `…\PROJECTS\CMH_01\CMH_01_SMART.xlsx`.**
> The source folder is treated as read-only by mission rule §1.1; replacing the original would break that contract and lose forensic evidence of the corruption.

---

## 2. How to verify the file before resuming

Three independent checks. **Run all three.** If any fails, do NOT tell me to resume — try a different recovery source instead.

### Check 1 — open in Excel

Double-click the file. Excel must open it without offering "auto-recover" or showing a "corrupt file" warning. If Excel says the file is damaged but can attempt recovery, click "Yes" → save the recovered copy as the file you'll place in `source-snapshot/`.

### Check 2 — verify it contains the 12 expected sheets

After opening in Excel, the workbook should show roughly the following sheet tabs (Arabic; from the project README — the exact set may differ slightly between v3 / v4 / v5):

- العقد (Contract)
- جدول الكميات (BOQ)
- المطالبات (Claims)
- بنود المطالبات (Claim items)
- أوامر التغيير (Change orders / VOs)
- بنود أوامر التغيير (VO items)
- شهادات الإنجاز (Completion certificates)
- اعتمادات الصرف (Payment approvals)
- الكوادر (Staff / manpower) — if present
- سجل الحركة (Movement log)
- لوحة الجاهزية (Readiness panel)
- لوحة موجز (KPI summary)

If fewer than ~10 of these are present, you may have shared a partial export or an older snapshot. Try a different recovery source.

### Check 3 — file size sanity

The corrupted file on disk is 838 014 bytes. A healthy v5 export is typically **800 KB – 2 MB** depending on how much data is in the claim/VO sheets. If your recovered file is below 200 KB or above 10 MB, please flag it before I resume.

---

## 3. The four checks I will run after you place the file

When you say "ready", I will run these in order. If any fails, I will stop and report — I will not auto-extract from a partially valid file.

### Check A — recognised Office file type

```bash
file data-imports/CMH_01/00_inventory/source-snapshot/CMH_01_SMART.xlsx
# Expected: 'Microsoft Excel 2007+' (the corrupted file actually passes this — it's necessary but not sufficient)
```

### Check B — valid ZIP archive (the corruption signature)

```bash
unzip -l data-imports/CMH_01/00_inventory/source-snapshot/CMH_01_SMART.xlsx | head -20
# Expected: a list of internal members starting with [Content_Types].xml, _rels/.rels, xl/workbook.xml, xl/worksheets/sheet1.xml, …
# Failure mode (the corruption today): "End-of-central-directory signature not found"
```

### Check C — Python `zipfile` + `openpyxl` round-trip

```bash
python3 -c "
import zipfile, openpyxl
p = 'data-imports/CMH_01/00_inventory/source-snapshot/CMH_01_SMART.xlsx'
zf = zipfile.ZipFile(p)
print(f'zip members: {len(zf.namelist())}')
wb = openpyxl.load_workbook(p, read_only=True, data_only=True)
print(f'sheets ({len(wb.sheetnames)}):')
for n in wb.sheetnames:
    ws = wb[n]
    print(f'  - \"{n}\"  rows={ws.max_row}  cols={ws.max_column}')
wb.close()
"
# Expected: 'zip members:' shows ≥30, then 'sheets (10–14):' followed by an Arabic-named tab list with row/col counts.
```

### Check D — content sanity (one assertion per critical sheet)

```bash
# Confirm a representative cell from each top-priority sheet is populated:
python3 -c "
from openpyxl import load_workbook
wb = load_workbook('data-imports/CMH_01/00_inventory/source-snapshot/CMH_01_SMART.xlsx', read_only=True, data_only=True)
def first_cell(name):
    if name in wb.sheetnames:
        ws = wb[name]
        for row in ws.iter_rows(max_rows=5, values_only=True):
            if any(c not in (None, '') for c in row):
                return row
    return None
# Best-effort per sheet name fragment match — Arabic naming varies.
for tag in ['عقد', 'كميات', 'مطالبات', 'تغيير', 'إنجاز', 'اعتماد']:
    matches = [n for n in wb.sheetnames if tag in n]
    for m in matches:
        r = first_cell(m)
        print(f'{m}: head row = {r}')
wb.close()
"
# Expected: each sheet's head row prints without errors and contains non-null values consistent with its purpose
# (e.g. the contract sheet head row should mention contract_no / contract_value / contractor name).
```

If A + B + C all pass and D shows non-null head rows on the contract / BOQ / claims sheets at minimum, I will declare F1 RESOLVED and resume Phase 2.

---

## 4. What happens if recovery is partial

If you can only recover a subset of the sheets (e.g. the contract + BOQ but not the claims log), share what you have anyway. We can:

- Run Phase 3 against the recovered sheets at **full fidelity**.
- Continue to extract only summary totals from the المستخلصات PDFs for the missing claim history.
- Mark each imported claim record with a `data_source: 'pdf_summary'` versus `'workbook_v5'` provenance flag so the operations team knows which records are item-level versus header-only.

You would still need to explicitly approve this hybrid path before I run extraction.

---

## 5. Confirmation: the legacy `_ETL/` toolkit will NOT be used as-is

`PROJECTS/CMH_01/_ETL/migrate.py` and `_ETL/config.py` are preserved untouched as historical evidence. **They will not be invoked.** Specifically:

- `_ETL/config.py::CLAIM_STATUS_MAP` collapses `عند الجودة` and `عند مدير المشروع` to the legacy `under_admin_review` value. The current platform has separate `under_quality_review` and `under_project_manager_review` stages (Migration 046).
- `_ETL/config.py::ROLE_MAP` collapses `جودة` and `مدير مشروع` roles to `reviewer`. The current platform recognises `quality` and `project_manager` as distinct ContractRole values (Migration 045).
- `_ETL/migrate.py` writes via the Supabase service-role key directly. The current platform's governance pipeline (open-claim guard, advisory lock, atomic RPC, project-code resolver) is bypassed.

Phase 4 (normalization) will introduce a refreshed status/role map that targets the current schema, and Phase 8 (controlled migration) will go through `convera-platform/scripts/import-cmh01-*.{js,py}` calling `/api/claims/create` and friends — never the legacy `migrate.py`.

---

## 6. Operator action summary

1. Recover `CMH_01_SMART.xlsx` from a known-good source (Excel auto-recover, OneDrive history, backup).
2. Place it at `data-imports/CMH_01/00_inventory/source-snapshot/CMH_01_SMART.xlsx` (create the `source-snapshot/` folder if missing).
3. Do **not** modify or replace the original under `PROJECTS\CMH_01\`.
4. Tell me "ready" — I will run Checks A → D, and resume Phase 2 → Phase 3 → Phase 4 autonomously upon green.
5. If any of A → D fails, I will stop and report; please share a different recovery source.

The mission stays paused on the operator side until step 4. No autonomous extraction happens before then.
