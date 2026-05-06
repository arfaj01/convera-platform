# CMH_01 — Phase 4 Data Gaps

> Generated 2026-05-05 alongside the normalized datasets under `data-imports/CMH_01/03_normalized/`.

## 1. Resolved (no gap)

| Gap (raw layer) | Resolution |
|---|---|
| Contract master | 1 row in `العقد` extracted at high fidelity. |
| BOQ items | 386 items extracted; 1 sample row + 0 empty/legacy rows quarantined. |
| Claims | 21 claims kept; 15 excluded (other contracts, blanks, samples). |
| Claim line items | 1562 progress lines kept; 242 excluded (zero-progress, samples, foreign claim_seq). |
| VOs | 5 real VOs kept; 5 excluded. |
| Stakeholders / users | 6 users normalized; all 6 expected CMH_01 users present. |

## 2. Open gaps (carried into Phase 5/6)

| Gap | Severity | Resolution path |
|---|---|---|
| BOQ unit prices missing on some rows | medium | Cross-validate against `BOQ.xlsx` Sheet2 in Phase 5; if still missing, the platform's BOQ template will fall back to manual entry. |
| English party names missing (party_name) | low | Populate from `01_CONTRACT/عقد المشروع.pdf` if the platform requires English names; else null is acceptable. |
| `prev_progress` values from SMART workbook are informational | none | The platform RPC (Migration 048) recomputes `prev_progress` server-side from approved claims; SMART values are NOT trusted for this field. |
| Workflow log status mapping for `مرتجعة`/`معادة` defaults to `returned_by_supervisor` | low | Phase 5 reconciles by checking the immediately-preceding from_status to pick the precise `returned_by_*` variant. |
| Some claim status values may not map | low | Phase 5 reports any unmapped status; missing maps are logged with `data_quality_notes`. |

## 3. Quarantined samples / template rows (not migrated)

Located under `data-imports/CMH_01/03_normalized/excluded_records/`:

- `boq_items_excluded.json` — sample row 'إنذار حريق — مثال' + empty rows
- `claims_excluded.json` — non-CMH_01 fixture rows + empty rows
- `claim_line_items_excluded.json` — sample lines + zero-progress lines
- `variation_orders_excluded.json` — blank/zero rows + sample 'مثال'
- `variation_order_items_excluded.json` — orphan rows
- `workflow_log_excluded.json` — log entries for foreign claim_seq
- `attachments_excluded.json` — rows without filename

These are evidence-only; they document what was deliberately not migrated.

## 4. No legacy values remain

The Phase 4 normalizer uses the **current** mapping (Migration 045/046):

- `جودة` → `quality` (NOT `reviewer`)
- `مدير مشروع` → `project_manager` (NOT `reviewer`)
- `عند الجودة` → `under_quality_review` (NOT `under_admin_review`)
- `عند مدير المشروع` → `under_project_manager_review` (NOT `under_admin_review`)
- Project code resolved as `CMH01` for `CMH_01-C01`, mirroring `lib/claim-number.ts`.

Phase 5 will assert no legacy value sneaks back in.
