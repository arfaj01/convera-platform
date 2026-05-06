# CMH_01 Staging Migration — Operator Handover

> Authored 2026-05-06. Single-page handover for the technical operator who will execute Phase 8 once a staging environment is available. **Production migration is not approved. Read §9 before doing anything.**

---

## 1. Current status

**BLOCKED** at the staging-environment gate. The migration package is engineering-complete and ready to run, but no confirmed staging Supabase project is configured. `.env.local` currently points at the production project (`ngwxlockzkjpmzuvgakx`) and has placeholder credentials. Phase 8 will not run against production under any flag.

Latest commit on `main` carrying this work: `748d4ad — data-import: document CMH_01 staging setup requirement` (local only; not pushed).

---

## 2. What is already completed

- **Phase 1 — Inventory.** 547 source files catalogued under `data-imports/CMH_01/00_inventory/file_inventory.{csv,md}`.
- **F1 — Workbook recovery.** Corrupt master workbook replaced with a Tier-A repaired copy at `data-imports/CMH_01/00_inventory/source-snapshot/CMH_01_SMART.xlsx`. Validation in `data-imports/CMH_01/00_inventory/F1_RECOVERY_REPORT.md`.
- **Phase 2 — Classification.** All sources tagged by domain and authority tier.
- **Phase 3 — Structured extraction** from the recovered SMART workbook.
- **Phase 4 — Normalization.** 17 normalized files in `data-imports/CMH_01/03_normalized/`: 1 contract, 6 users + roles, 386 BOQ items, 21 claims, 1 562 claim line items, 5 VOs + 603 VO items, 70 attachments, 40 approvals, 35 certificates, plus the cumulative-progress index.
- **Phase 5 — Validation.** 14 reconciliation reports under `data-imports/CMH_01/04_validation/` (claims, BOQ, line items, VOs, attachments, fidelity, duplicates, scorecard).
- **Phase 6 — Import plan + Phase-8 approval gate** (`data-imports/CMH_01/05_import_plan/`).
- **Phase 7 — Dry-run.** Read-only API-payload preview against the official `/api/claims/create` shape; clean.
- **Claim-15 patch applied** in normalized layer (option-b-header-only — see §8).
- **Phase-8 driver script** committed at `scripts/import-cmh01-controlled.js`. Operator-driven, per-claim ENTER pause, never raw SQL, never legacy `_ETL/migrate.py`.
- **Staging readiness package** committed (commit `748d4ad`): `STAGING_SETUP_REQUIRED.md`, `staging_env_template.txt`, `scripts/check-cmh01-env.js`, runbook hard-gate edit.

---

## 3. What is blocked

Three fatal items reported by `node scripts/check-cmh01-env.js`:

1. `SUPABASE_URL` is the production project ref `ngwxlockzkjpmzuvgakx` — Phase 8 is staging-only.
2. `SUPABASE_SERVICE_ROLE_KEY` is an Arabic placeholder (`ضع_هنا_service_role_key`).
3. `PLATFORM_BASE_URL` is missing.

Until all three are resolved against a **confirmed staging Supabase project**, the controlled migration script will refuse to run.

---

## 4. Exact staging env variables required

Paste these into `.env.local` at the repo root, replacing each angle-bracketed placeholder with values from a **confirmed STAGING** Supabase project (never `ngwxlockzkjpmzuvgakx`). Template lives at `data-imports/CMH_01/08_migration/staging_env_template.txt`.

```
NEXT_PUBLIC_SUPABASE_URL=https://<staging-project-ref>.supabase.co
SUPABASE_URL=https://<staging-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<staging-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<staging-service-role-key>
PLATFORM_BASE_URL=http://localhost:3000
TEST_USER_PASSWORD=<bootstrap-password-if-needed>
```

Notes:
- If both `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_URL` are set, they must match.
- The service-role key must be a JWT (three dot-separated base64url segments, ≥ 100 chars). Never paste it into chat, tickets, screenshots, or any logged channel.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` is required for the local dev server but not for the import script itself.
- `TEST_USER_PASSWORD` is only required if `npm run seed:auth-users` will be used.

---

## 5. How to verify staging safety

Run the read-only safety gate. It makes **no DB or HTTP calls**, prints **only masked status**, and refuses production-shaped URLs:

```bash
node scripts/check-cmh01-env.js
```

Acceptable outcome: `RESULT: STAGING-SAFE` and exit code 0. The script enforces:

- `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`) is present, non-placeholder, and shaped as `https://<ref>.supabase.co`.
- The project ref is **not** `ngwxlockzkjpmzuvgakx`, and the URL contains neither `prod` nor `production`.
- `SUPABASE_SERVICE_ROLE_KEY` is present, JWT-shaped, and not a known placeholder pattern.
- `PLATFORM_BASE_URL` is present, non-placeholder, and starts with `http://` or `https://`.

If the script reports any `[FAIL]` line, do not proceed — fix `.env.local` and re-run. The script is the single source of truth for Phase-8 readiness.

---

## 6. Exact command sequence to run after staging env is populated

