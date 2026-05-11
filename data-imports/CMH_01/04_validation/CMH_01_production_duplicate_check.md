# CMH_01 — Production Duplicate Check (read-only)

> **Date:** 2026-05-10
> **Target:** Supabase production project ref `ngwxlockzkjpmzuvgakx`
> **Method:** SELECT-only queries via Studio SQL Editor on the production project.
> **Result:** Production has a **placeholder shell** for `CMH_01-C01` plus the **6 user_contract_roles already assigned**. No claims, no BOQ items, no change orders, no documents. **Strategy must be UPDATE-the-shell + INSERT-children, NOT INSERT-the-contract**.

This phase ran read-only metadata + count queries against production. **No row was inserted, updated, or deleted.**

---

## 1. Contract presence

```
SELECT row_to_json(c) FROM (SELECT … FROM contracts WHERE contract_no='CMH_01-C01') c;
```

Result:
```jsonc
{
  "contract_no":         "CMH_01-C01",
  "type":                "construction",
  "status":              "draft",         //  ← placeholder, not yet active
  "base_value":          0,               //  ← empty
  "total_value":         0,               //  ← empty
  "retention_pct":       5,               //  KSA standard, OK
  "start_date":          null,
  "end_date":            null,
  "duration_months":     null,
  "region":              "الرياض",        //  ← already correct
  "party_name":          "",              //  ← empty
  "title_ar":            "",              //  ← empty
  "boq_progress_model":  "count",         //  ← MISMATCH (source has 'percentage')
  "created_at":          "2026-04-27T12:13:03Z",
  "updated_at":          "2026-04-27T12:13:03Z"
}
```

**Interpretation:** the row was created on 2026-04-27 — likely during one of the staging-schema scaffolding runs that propagated a placeholder into production. It has the right `contract_no`, `region`, and `type`, but every other field is empty or wrong. This is exactly the row we need to populate, but it cannot be re-INSERTed because of the `UNIQUE(contract_no)` constraint.

---

## 2. Children attached to the placeholder (counts)

| Table | Count for CMH_01-C01 |
|---|---:|
| `contract_boq_templates` | **0** |
| `contract_staff_templates` | **0** |
| `change_orders` | **0** |
| `claims` | **0** (any status) |
| `documents` (where `contract_id = CMH_01-C01.id`) | not measured (table uses `contract_id` directly, not `entity_type/entity_id` — see §5) |

**Bottom line:** zero substantive data attached. Production is functionally empty for CMH_01.

---

## 3. user_contract_roles — already populated (6 rows)

```
SELECT u.email, ucr.contract_role FROM user_contract_roles ucr
  JOIN profiles u  ON u.id = ucr.user_id
  JOIN contracts c ON c.id = ucr.contract_id
 WHERE c.contract_no = 'CMH_01-C01' ORDER BY u.email;
```

| email | prod `contract_role` | source-expected | match? |
|---|---|---|---|
| `aaldera-contractor@momah.gov.sa` | `quality` | `quality` | ✅ |
| `anaalghamdi-contractor@momah.gov.sa` | **`reviewer`** | **`auditor`** | ❌ **MISMATCH** |
| `halhablayn-contractor@momah.gov.sa` | `project_manager` | `project_manager` | ✅ |
| `info@gdci.com.sa` | `contractor` | `contractor` | ✅ |
| `ma.alarfaj@momah.gov.sa` | `final_approver` | `final_approver` | ✅ |
| `mahmoud.ragab@beeah.sa` | `supervisor` | `supervisor` | ✅ |

5 / 6 rows already match the SMART workbook's role mapping. The single mismatch (`anaalghamdi-contractor` is `reviewer` in prod but `auditor` in source) is a **decision gate** for the operator:

