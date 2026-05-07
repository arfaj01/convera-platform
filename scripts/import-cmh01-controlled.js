#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * import-cmh01-controlled.js — Phase 8 controlled migration driver
 *
 * Aligned with the platform's API surface as of 2026-05-07.
 * See data-imports/CMH_01/08_migration/api_compatibility_matrix.md for the
 * full audit and data-imports/CMH_01/08_migration/phase8_script_alignment_report.md
 * for the design rationale.
 *
 * Auth model:
 *   - Reads (lookup contract / users / profiles) go through PostgREST directly,
 *     authenticated with the staging Supabase SERVICE_ROLE key. Read-only.
 *   - Writes (claim create / workflow transitions / cert upload / role
 *     assignment) MUST go through the official platform APIs, which call
 *     supabase.auth.getUser() and reject the service-role key as an actor.
 *     The operator must therefore provide MIGRATION_USER_JWT (a real user
 *     access_token from a sign-in) for the user that will perform Phase 8
 *     on the operator host. For CMH_01 that user must hold ALL six active
 *     contract roles (contractor, supervisor, reviewer, quality,
 *     project_manager, final_approver) on the staging contract OR be a
 *     global director who has been added as contractor on the contract.
 *     See OPERATOR_HANDOVER.md §10 for the migration-bot setup.
 *
 * Run modes:
 *   --dry-run                         No platform writes, no PostgREST
 *                                     writes. Only side-effect-free reads
 *                                     against the staging Supabase project
 *                                     (contract lookup, user lookup) are
 *                                     issued — every would-be write is
 *                                     logged with a [DRY-WRITE] tag.
 *   --confirm "PROCEED CMH_01"        Live mode. Required for non-dry-run.
 *   --i-acknowledge-this-is-staging   Override of the "URL contains \"prod\""
 *                                     guard. Does NOT permit running against
 *                                     the platform production project ref
 *                                     ngwxlockzkjpmzuvgakx (hard-coded).
 *   --resume-from-claim N             Skip claims with claim_seq < N.
 *
 * Hard guarantees:
 *   - Refuses to run against production project ref ngwxlockzkjpmzuvgakx.
 *   - Refuses non-dry-run without operator confirmation phrase.
 *   - Never invokes legacy _ETL/migrate.py.
 *   - Never executes raw SQL.
 *   - Never logs the SUPABASE_SERVICE_ROLE_KEY or MIGRATION_USER_JWT in plain
 *     text — every log line passes through mask() which redacts known
 *     secret patterns.
 *   - Stops on the first non-recoverable failure (attachments are still
 *     non-fatal; everything else is fatal).
 *   - Claim 15 special-cased as option-b-header-only with empty boq_items[].
 *
 * Authored 2026-05-07 (alignment commit).
 */
"use strict";

const fs   = require("fs");
const path = require("path");
const readline = require("readline");

// ── Setup ───────────────────────────────────────────────────────────────────
const REPO_ROOT     = path.resolve(__dirname, "..");
const NORM          = path.join(REPO_ROOT, "data-imports", "CMH_01", "03_normalized");
const MIGRATION_DIR = path.join(REPO_ROOT, "data-imports", "CMH_01", "08_migration");
fs.mkdirSync(MIGRATION_DIR, { recursive: true });

// Manual .env.local loader — only sets vars that aren\u2019t already in
// process.env, so a shell-exported value wins over the file. This is
// important when the sandbox\u2019s FUSE cache is showing a stale .env.local
// and the operator must override values via the shell.
function loadDotEnv(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith("\"") && v.endsWith("\"")) || (v.startsWith("\u0027") && v.endsWith("\u0027"))) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
loadDotEnv(path.join(REPO_ROOT, ".env.local"));
loadDotEnv(path.join(REPO_ROOT, ".env"));

const SUPABASE_URL         = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";
const PLATFORM_BASE_URL    = process.env.PLATFORM_BASE_URL || "http://localhost:3000";
const MIGRATION_USER_JWT   = process.env.MIGRATION_USER_JWT || "";

const FLAGS = {
  dryRun:     process.argv.includes("--dry-run"),
  confirm:    process.argv.find((a) => a.startsWith("--confirm")) || "",
  resumeFrom: parseInt(process.argv.find((a) => a.startsWith("--resume-from-claim"))?.split("=")[1] || "0", 10) || 0,
  ackStaging: process.argv.includes("--i-acknowledge-this-is-staging"),
};