All commands are run from the repo root: `cd C:\Users\Administrator\Desktop\convera-platform`.

```bash
# (a) Repo + script integrity
npm run verify:repo-path
node --check scripts/check-cmh01-env.js

# (b) HARD GATE — must pass before anything else
node scripts/check-cmh01-env.js
#     expected: "RESULT: STAGING-SAFE"; exit 0

# (c) IAM diagnostics (read-only) — paste SQL/diagnostics/iam_user_health.sql
#     into the staging Supabase SQL editor; D1–D6 must all pass.

# (d) Source compile check (optional belt-and-braces)
npx tsc --noEmit

# (e) Backups — follow data-imports/CMH_01/05_import_plan/pre_migration_checklist.md

# (f) Start the platform locally against the staging DB
npx next dev --port 3000
#     wait until / responds and the dashboard renders.

# (g) Phase-8 dry-run (read-only, no DB writes)
node scripts/import-cmh01-controlled.js --dry-run

# (h) Phase-8 controlled migration (per-claim ENTER pause; staging only)
node scripts/import-cmh01-controlled.js \
  --confirm "PROCEED CMH_01" \
  --i-acknowledge-this-is-staging
```

Optional resume after a partial run:

```bash
node scripts/import-cmh01-controlled.js \
  --confirm "PROCEED CMH_01" \
  --i-acknowledge-this-is-staging \
  --resume-from-claim 14
```

The script logs every step to `data-imports/CMH_01/08_migration/migration_log.md`. Stops immediately on any failure.

---

## 7. Rollback references

If any step in §6 fails — or a post-flight check disagrees with the normalized layer — stop, do not retry forward, and consult the existing rollback artifacts:

- `data-imports/CMH_01/05_import_plan/rollback_strategy.md` — full rollback playbook (snapshot restore, partial-state recovery, contract-scoped DELETE order).
- `data-imports/CMH_01/05_import_plan/pre_migration_checklist.md` — pre-flight backup steps; rollback presumes these were taken.
- `data-imports/CMH_01/05_import_plan/phase8_approval_gate.md` — the operator approval contract; rollback authority sits with the same approver.
- `data-imports/CMH_01/04_validation/validation_summary.md` — post-flight reconciliation targets. If totals diverge from these, treat as an automatic abort signal and roll back rather than patch forward.

---

## 8. Claim 15 handling note

**Decision recorded: `option-b-header-only`** (see `data-imports/CMH_01/04_validation/claim_15_investigation.md` and `claim_15_patch_log.md`).

The SMART workbook structurally treats claim 15 as a zero-line-item event even though the corresponding payment PDF shows 9 661 835.75 SAR was paid. Rather than fabricate per-item progress, the normalized layer carries a **header-only** record for claim 15:

- `work_period_from = 2024-08-24`, `work_period_to = 2024-11-07`
- `boq_amount = 9 661 835.75`, `retention_amount = 966 183.575`, `vat_amount = 1 304 347.826`, `total_amount = 10 000 000.00`
- `data_quality_notes = "Claim header restored from PDFs …"`
- **`boq_items: []`** in the API payload — no synthetic line items are submitted.

The Phase-8 driver special-cases `claim_seq=15` to send an empty `boq_items` array. Per-item cumulative continuity is preserved because SMART itself excludes claim 15 from per-item cumulative tracking. Do **not** attempt to backfill line items during the migration; if line-level reconstruction is later required, it should be a separate, approved data-correction project.

---

## 9. Clear warning — production migration is NOT approved

- **Approved target:** STAGING ONLY.
- **Forbidden target:** the production Supabase project `ngwxlockzkjpmzuvgakx` (the URL named in `CLAUDE.md §15`). Even with `--i-acknowledge-this-is-staging`, the operator must not point Phase 8 at this URL. The acknowledgement flag is a safety override for misdetected staging URLs, **not** a license to write to production.
- **Forbidden actions during this window:** raw SQL on production, direct writes to `claims` / `claim_boq_items` / `change_orders`, calling the legacy `_ETL/migrate.py`, pushing branches, and any operation that would touch production storage buckets.
- **If anything is unclear:** stop and re-read `data-imports/CMH_01/08_migration/STAGING_SETUP_REQUIRED.md`. When in doubt, fail closed.

---

### Quick reference

| Question | Answer |
|---|---|
| Is Phase 8 ready to run? | Engineering-side yes; operator-side blocked on staging env. |
| What's the single command that says "yes you're safe"? | `node scripts/check-cmh01-env.js` exiting 0. |
| What's the production URL I must avoid? | `https://ngwxlockzkjpmzuvgakx.supabase.co`. |
| Where do I paste the staging values? | `.env.local` at the repo root, using the template under `data-imports/CMH_01/08_migration/staging_env_template.txt`. |
| Where does the migration log land? | `data-imports/CMH_01/08_migration/migration_log.md` (created by the script on first run). |
| What if a claim transition fails? | Stop, consult `data-imports/CMH_01/05_import_plan/rollback_strategy.md`, do not retry forward. |
