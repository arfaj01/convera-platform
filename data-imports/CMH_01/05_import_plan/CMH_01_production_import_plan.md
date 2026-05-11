# CMH_01 — Production Import Plan

> **Date:** 2026-05-10
> **Target:** Supabase production project ref `ngwxlockzkjpmzuvgakx`
> **Inputs:** Phase 2 source validation, Phase 3 production duplicate check
> **Status:** PLAN ONLY — `--execute` requires `APPROVE-IMPORT-CMH01-PRODUCTION` after a clean dry-run

---

## 1. Constraints inherited from operator standing rules

- ❌ No `auth.users` mutations. No Auth Admin API.
- ❌ No password rotation as part of this import.
- ❌ No `INSERT/UPDATE/DELETE/CREATE/ALTER/DROP/TRUNCATE` outside the explicitly approved CMH_01 entity scope.
- ❌ No use of `create_claim_with_items_atomic` RPC (it has the integer/text bug from Migration 049 not yet applied to production — see `docs/migration_049_production_apply_note.md`). We use direct table-level `INSERT`s and rely on the column-level checks already enforced by the schema.
- ❌ No `git push`. No exposing secrets in commit/log/screenshot.
- ✅ All writes inside ONE transaction (`BEGIN ... COMMIT`); rollback on any error.
- ✅ Use `SET LOCAL session_replication_role = 'replica'` once at top of the transaction to suppress the `check_claim_within_contract_limit` trigger for historical-data import (claims totalling 131 % of base — see Phase 2 §4 finding G4). The setting is automatic-revert at COMMIT/ROLLBACK.

## 2. Target tables and source files

| Source (`03_normalized/…`) | Target table (production schema) | Operation |
|---|---|---|
| `contract.json` (1 row) | `contracts` | **UPDATE** the existing CMH_01-C01 placeholder shell (Phase 3 §1). Set base_value, total_value, dates, party_name, title_ar, boq_progress_model, retention_pct, status, external_user_id (info@gdci.com.sa). Do NOT change `region` (already correct) or `created_at`. |
| `boq_items.csv` (442 rows) | `contract_boq_templates` | INSERT (currently 0 rows for CMH_01) |
| `user_contract_roles.csv` (6 rows) | `user_contract_roles` | UPSERT — 5 already match; one row (`anaalghamdi-contractor` reviewer→auditor) requires UPDATE if operator approves Option A in Phase 3 §3 |
| (no staff items in source) | `contract_staff_templates` | nothing to do |
| `change_orders.csv` (5 VOs) | `change_orders` | INSERT |
| `change_order_items.csv` (603 rows) | `change_order_boq_items` | INSERT |
| (no change_order_staff_items) | `change_order_staff_items` | nothing |
| `claims.csv` (21 rows, all status='approved') | `claims` | INSERT, with trigger suppression |
| `claim_line_items.csv` (1 707 rows) | `claim_boq_items` | INSERT |
| (no staff lines) | `claim_staff_items` | nothing |
| `claim_documents.csv` (70) + 35 approvals + 35 certificates rows in normalized | `documents` | INSERT (file_path placeholders for now; physical file upload deferred to Phase 9) |
| `claim_workflow.csv` (89 entries) | `claim_workflow` | INSERT — historical workflow trail |

Total INSERTs / UPDATEs (counted, not estimated): **1 contract UPDATE, 1 user_contract_roles UPDATE (conditional), 442+603+21+1707+5+70+35+35+89 ≈ 3007 INSERTs**.

## 3. Insert order

1. **Pre-flight asserts** — run BEFORE any write:
   - `current_setting('cluster_name', true)` does NOT contain `jrqkzwacerdudmeacvar`
   - `EXISTS(SELECT 1 FROM contracts WHERE contract_no='CMH_01-C01')` (we expect this to be true → confirms our UPDATE target)
   - 6 stakeholder emails resolve to existing `profiles.id` UUIDs
   - `imports_columns_exists` = true