// ── Safety gates ────────────────────────────────────────────────────────────────
function abort(msg, code = 2) {
  console.error("─".repeat(60));
  console.error("  ABORT —", msg);
  console.error("─".repeat(60));
  process.exit(code);
}

if (!SUPABASE_URL) abort("SUPABASE_URL is missing — populate .env.local before running.");
if (!SUPABASE_SERVICE_KEY) {
  abort("SUPABASE_SERVICE_ROLE_KEY is missing — required for read-only PostgREST lookups even in dry-run.");
}
if (!PLATFORM_BASE_URL) abort("PLATFORM_BASE_URL is missing — set to your local/staging app URL.");

// REFUSE production project ref outright.
const PROD_PROJECT_REF = "ngwxlockzkjpmzuvgakx";
const refMatch = SUPABASE_URL.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co\/?$/i);
if (refMatch && refMatch[1] === PROD_PROJECT_REF) {
  abort(`SUPABASE_URL points at the production project ref ${PROD_PROJECT_REF}. Phase 8 must NEVER run against production. Reconfigure .env.local to a staging project.`);
}

const lcUrl = SUPABASE_URL.toLowerCase();
if ((lcUrl.includes("prod") || lcUrl.includes("production")) && !FLAGS.ackStaging) {
  abort(
    `SUPABASE_URL appears to point to production: ${SUPABASE_URL}\n` +
    `If this URL is genuinely a misnamed staging project, re-run with --i-acknowledge-this-is-staging.`,
  );
}

if (!FLAGS.dryRun) {
  const confirmIdx = process.argv.indexOf("--confirm");
  if (confirmIdx === -1 || process.argv[confirmIdx + 1] !== "PROCEED CMH_01") {
    abort(
      `Non-dry-run requires the operator confirmation phrase:\n` +
      `   node scripts/import-cmh01-controlled.js --confirm \"PROCEED CMH_01\"\n` +
      `Or pass --dry-run to inspect the planned actions without writing.`,
    );
  }
  if (!MIGRATION_USER_JWT) {
    abort(
      `MIGRATION_USER_JWT is missing — required for non-dry-run.\n` +
      `Phase 8 writes go through platform APIs which authenticate via supabase.auth.getUser().\n` +
      `The service-role key is NOT a user JWT and will be rejected with 401.\n` +
      `Provision a migration-bot user on staging that holds all six contract roles\n` +
      `(or is a director with all six roles) and export their access_token as\n` +
      `MIGRATION_USER_JWT before re-running. See OPERATOR_HANDOVER.md §10.`,
    );
  }
}

// ── Centralised helpers ──────────────────────────────────────────────────────────────
//
// mask(s)
//   Redact secrets from any string before logging. Patterns: sb_secret_,
//   sb_publishable_, JWT-shaped tokens, raw service-role keys, raw
//   MIGRATION_USER_JWT. Used by every log emit.
function mask(s) {
  if (typeof s !== "string" || s.length === 0) return s;
  let out = s;
  // Redact known credentials (whole-value swap before any pattern):
  if (SUPABASE_SERVICE_KEY) out = out.split(SUPABASE_SERVICE_KEY).join("⟨service-role⟩");
  if (MIGRATION_USER_JWT)   out = out.split(MIGRATION_USER_JWT).join("⟨migration-jwt⟩");
  // Pattern-based fallback (covers tokens that appear before env vars are set):
  out = out.replace(/sb_secret_[A-Za-z0-9_-]+/g, "⟨sb_secret_…⟩");
  out = out.replace(/sb_publishable_[A-Za-z0-9_-]+/g, "⟨sb_publishable_…⟩");
  out = out.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "⟨jwt…⟩");
  return out;
}

// ── Migration log ────────────────────────────────────────────────────────────
const LOG_PATH     = path.join(MIGRATION_DIR, "migration_log.md");
const RESULTS_PATH = path.join(MIGRATION_DIR, "migration_results.json");
const results = { run_started_at: new Date().toISOString(), steps: [], failures: [] };

