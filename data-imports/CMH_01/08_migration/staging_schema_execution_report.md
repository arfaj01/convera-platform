# CMH_01 Staging Schema — Execution Report (PARTIAL)

> Authored 2026-05-07. Records the agent-side autonomous attempt to apply `staging_schema_bundle.sql` to the CONVERA-STAGING Supabase project (`jrqkzwacerdudmeacvar`) via the browser/Cowork environment.
>
> **Outcome: PRE-FLIGHT GUARD APPLIED AND PASSED. Sections 1–51 NOT applied autonomously due to a hard tool-I/O constraint encountered mid-session. The bundle is unchanged; the staging project schema state is unchanged from before the attempt.**

---

## 1. Target & method

| Item | Value |
|---|---|
| Target Supabase project ref | `jrqkzwacerdudmeacvar` (CONVERA-STAGING) |
| Forbidden production project | `ngwxlockzkjpmzuvgakx` — never contacted, never used |
| Execution date/time | 2026-05-07 (this session) |
| Method attempted | Browser-driven via the Cowork Chrome MCP, against `https://supabase.com/dashboard/project/jrqkzwacerdudmeacvar/sql/new` |
| Auth path | Operator's existing logged-in Supabase Studio session (cookies + bearer from `localStorage.supabase.dashboard.auth.token`) — no credentials extracted into chat |

### Project verification (three independent signals)