2. **Open transaction** + `SET LOCAL session_replication_role = 'replica'`
3. **INSERT INTO `imports`** (status='running', started_at=NOW(), notes='CMH_01 controlled production import')
4. **UPDATE contracts** for CMH_01-C01 (single row)
5. **UPDATE user_contract_roles** to fix `anaalghamdi`'s role (only if Option A approved in Phase 3 §3)
6. **INSERT INTO contract_boq_templates** (442 rows) — one bulk multi-row insert
7. **INSERT INTO change_orders** (5 rows) — single batch
8. **INSERT INTO change_order_boq_items** (603 rows) — single batch
9. **INSERT INTO claims** (21 rows) — single batch (trigger is suppressed)
10. **INSERT INTO claim_boq_items** (1 707 rows) — chunked into 200-row batches
11. **INSERT INTO documents** (70+35+35 placeholder rows)
12. **INSERT INTO claim_workflow** (89 historical workflow entries)
13. **UPDATE imports** SET status='completed', finished_at=NOW(), counts=…
14. **COMMIT** (`session_replication_role` auto-reverts)

## 4. Unique keys / idempotency

| Table | Natural unique key | Idempotency handling |
|---|---|---|
| `contracts` | `(contract_no)` | UPDATE-by-contract_no — already present, won't double-create |
| `contract_boq_templates` | `(contract_id, item_no)` | INSERT … ON CONFLICT (contract_id, item_no) DO NOTHING |
| `user_contract_roles` | `(user_id, contract_id, contract_role)` (per Migration 045) | UPSERT |
| `change_orders` | `(contract_id, order_no)` | ON CONFLICT DO NOTHING |
| `change_order_boq_items` | `(change_order_id, item_no)` | ON CONFLICT DO NOTHING |
| `claims` | `(contract_id, claim_no)` | ON CONFLICT DO NOTHING |
| `claim_boq_items` | `(claim_id, item_no)` | ON CONFLICT DO NOTHING |
| `documents` | `id` only (uuid) — no natural key | best-effort idempotency: pre-DELETE-WHERE-imports-id-matches if re-running fails. For the first run, ON CONFLICT (id) DO NOTHING is enough. |
| `claim_workflow` | `id` only — no natural key | same as documents |

**Idempotency strategy:** if the importer is re-run after partial success, the ON CONFLICT clauses make BOQ/change_order/claim re-runs safe. `documents` and `claim_workflow` rely on the same `imports.id` provenance — if the first attempt rolled back, no rows are visible and re-run is clean.

## 5. User / role mapping strategy (NO Auth Admin)

- **Source-of-truth for user_id:** `profiles.id` looked up by `profiles.email`.
- All 6 stakeholders confirmed present in `profiles` (Phase 3 §4). **No new users will be created.**
- If, at the time of `--dry-run` or `--execute`, any of the 6 emails CANNOT be resolved → log `BLOCKED_USER_MAPPING` for that email, abort import (refuse to proceed with placeholder UUIDs).
- `contracts.external_user_id` ← profile id of `info@gdci.com.sa` (the contractor).
- `contracts.admin_id` ← profile id of `anaalghamdi-contractor@momah.gov.sa` (the auditor — the closest fit to "admin/auditor" semantic in the schema).
- `contracts.director_id` ← profile id of `ma.alarfaj@momah.gov.sa`.
- `contracts.reviewer_id` ← (optional, can leave NULL — not a strict-required column).
- `claim_workflow.actor_id` ← per-event mapped from `claim_workflow.csv`'s actor_email column via the same `profiles` lookup.

## 6. Attachment strategy

- For this Phase 6/8 import, `documents` rows are inserted with **placeholder file_path values** (e.g. `placeholder://04_PAYMENTS/المستخلص NN.pdf`).
- Physical file upload to Supabase Storage is **deferred to Phase 9 (post-import)** and is out of scope of this controlled import.
- The `claim_id` column in `documents` resolves to the inserted-claim UUIDs via a 2-pass approach: first pass inserts claims and stores email/seq → claim_id map in script memory; second pass inserts documents using that map.
- Operator can later batch-update `documents.file_path` once Storage upload is complete.

## 7. Workflow strategy