- **Option A (recommended):** UPDATE the row to `auditor` (matches source-of-truth SMART workbook + production's enriched `contract_role` semantics where auditor performs financial verification).
- **Option B:** keep `reviewer` (existing prod assignment); update the source SMART workbook to match.

Either way, the migration plan must DOCUMENT this discrepancy and the operator must sign off before applying. The user is the same person; only the per-contract role-label differs.

---

## 4. profiles for the 6 stakeholders (sanity check)

```
SELECT email, role, id::text FROM profiles WHERE email IN (…) ORDER BY email;
```

All 6 emails exist in `profiles`. Their `profiles.role` values (the **global** UserRole) are:

| email | global `profiles.role` |
|---|---|
| `aaldera-contractor@momah.gov.sa` | `reviewer` |
| `anaalghamdi-contractor@momah.gov.sa` | `reviewer` |
| `halhablayn-contractor@momah.gov.sa` | `consultant` |
| `info@gdci.com.sa` | `contractor` |
| `ma.alarfaj@momah.gov.sa` | `director` |
| `mahmoud.ragab@beeah.sa` | (matches schema's user_role enum value, full result truncated in probe) |

All values are members of the production `user_role` enum (5 values: `director, admin, reviewer, consultant, contractor`). **No user creation needed.** The per-contract specialised roles (`final_approver`, `project_manager`, `quality`, `auditor`, `supervisor`) are correctly tracked in `user_contract_roles` (Q3 above), separate from the global `profiles.role`. **This is the post-Migration-045 design intent and is working correctly here.**

---

## 5. `convera_users` table (legacy auth path — not needed for the import)

```
SELECT email, role FROM convera_users WHERE email IN (…the 6…);
```

Returned only **1 row**: `mahmoud.ragab@beeah.sa` with `role=consultant`.

**Interpretation:** `convera_users` was the original prototype-auth table (pre-Migration 047). It is no longer the auth source-of-truth — production's `profiles` + Supabase Auth (`auth.users`) is. We can ignore `convera_users` for this migration. **No action required.**

---

## 6. `documents` table schema (corrected)

The `documents` table in production does NOT use the `(entity_type, entity_id)` pattern this orchestrator initially assumed. Actual columns:

```
id (uuid), name (text), original_name (text), file_path (text),
file_size (bigint), mime_type (text), type (USER-DEFINED enum),
contract_id (uuid), claim_id (uuid), description (text),
is_public (boolean), uploaded_by (uuid), created_at (timestamptz)
```

So `documents` rows reference parents directly via `contract_id` and `claim_id` columns. The CMH_01 attachment-import in Phase 4 will use these column names directly (NOT `entity_type='claim', entity_id=…`).

---

## 7. `imports` table — exists and is available for governance trail

`imports_columns_exists = true` confirms Migration 044's `imports` and `import_errors` tables are deployed. The CMH_01 import script (Phase 6) will write a single `imports` row at start (status='running') and update at end (status='completed' or 'failed'), plus per-error `import_errors` rows if any. This gives the operator an audit trail.

---

## 8. Production-wide contract inventory (context)

```
SELECT contract_no, status, base_value::int AS base_value,
       left(COALESCE(NULLIF(title_ar,''), '<empty>'), 55) AS title_ar
FROM contracts ORDER BY contract_no;
```

Production has roughly 17 contracts (per earlier observation). The four "CMH" / "PMH" entries are **all placeholder shells** with `base_value = 0` and empty titles — created during the same 2026-04-27 scaffolding run as our `CMH_01-C01`. Two real "تأهيل…بالعليا" contracts exist (`241039011332` and `250101116428`) but they are **different projects** (Security/Safety completion + HVAC rehab) — not duplicates of CMH_01.

**Conclusion:** there is no duplicate-data risk in production for CMH_01's content. The shell is the only existing CMH_01 row, and it is intentionally empty awaiting this migration.

---

## 9. Decision matrix — should we proceed?

| Item | Status | Risk |
|---|---|---|
| Contract row already exists (placeholder) | ⚠ UPDATE-not-INSERT required | LOW — operator is aware; migration plan §3 will use `UPDATE` |
| user_contract_roles 5/6 match | ✅ | NONE for the matching 5; discrepancy on `anaalghamdi` documented for operator sign-off |
| Zero BOQ / claims / change_orders attached | ✅ Clean slate for child rows | NONE |
| documents schema column-shape | ✅ Now known | NONE |
| imports table available | ✅ Audit trail enabled | NONE |
| Other "CMH"/"PMH" placeholders in prod | Unrelated; no overlap with CMH_01 data | NONE |
| `boq_progress_model='count'` in placeholder vs source `'percentage'` | ⚠ Will be fixed by the UPDATE in §3 | LOW |
| `claim_number` namespace already used by other contracts? | TBD — Phase 5 will check | LOW (Migration 047's claim_number includes project_code prefix `CMH01R…` so collision is impossible if our project_code is unique) |

**Recommendation:** ✅ **PROCEED** to Phase 4 (refresh import plan) and Phase 5 (dry-run). The duplicate risk is bounded and procedurally manageable. The only operator-decision gate is the `anaalghamdi` role mismatch (auditor vs reviewer) which can be settled in Phase 4 via a single explicit assertion.

---

## 10. Confirmations

- ✅ All queries above were `SELECT` / metadata only.
- ✅ No `INSERT/UPDATE/DELETE/MERGE/ALTER/DROP` was issued in this phase.
- ✅ `auth.users` was NOT queried by the migration assessment in this phase. (We separately confirmed the 6 stakeholder emails exist in `auth.users` from the earlier rotation-prep work, but no Auth Admin call was made.)
- ✅ Production data is unchanged.

---

*Companion docs: `04_validation/CMH_01_source_validation_refresh.md` (Phase 2 — source counts), `05_import_plan/CMH_01_production_import_plan.md` (Phase 4 — uses these findings as inputs).*