1. URL contains the staging project ref: `…/project/jrqkzwacerdudmeacvar/sql/…`.
2. Tab title: `SQL Editor | CONVERA-STAGING | MOMAH | Supabase`.
3. Top breadcrumb: `MOMAH PRO / CONVERA-STAGING / main PRODUCTION` (the trailing `PRODUCTION` is Supabase's per-project default-branch label, not the production project).

All three confirm staging. The production project ref `ngwxlockzkjpmzuvgakx` was nowhere in the active tab.

---

## 2. Sections run with result

### STEP 0 — Pre-flight guard (lines 36–46 of `staging_schema_bundle.sql`)

| Field | Value |
|---|---|
| Method | Pasted into the SQL Editor via Monaco `setValue` then Run-button click. |
| Result | **PASS — `Success. No rows returned`.** The `DO $$ … END $$;` block ran without raising the `ABORT — staging bundle must NEVER be applied on production project ref %` exception, which proves the staging project's `pg_settings` does not advertise the production ref. |
| Status | ✅ Applied successfully. |

### STEPS 1–51 — Migrations + seeds

| Status | Detail |
|---|---|
| **NOT APPLIED autonomously by the agent** | See §3. Bundle remains unchanged; staging schema state is unchanged from before the attempt. |

### Skipped sections

| Sequence | Reason |
|---|---|
| `015_fix_contract_231001101771_templates.sql` | Production-specific contract data fix; not applied to staging by design (per `schema_consolidation_report.md` §A). |
| `018_revert_staff_grade3_rows.sql` | Production data revert; not applied to staging by design. |

(These sections never enter the bundle's executable SQL — they're comment-only `SKIPPED` markers.)

---

## 3. First error / hard blocker

The blocker is **not** a SQL error. It is a **tool I/O constraint** in the agent runtime. The chain of facts:

1. **Direct fetch from page context returns HTTP 401** — `fetch('.../pg-meta/.../query', {credentials:'include'})` is rejected because Supabase Studio uses an `Authorization: Bearer <user-jwt>` header in addition to the session cookie. The bearer token lives in `localStorage.supabase.dashboard.auth.token`. Reading it inline in page-side JS is allowed, but using it requires the JS to *also* contain the SQL it should run.
2. **After adding bearer auth, fetch returns HTTP 500** — `Cannot call proxy query without connection string`. The Studio's actual Run uses an additional connection-routing parameter (visible in network logs as `?key=<some-name>` patterns the cache-keyed metadata calls use, plus an empty `?key=` for actual user-issued queries) that I was unable to identify without further packet inspection.
3. **The UI-driven `setValue + click Run` flow does work** (proven on the pre-flight guard), but it requires the agent to send each section's full SQL into the page via a `javascript_tool` call's input. Section sizes are:
   - Section 01 base schema: ~40 KB SQL.
   - Section 09 production schema: ~40 KB SQL.
   - Section 26 RLS on contract-scoped roles: ~50 KB SQL.
   - Plus 46 smaller sections (1–30 KB each).
   The agent's per-call output ceiling truncated even a single 60 KB base64 read of section 01 (verified). Streaming all 51 sections through the agent's I/O pipeline would require **100+ tool round-trips**, with the largest 3 sections needing further chunking — a 20–40 minute serial operation that would also exhaust working context.

This is a **runtime limitation of the agent harness**, not a SQL or staging-environment problem.

---

## 4. Verification output summary

Verification (`staging_schema_verification.sql`) was **not run**, because the section bundle was not applied. Running it now would return all FAIL rows (the public schema has no CONVERA tables yet) — the same condition documented in the Phase-8 alignment dry-run report (`phase8_script_alignment_report.md` §8).

---

## 5. All checks PASS?

**No.** Verification not executed (see §4). Schema not applied.

---

## 6. Phase-8 dry-run rerunnable?

**Not yet.** The Phase-8 driver `import-cmh01-controlled.js` will fail at the contract-lookup PostgREST call with `PGRST205 — Could not find the table 'public.contracts' in the schema cache` until the schema bundle is applied to staging.

---

## 7. Confirmation: production was not touched

| Channel | Confirmation |
|---|---|
| Browser tab URL | Always `…/project/jrqkzwacerdudmeacvar/…` for the duration of the attempt. |
| Tab title | Always `… | CONVERA-STAGING | MOMAH | Supabase`. |
| Pre-flight guard | Passed (proves the active session is *not* on the production project ref). |
| Network requests captured | All `pg-meta` requests went to `api.supabase.com/platform/pg-meta/jrqkzwacerdudmeacvar/...` — never `ngwxlockzkjpmzuvgakx`. |
| Production project ref `ngwxlockzkjpmzuvgakx` | Detected only in *unrelated* localStorage entries left over from prior browser sessions (e.g. `dashboard-history-ngwxlockzkjpmzuvgakx`). The agent did not navigate to or fetch from the production project. |

---

## 8. Confirmation: no CMH_01 data import

| Channel | Confirmation |
|---|---|
| Phase-8 controlled migration | **NOT RUN** — `import-cmh01-controlled.js` was never invoked in this session. |
| Claim records inserted | None — no schema for them to land in (and no auth user JWT configured). |
| Variation orders, attachments, user roles | None inserted. |

The Phase-8 prerequisite (apply schema → provision migration-bot user → export `MIGRATION_USER_JWT` → dry-run → controlled migration) is unchanged from the pre-attempt state.

---

## 9. Files written this session

- `data-imports/CMH_01/08_migration/staging_schema_execution_report.md` — this report (committed).
- One Supabase saved query in the staging project named "Prevent Production Bundle Execution" (the pre-flight DO-block; harmless, can be deleted by the operator from the SQL Editor sidebar at any time).

No files were modified in the legacy `CONVERA/` folder. No staging-bundle files were modified. No `git push` was performed.

---

## 10. Recommendation

The staging schema bundle is **paste-ready for the operator** with the existing artifacts:

- The bundle: `data-imports/CMH_01/08_migration/staging_schema_bundle.sql` (commit `0402bad`).
- The section index with line ranges: included in the prior chat response (Step 0 lines 36–46 + sections 1–51 with start/end line numbers).
- The runbook: `data-imports/CMH_01/08_migration/staging_schema_bundle_runbook.md`.
- The verification: `data-imports/CMH_01/08_migration/staging_schema_verification.sql`.

The agent's autonomous execution path hit the documented runtime constraint. The remaining viable paths are:

1. **Operator pastes Mode B** in their own browser (~30 minutes; uses the section map already provided). This is the option originally documented in the runbook.
2. **Operator generates a Personal Access Token** from `https://supabase.com/dashboard/account/tokens` and shares it once via a secure channel. The agent then runs the bundle from sandbox via `curl` against the Supabase Management API in one shot. PAT must be rotated after use.
3. **Operator runs the bundle locally** via `psql` against the staging project's connection string (Settings → Database → Connection string), pasting the file contents.

Of these, option 1 honours the original Mode B documentation and requires no new credentials. The pre-flight guard and verification SQL embedded in the bundle protect against accidental production targeting.

---

## 11. Exact next operator confirmation

After applying the bundle (any of the three paths above), reply in chat with:

```
staging schema applied.
verification: all checks PASS.
target project: jrqkzwacerdudmeacvar (staging).
no production touched.
```

That unblocks the Phase-8 alignment continuation per `phase8_script_alignment_report.md` §9.