- `claim_workflow.csv` carries 89 historical events spanning the 21 claims' lifecycles (creation → submission → 6 review stages → approval).
- Each event is INSERTed verbatim with its original `created_at` timestamp preserved (use `OVERRIDING SYSTEM VALUE`-equivalent if `claim_workflow.created_at` has a `DEFAULT NOW()` clause that needs override).
- Claims will land at `status='approved'` (matching source); the workflow trail explains how each got there.

## 8. Transaction strategy

- **Single transaction** for the whole import (BEGIN at step 2, COMMIT at step 14 above). On any error → ROLLBACK.
- Why single-transaction: ~3 000 row inserts is well within Postgres transaction-size limits. Atomicity matters more than memory pressure here.
- The `SET LOCAL session_replication_role = 'replica'` is explicitly transaction-scoped (`LOCAL`) — automatically reverts at COMMIT/ROLLBACK.

## 9. Rollback strategy

- **Pre-import:** ROLLBACK is implicit if any pre-flight assert fails. Nothing to undo.
- **Mid-import error:** transaction ROLLBACKs. Re-run from beginning.
- **Post-COMMIT (manual undo, last resort):**
  ```sql
  -- These are FOR DOCUMENTATION ONLY. Do not run unless operator explicitly approves.
  BEGIN;
  DELETE FROM claim_workflow      WHERE claim_id IN (SELECT id FROM claims WHERE contract_id=(SELECT id FROM contracts WHERE contract_no='CMH_01-C01'));
  DELETE FROM documents           WHERE contract_id=(SELECT id FROM contracts WHERE contract_no='CMH_01-C01') OR claim_id IN (SELECT id FROM claims WHERE contract_id=(SELECT id FROM contracts WHERE contract_no='CMH_01-C01'));
  DELETE FROM claim_boq_items     WHERE claim_id IN (SELECT id FROM claims WHERE contract_id=(SELECT id FROM contracts WHERE contract_no='CMH_01-C01'));
  DELETE FROM claims              WHERE contract_id=(SELECT id FROM contracts WHERE contract_no='CMH_01-C01');
  DELETE FROM change_order_boq_items WHERE change_order_id IN (SELECT id FROM change_orders WHERE contract_id=(SELECT id FROM contracts WHERE contract_no='CMH_01-C01'));
  DELETE FROM change_orders       WHERE contract_id=(SELECT id FROM contracts WHERE contract_no='CMH_01-C01');
  DELETE FROM contract_boq_templates WHERE contract_id=(SELECT id FROM contracts WHERE contract_no='CMH_01-C01');
  -- Restore the contract to its pre-import placeholder state:
  UPDATE contracts SET base_value=0, total_value=0, status='draft', start_date=NULL, end_date=NULL, party_name='', title_ar='', boq_progress_model='count' WHERE contract_no='CMH_01-C01';
  -- user_contract_roles intentionally untouched (they pre-existed).
  COMMIT;
  ```

## 10. Validation queries to run after `--execute` succeeds