function logLine(line) {
  const safe = mask(line);
  fs.appendFileSync(LOG_PATH, safe + "\n");
  console.log(safe);
}
function logStep(step, status, detail = "") {
  const stamp = new Date().toISOString();
  const sym = { ok: "✅", skip: "⏭", fail: "❌", dry: "🟡" }[status] || "·";
  logLine(`${sym} ${stamp}  ${step}  ${mask(String(detail))}`);
  results.steps.push({ time: stamp, step, status, detail: mask(String(detail)) });
}

// Initialise log file on a fresh run.
if (!FLAGS.resumeFrom) {
  fs.writeFileSync(LOG_PATH,
    `# CMH_01 Phase-8 Migration Log\n\n` +
    `Started: ${results.run_started_at}\n` +
    `Mode: ${FLAGS.dryRun ? "DRY-RUN" : "CONTROLLED MIGRATION"}\n` +
    `Target Supabase: ${SUPABASE_URL}\n` +
    `Target Platform: ${PLATFORM_BASE_URL}\n` +
    `Auth: ${MIGRATION_USER_JWT ? "MIGRATION_USER_JWT present" : "(dry-run; no user JWT required)"}\n\n`);
}

// ── PostgREST helper (read-only) ────────────────────────────────────────────────────────
//
// Supabase exposes its database through a PostgREST endpoint at
// ${SUPABASE_URL}/rest/v1/<table>?<filter>&select=<cols>. With the
// service-role key in the apikey + Authorization headers, this bypasses
// RLS and is suitable for read-only lookups during migration.
//
// IMPORTANT: this helper is read-only. The script does NOT issue any
// PostgREST writes (no PATCH / DELETE / POST). All writes go through the
// platform API helpers below.
async function postgrestSelect(table, query) {
  const url = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${table}?${query}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "apikey":        SUPABASE_SERVICE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Accept":        "application/json",
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`PostgREST ${res.status} ${table} — ${mask(text.slice(0, 200))}`);
  }
  try { return JSON.parse(text); } catch {
    throw new Error(`PostgREST ${table} returned non-JSON: ${mask(text.slice(0, 200))}`);
  }
}
async function postgrestSelectOne(table, query) {
  const rows = await postgrestSelect(table, query);
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

// ── Platform API helpers (writes) ────────────────────────────────────────────────────────
//
// These call the platform\u2019s authenticated routes which run
// supabase.auth.getUser() against the Bearer token. The token MUST be a
// real user access_token — the service-role key will fail with 401.
async function platformPost(endpoint, body, opts = {}) {
  if (FLAGS.dryRun) {
    logStep(`[DRY-WRITE] POST ${endpoint}`, "dry", JSON.stringify(body).slice(0, 120) + "…");
    return { ok: true, dry: true };
  }
  if (!MIGRATION_USER_JWT) {
    throw new Error(`MIGRATION_USER_JWT not set — cannot POST ${endpoint} (live mode requires user JWT)`);
  }
  const url = PLATFORM_BASE_URL.replace(/\/$/, "") + endpoint;
  const res = await fetch(url, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${MIGRATION_USER_JWT}`,
      ...(opts.headers || {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = {};
  try { json = JSON.parse(text); } catch {}
  if (!res.ok) {
    const err  = json.error || json.message || text.slice(0, 300);
    const code = json.error_code || json.code;
    throw new Error(`HTTP ${res.status} POST ${endpoint} — ${code || ""} ${mask(String(err))}`);
  }
  return json;
}

async function platformPatch(endpoint, body) {
  if (FLAGS.dryRun) {
    logStep(`[DRY-WRITE] PATCH ${endpoint}`, "dry", JSON.stringify(body).slice(0, 120) + "…");
    return { ok: true, dry: true };
  }
  if (!MIGRATION_USER_JWT) {
    throw new Error(`MIGRATION_USER_JWT not set — cannot PATCH ${endpoint} (live mode requires user JWT)`);
  }
  const url = PLATFORM_BASE_URL.replace(/\/$/, "") + endpoint;
  const res = await fetch(url, {
    method:  "PATCH",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${MIGRATION_USER_JWT}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = {};
  try { json = JSON.parse(text); } catch {}
  if (!res.ok) {
    const err = json.error || json.message || text.slice(0, 300);
    throw new Error(`HTTP ${res.status} PATCH ${endpoint} — ${mask(String(err))}`);
  }
  return json;
}

// ── Load normalised data ─────────────────────────────────────────────────────────────
function loadJSON(name) { return JSON.parse(fs.readFileSync(path.join(NORM, name), "utf8")); }
function loadCSV(name) {
  const text = fs.readFileSync(path.join(NORM, name), "utf8");
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];
  const splitCsv = (line) => {
    const out = []; let cur = ""; let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === "\"" && line[i + 1] === "\"") { cur += "\""; i++; continue; }
      if (c === "\"") { inQuote = !inQuote; continue; }
      if (c === "," && !inQuote) { out.push(cur); cur = ""; continue; }
      cur += c;
    }
    out.push(cur);
    return out;
  };
  const headers = splitCsv(lines[0]);
  return lines.slice(1).map((l) => Object.fromEntries(splitCsv(l).map((v, i) => [headers[i], v])));
}

const contract  = loadJSON("contract.json");
const users     = loadCSV("users.csv");
const ucr       = loadCSV("user_contract_roles.csv");
const boq       = loadCSV("boq_items.csv");
const claims    = loadCSV("claims.csv").sort((a, b) => Number(a.claim_seq) - Number(b.claim_seq));
const claimLines= loadCSV("claim_line_items.csv");
const vos       = loadCSV("variation_orders.csv").sort((a, b) => Number(a.order_no) - Number(b.order_no));
const voItems   = loadCSV("variation_order_items.csv");
const docs      = loadCSV("claim_documents.csv");
const apps      = loadCSV("approvals.csv");
const certs     = loadCSV("certificates.csv");

// ── Operator pause ────────────────────────────────────────────────────────────────
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function pause(prompt) {
  if (FLAGS.dryRun) return Promise.resolve();
  return new Promise((resolve) => rl.question(prompt, () => resolve()));
}

// ── Main migration ──────────────────────────────────────────────────────────────
async function main() {
  logStep("start", "ok",
    `mode=${FLAGS.dryRun ? "dry-run" : "live"}, ` +
    `supabase=${SUPABASE_URL}, ` +
    `platform=${PLATFORM_BASE_URL}, ` +
    `auth=${MIGRATION_USER_JWT ? "user-jwt" : "(none)"}`);

  // ─── Step 1 — verify or create contract ─────────────────────────────────────────────
  logLine(`\n## Step 1 — Contract\n`);
  await pause("  ENTER to verify the contract via PostgREST (or Ctrl+C to abort)…\n  > ");
  let contractId = null;
  try {
    // Read-only PostgREST lookup (replaces broken GET /api/contracts).
    const q = `contract_no=eq.${encodeURIComponent(contract.contract_no)}&select=id,contract_no,title_ar,base_value`;
    const row = await postgrestSelectOne("contracts", q);
    if (row) {
      contractId = row.id;
      logStep("contract.lookup", "ok",
        `found contract_no=${row.contract_no} id=${contractId} base_value=${row.base_value}`);
    } else {
      // Do NOT auto-create the contract via the platform API — contract
      // creation needs director auth + a curated payload. Surface a clear
      // operator-actionable error instead.
      throw new Error(
        `contract_no=${contract.contract_no} not found in staging Supabase. ` +
        `Create it via the platform UI (logged in as a director) or via a separate ` +
        `seeded migration before re-running this script.`,
      );
    }
  } catch (e) {
    logStep("contract.error", "fail", e.message);
    results.failures.push({ step: "contract", error: e.message });
    return finishRun();
  }

  // ─── Step 2 — stakeholder roles ────────────────────────────────────────────────────
  logLine(`\n## Step 2 — Stakeholder roles (${ucr.length} entries)\n`);
  await pause(`  ENTER to sync user_contract_roles…\n  > `);
  for (const r of ucr) {
    try {
      // Lookup auth/profile by email via PostgREST (read-only). The
      // platform exposes /api/admin/users (GET) which returns ALL profiles
      // and requires director-cookie auth — not suited for a programmatic
      // single-email lookup. PostgREST is safer and faster.
      const profile = await postgrestSelectOne(
        "profiles",
        `email=eq.${encodeURIComponent(r.email)}&select=id,email`,
      );
      if (!profile) {
        throw new Error(`auth profile not found for ${r.email} — run scripts/create-test-auth-users.js on staging first`);
      }
      // PATCH /api/admin/users/[id] requires a director\u2019s user JWT.
      // In dry-run this is logged as [DRY-WRITE].
      await platformPatch(`/api/admin/users/${profile.id}`, {
        contract_roles: [{ contract_id: contractId, contract_role: r.contract_role }],
      });
      logStep("ucr.upsert", "ok", `${r.email} → ${r.contract_role}`);
    } catch (e) {
      logStep("ucr.error", "fail", `${r.email}: ${e.message}`);
      results.failures.push({ step: "ucr", email: r.email, error: e.message });
      return finishRun();
    }
  }

  // ─── Step 3 — BOQ template (intent-only, operator handles via UI) ──────────
  logLine(`\n## Step 3 — BOQ template (${boq.length} items)\n`);
  await pause(`  ENTER to log BOQ template intent…\n  > `);
  // The platform\u2019s POST /api/contracts handler accepts boq_items only at
  // contract-creation time; there is no GET/PATCH/POST endpoint for
  // post-creation bulk BOQ insertion. The operator handles BOQ template
  // population via the contract-detail UI — the script logs intent.
  logStep("boq.template.intent", "ok",
    `${boq.length} items prepared in normalized layer; operator uploads via contract-detail UI`);

  // ─── Step 4 — Variation Orders (intent-only) ─────────────────────────────────────
  logLine(`\n## Step 4 — Variation orders (${vos.length})\n`);
  await pause(`  ENTER to log VO intent…\n  > `);
  // The platform exposes /api/change-orders/approve (POST) for the
  // approval action only — there is no creation endpoint. VO creation
  // happens through the change-order admin UI. The script logs intent
  // with the per-VO net-impact figures so the operator can replay them.
  for (const vo of vos) {
    const items = voItems
      .filter((v) => v.order_no === vo.order_no)
      .map((v) => ({
        item_no:           Number(v.item_no),
        operation:         v.operation_ar,
        unit_price:        Number(v.unit_price) || 0,
        qty:               Number(v.qty) || 0,
        duration_days:     Number(v.duration_days) || 0,
        financial_impact:  Number(v.financial_impact) || 0,
        discipline:        v.discipline,
        notes:             v.notes,
      }));
    logStep("vo.intent", "ok",
      `order_no=${vo.order_no} (${items.length} items, net=${vo.net_impact})`);
  }

  // ─── Step 5 — Claims (one at a time) ────────────────────────────────────────
  logLine(`\n## Step 5 — Claims\n`);
  for (const c of claims) {
    const cseq = Number(c.claim_seq);
    if (cseq < FLAGS.resumeFrom) {
      logStep("claim.skip", "skip", `seq=${cseq} (resume-from=${FLAGS.resumeFrom})`);
      continue;
    }
    logLine(`\n### Claim ${cseq} (${c.claim_no_official})\n`);
    await pause(`  ENTER to import claim ${cseq} (or Ctrl+C to abort)…\n  > `);

    const lines = claimLines
      .filter((l) => Number(l.claim_seq) === cseq)
      .map((l) => ({
        item_no:          Number(l.item_no),
        unit_price:       Number(l.unit_price_snapshot) || 0,
        contractual_qty:  Number(l.contractual_qty_snapshot) || 0,
        curr_progress:    Number(l.curr_progress) || 0,
        performance_pct:  100,
      }));

    // claim_seq=15 is option-b-header-only — empty boq_items[] per
    // data-imports/CMH_01/04_validation/claim_15_investigation.md.
    if (cseq === 15) {
      logStep("claim.15.note", "ok",
        `option-b-header-only: empty boq_items[], data_source=pdf_summary`);
    }

    let claimId;
    try {
      const createBody = {
        contract_id:        contractId,
        claim_kind:         c.claim_kind,
        claim_type:         c.claim_type,
        work_period_from:   c.work_period_from,
        work_period_to:     c.work_period_to,
        external_reference: c.external_reference || null,
        boq_amount:         Number(c.boq_amount) || 0,
        staff_amount:       0,
        retention_amount:   Number(c.retention_amount) || 0,
        vat_amount:         Number(c.vat_amount) || 0,
        boq_items:          lines,
        staff_items:        [],
      };
      const createRes = await platformPost("/api/claims/create", createBody);
      claimId            = createRes?.data?.id;
      const claimNumber  = createRes?.data?.claim_number;
      logStep("claim.create", "ok",
        `seq=${cseq} → claim_id=${claimId}, claim_number=${claimNumber}`);
    } catch (e) {
      logStep("claim.create.error", "fail", `seq=${cseq}: ${e.message}`);
      results.failures.push({ step: "claim.create", claim_seq: cseq, error: e.message });
      return finishRun();
    }

    // Workflow transitions — server validates that the user (whose JWT
    // we send) holds the actor_role active on the contract. For the
    // migration-bot setup, MIGRATION_USER_JWT is the bot user that holds
    // ALL six contract roles, so the same JWT works at every stage.
    const TRANSITIONS = [
      { action: "submit",  actor_role: null              /* contractor (resolved via auth) */ },
      { action: "approve", actor_role: "supervisor" },
      { action: "approve", actor_role: "reviewer" },
      { action: "approve", actor_role: "quality" },
      { action: "approve", actor_role: "project_manager" },
      { action: "approve", actor_role: "final_approver" },
    ];
    const targetStatus  = c.status;
    const dataSourceTag = cseq === 15 ? " [data_source=pdf_summary]" : "";

    for (const t of TRANSITIONS) {
      try {
        const body = {
          claimId,
          action: t.action,
          notes:  `Historical migration: claim ${cseq} originally reached ${targetStatus} ` +
                  `(work period ${c.work_period_from} → ${c.work_period_to})${dataSourceTag}`,
        };
        if (t.actor_role) body.actor_role = t.actor_role;
        await platformPost("/api/claims/transition", body);
        logStep("claim.transition", "ok",
          `seq=${cseq} action=${t.action} actor_role=${t.actor_role || "<contractor>"}`);
      } catch (e) {
        if (/لا توجد|already|claim\.status/.test(e.message)) {
          logStep("claim.transition.skip", "skip",
            `seq=${cseq} ${t.action}: target already reached`);
        } else {
          logStep("claim.transition.error", "fail",
            `seq=${cseq} ${t.action}: ${e.message}`);
          results.failures.push({
            step: "claim.transition", claim_seq: cseq, action: t.action, error: e.message,
          });
          return finishRun();
        }
      }
      if (targetStatus === "approved" && t.action === "approve" && t.actor_role === "final_approver") break;
    }

    // ─── Step 6 — attachments (intent-only; no /api/documents POST exists) ──────
    const allAtt = [
      ...docs.filter((d)  => Number(d.claim_seq) === cseq).map((d) => ({ ...d, _kind: "invoice" })),
      ...apps.filter((d)  => Number(d.claim_seq) === cseq).map((d) => ({ ...d, _kind: "approval_certificate" })),
      ...certs.filter((d) => Number(d.claim_seq) === cseq).map((d) => ({ ...d, _kind: "completion_certificate" })),
    ];
    for (const a of allAtt) {
      // The platform has POST /api/claims/upload-certificate for completion
      // certificates only — supervisor-scoped multipart upload. There is no
      // generic POST /api/documents route. Invoices and approval certificates
      // are therefore logged as intent for follow-up via the platform UI.
      logStep("attachment.intent", "ok",
        `seq=${cseq} ${a._kind}: ${a.expected_filename} (folder=${a.folder_hint}) — upload via UI post-migration`);
    }
  }

  finishRun();
}

function finishRun() {
  results.run_finished_at = new Date().toISOString();
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2));
  logLine(`\n## Run summary\n`);
  logLine(`- Steps: ${results.steps.length}`);
  logLine(`- Failures: ${results.failures.length}`);
  logLine(`- Results: ${RESULTS_PATH}`);
  logLine(`- Log: ${LOG_PATH}`);
  rl.close();
  if (results.failures.filter((f) => f.fatal !== false).length > 0) {
    console.error("Non-zero exit due to failures.");
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("Unhandled error:", mask(String(e?.message || e)));
  results.failures.push({ step: "unhandled", error: mask(String(e?.message || e)) });
  finishRun();
});