```sql
-- Q-VAL-1: contract is now populated
SELECT base_value, total_value, status, party_name, title_ar, boq_progress_model
  FROM contracts WHERE contract_no='CMH_01-C01';
-- Expected: base_value=57188871.80, total_value=65767202.57, status='active' or 'closed', non-empty title/party, boq_progress_model='percentage'.

-- Q-VAL-2: child counts match expected
SELECT
  (SELECT COUNT(*) FROM contract_boq_templates WHERE contract_id=(SELECT id FROM contracts WHERE contract_no='CMH_01-C01')) AS boq_count_expected_442,
  (SELECT COUNT(*) FROM change_orders          WHERE contract_id=(SELECT id FROM contracts WHERE contract_no='CMH_01-C01')) AS change_orders_expected_5,
  (SELECT COUNT(*) FROM change_order_boq_items WHERE change_order_id IN (SELECT id FROM change_orders WHERE contract_id=(SELECT id FROM contracts WHERE contract_no='CMH_01-C01'))) AS vo_items_expected_603,
  (SELECT COUNT(*) FROM claims                 WHERE contract_id=(SELECT id FROM contracts WHERE contract_no='CMH_01-C01')) AS claims_expected_21,
  (SELECT COUNT(*) FROM claim_boq_items        WHERE claim_id IN (SELECT id FROM claims WHERE contract_id=(SELECT id FROM contracts WHERE contract_no='CMH_01-C01'))) AS claim_lines_expected_1707,
  (SELECT COUNT(*) FROM claim_workflow         WHERE claim_id IN (SELECT id FROM claims WHERE contract_id=(SELECT id FROM contracts WHERE contract_no='CMH_01-C01'))) AS workflow_expected_89,
  (SELECT COUNT(*) FROM documents              WHERE contract_id=(SELECT id FROM contracts WHERE contract_no='CMH_01-C01') OR claim_id IN (SELECT id FROM claims WHERE contract_id=(SELECT id FROM contracts WHERE contract_no='CMH_01-C01'))) AS docs_expected_140;

-- Q-VAL-3: financial totals reconcile
SELECT SUM(total_amount) AS sum_claim_totals_expected_75105699_05
  FROM claims WHERE contract_id=(SELECT id FROM contracts WHERE contract_no='CMH_01-C01');

-- Q-VAL-4: imports row recorded
SELECT id, status, started_at, finished_at, notes FROM imports
 WHERE notes ILIKE '%CMH_01 controlled%' ORDER BY started_at DESC LIMIT 1;
```

## 11. Stop gates

The script (Phase 6) MUST stop and refuse to proceed if any of:

1. `SUPABASE_URL` does NOT contain `ngwxlockzkjpmzuvgakx` → exit 2.
2. `SUPABASE_SERVICE_ROLE_KEY` is missing or has placeholder shape → exit 2.
3. `--confirm` is not exactly `IMPORT CMH_01 TO PRODUCTION` → exit 2.
4. Pre-flight: any of the 6 stakeholder emails fail the `profiles` lookup → log `BLOCKED_USER_MAPPING` and exit 3.
5. Pre-flight: `CMH_01-C01` placeholder row not found → exit 3 (operator's expected starting state is wrong).
6. Pre-flight: any child-count > 0 (claims/BOQ/change_orders/etc. for CMH_01) → exit 3 (would create duplicates if forced; operator must reconcile first).
7. Mid-import: any INSERT errors → ROLLBACK and exit 4.
8. Post-import: validation Q-VAL-2 row counts don't match expected → log "POST_VAL_MISMATCH" and exit 5 (DO NOT auto-rollback after COMMIT — alert operator).

## 12. Assumptions

- Operator has updated their local `prod-temp.env` (or `.env.local`) to point at production with the new `<server-side secret key>*` key OR the legacy JWT (both work for PostgREST per recent diagnose).
- The 6 stakeholder profile-IDs are stable (Supabase auth-managed UUIDs don't change).
- `documents` rows accept null `claim_id` for contract-level docs and null `contract_id` for claim-only docs (FK columns are nullable per schema).
- The `imports` table allows multiple rows; the import script just inserts a new one each run.

## 13. Operator decision gates

| # | Gate | Decision needed |
|---|---|---|
| D1 | `anaalghamdi-contractor@momah.gov.sa` role: keep `reviewer` (prod) or change to `auditor` (source)? | Operator picks Option A or B. Default: A (auditor — matches source). |
| D2 | `contract.party_name` not in source — derive from `info@gdci.com.sa` profile.organization, or hard-code "شركة جلف للتطوير والمقاولات"? | Operator confirms exact party name. |
| D3 | The 22nd PDF in `04_PAYMENTS/` not in `claims.csv` — operator inspects whether to add a 22nd claim or skip. Default: skip (21 claims). | Operator confirms "21 claims is correct." |
| D4 | After dry-run passes, operator types: `APPROVE-IMPORT-CMH01-PRODUCTION` to authorize `--execute`. | Required — script refuses without this exact phrase. |

---

*Companion docs: Phase 5 dry-run report, Phase 6 controlled-import script + runbook, Phase 7 final readiness report.*
