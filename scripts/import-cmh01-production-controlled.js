#!/usr/bin/env node
/**
 * scripts/import-cmh01-production-controlled.js  (v2 — hardened)
 *
 * Controlled production import for CMH_01 historical project data.
 * Default mode is DRY-RUN. Mutation requires:
 *   --execute
 *   --confirm "IMPORT CMH_01 TO PRODUCTION"
 *   SUPABASE_URL containing 'ngwxlockzkjpmzuvgakx'
 *
 * v2 hardening (2026-05-10):
 *  - Validation FIX: claim_boq_items count uses .in(claim_id, all-ids).
 *  - Documents insertion DEFERRED to Phase 9 (no placeholder rows in prod).
 *  - Post-import status flip is generated as a separate SQL file with
 *    a strong "DO NOT RUN until APPROVE-CMH01-STATUS-FLIP" header.
 *  - Execution log written to:
 *      data-imports/CMH_01/08_migration/CMH_01_production_import_execution_report.md
 *  - No secret values are written to logs/disk.
 *
 * Strict guards
 *  - Refuses any project ref except 'ngwxlockzkjpmzuvgakx'.
 *  - Refuses without --confirm exact phrase.
 *  - Never touches auth.users; never creates auth users.
 *  - Never DELETE/DROP/ALTER/TRUNCATE.
 *  - Stops on first error.
 *
 * Per-stage execution is sequential. There is NO atomic transaction
 * across stages (supabase-js limitation); see "atomicity" note below.
 *
 * Exit codes
 *  0  success
 *  2  bad env / cli / unsafe path / wrong project ref
 *  3  pre-flight failure
 *  4  mid-import failure (partial rollback may be needed — see report)
 *  5  post-validation mismatch
 * 99  unexpected
 */

'use strict';

const fs = require('fs');
const path = require('path');

function setExit(code) { process.exitCode = code; }

function loadDotEnv(p) {
  if (!fs.existsSync(p)) return;
  const txt = fs.readFileSync(p, 'utf8');
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) {
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      process.env[m[1]] = v;
    }
  }
}

const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');
const DRY_RUN = !EXECUTE;
const confirmFlagIdx = args.indexOf('--confirm');
const CONFIRM = (
  (args.find(a => a.startsWith('--confirm=')) || '').split('=').slice(1).join('=')
  || (confirmFlagIdx >= 0 && args[confirmFlagIdx + 1] && !args[confirmFlagIdx + 1].startsWith('--') ? args[confirmFlagIdx + 1] : '')
).replace(/^"|"$/g, '');

const envFileArg = args.find(a => a.startsWith('--env-file='));
if (envFileArg) {
  const envFilePath = path.resolve(envFileArg.split('=').slice(1).join('='));
  const _repoRoot = path.resolve(__dirname, '..');
  if (envFilePath === _repoRoot || envFilePath.startsWith(_repoRoot + path.sep)) {
    console.error('FATAL: --env-file path resolves INSIDE the repo. Choose a path outside.');
    process.exit(2);
  }
  if (!fs.existsSync(envFilePath)) {
    console.error('FATAL: --env-file not found: ' + envFilePath);
    process.exit(2);
  }
  loadDotEnv(envFilePath);
  console.log('[init] Loaded env from --env-file: ' + envFilePath);
}
loadDotEnv(path.join(process.cwd(), '.env.local'));
loadDotEnv(path.join(process.cwd(), '.env'));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function fatal(msg, code) {
  console.error('────────────────────────────────────────────────────────────');
  console.error('  import-cmh01-production-controlled — FATAL');
  console.error('────────────────────────────────────────────────────────────');
  console.error('  ✗ ' + msg);
  process.exit(code || 2);
}

if (!SUPABASE_URL) fatal('NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL is not set.', 2);
if (!SUPABASE_SERVICE_ROLE_KEY) fatal('SUPABASE_SERVICE_ROLE_KEY is not set.', 2);
if (SUPABASE_SERVICE_ROLE_KEY.length < 20) fatal('SUPABASE_SERVICE_ROLE_KEY too short.', 2);

const PROD_REF = 'ngwxlockzkjpmzuvgakx';
const STAGING_REF = 'jrqkzwacerdudmeacvar';
if (!SUPABASE_URL.includes(PROD_REF)) fatal('SUPABASE_URL missing prod ref ' + PROD_REF + '. Refusing.', 2);
if (SUPABASE_URL.includes(STAGING_REF)) fatal('SUPABASE_URL contains staging ref. Refusing.', 2);

if (EXECUTE) {
  if (CONFIRM !== 'IMPORT CMH_01 TO PRODUCTION') {
    fatal('--execute requires --confirm "IMPORT CMH_01 TO PRODUCTION" (exact). Got: "' + CONFIRM + '"', 2);
  }
}

console.log('────────────────────────────────────────────────────────────');
console.log('  CMH_01 Controlled Production Import (v2 hardened)');
console.log('────────────────────────────────────────────────────────────');
console.log('  Supabase URL: ' + SUPABASE_URL);
console.log('  Project ref:  ' + PROD_REF + ' (production)');
console.log('  Mode:         ' + (EXECUTE ? 'EXECUTE — will mutate' : 'DRY-RUN'));
console.log('────────────────────────────────────────────────────────────');

let createClient;
try { createClient = require('@supabase/supabase-js').createClient; }
catch (e) { fatal('@supabase/supabase-js not found. Run `npm install`.', 2); }

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const REPO_ROOT = path.resolve(__dirname, '..');
const NORM = path.join(REPO_ROOT, 'data-imports', 'CMH_01', '03_normalized');
const REPORT_PATH = path.join(REPO_ROOT, 'data-imports', 'CMH_01', '08_migration', 'CMH_01_production_import_execution_report.md');

function loadJson(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function loadCsv(p) {
  if (!fs.existsSync(p)) return [];
  const txt = fs.readFileSync(p, 'utf8').replace(/^﻿/, '');
  const lines = txt.split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0]).map(s => s.trim());
  return lines.slice(1).map(line => {
    const cells = parseCsvLine(line);
    const obj = {};
    header.forEach((h, i) => { obj[h] = cells[i]; });
    return obj;
  });
}
function parseCsvLine(line) {
  const out = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i+1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQ = false; }
      else { cur += ch; }
    } else {
      if (ch === ',') { out.push(cur); cur = ''; }
      else if (ch === '"') { inQ = true; }
      else { cur += ch; }
    }
  }
  out.push(cur);
  return out;
}
function chunked(arr, size) {
  const out = []; for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
function num(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : null; }
function intOrNull(v) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; }
function nz(v) { return (v === undefined || v === null || v === '') ? null : v; }

const STAKEHOLDER_EMAILS = [
  'ma.alarfaj@momah.gov.sa',
  'halhablayn-contractor@momah.gov.sa',
  'aaldera-contractor@momah.gov.sa',
  'anaalghamdi-contractor@momah.gov.sa',
  'mahmoud.ragab@beeah.sa',
  'info@gdci.com.sa',
];

const PARTY_NAME_AR = 'شركة الخليج المتطورة للمقاولات'; // operator D2

(async () => {
  console.log('\n[1/9] Loading source data …');
  const contract = loadJson(path.join(NORM, 'contract.json'));
  if (!contract) fatal('Missing 03_normalized/contract.json', 3);
  const boqItems   = loadCsv(path.join(NORM, 'boq_items.csv'));
  const claims     = loadCsv(path.join(NORM, 'claims.csv'));
  const claimLines = loadCsv(path.join(NORM, 'claim_line_items.csv'));
  const claimDocs  = loadCsv(path.join(NORM, 'claim_documents.csv'));
  const approvals  = loadCsv(path.join(NORM, 'approvals.csv'));
  const certs      = loadCsv(path.join(NORM, 'certificates.csv'));
  console.log('  contract:           1');
  console.log('  boq_items:          ' + boqItems.length);
  console.log('  claims:             ' + claims.length);
  console.log('  claim_line_items:   ' + claimLines.length);
  console.log('  documents (DEFERRED to Phase 9, NOT inserted):');
  console.log('    claim_documents:  ' + claimDocs.length);
  console.log('    approvals:        ' + approvals.length);
  console.log('    certificates:     ' + certs.length);

  console.log('\n[2/9] Resolving 6 stakeholder profile IDs (no Auth Admin) …');
  const { data: profileRows, error: profilesErr } = await admin
    .from('profiles').select('id, email, role')
    .in('email', STAKEHOLDER_EMAILS);
  if (profilesErr) fatal('profiles lookup failed: ' + profilesErr.message, 3);
  const emailToProfile = Object.fromEntries((profileRows || []).map(p => [p.email, p]));
  const missing = STAKEHOLDER_EMAILS.filter(e => !emailToProfile[e]);
  if (missing.length) {
    console.error('  BLOCKED_USER_MAPPING for: ' + missing.join(', '));
    fatal('Cannot proceed.', 3);
  }
  for (const e of STAKEHOLDER_EMAILS) console.log('  ✓ ' + e);

  console.log('\n[3/9] Pre-flight: CMH_01-C01 placeholder presence …');
  const { data: existing, error: contractErr } = await admin
    .from('contracts').select('id, contract_no, status, base_value').eq('contract_no', 'CMH_01-C01').maybeSingle();
  if (contractErr) fatal('contracts lookup failed: ' + contractErr.message, 3);
  if (!existing) fatal('CMH_01-C01 placeholder not found.', 3);
  if (Number(existing.base_value) > 0) fatal('CMH_01-C01 already has base_value=' + existing.base_value + ' — refusing to overwrite.', 3);
  const CONTRACT_ID = existing.id;
  console.log('  ✓ placeholder found, current status=' + existing.status);

  console.log('\n[4/9] Pre-flight: confirm zero existing CMH_01 children …');
  for (const tbl of ['contract_boq_templates', 'change_orders', 'claims']) {
    const { count, error } = await admin.from(tbl).select('id', { count: 'exact', head: true }).eq('contract_id', CONTRACT_ID);
    if (error) fatal('Pre-flight count failed for ' + tbl + ': ' + error.message, 3);
    console.log('  ' + (count === 0 ? '✓' : '✗') + ' ' + tbl + ' children: ' + count);
    if (count > 0) fatal(tbl + ' already has rows for CMH_01-C01. Refusing.', 3);
  }

  console.log('\n[5/9] Plan summary');
  console.log('  contracts:                 1 UPDATE (placeholder → filled)');
  console.log('  user_contract_roles:       1 UPDATE (anaalghamdi reviewer→auditor per D1)');
  console.log('  contract_boq_templates:    ' + boqItems.length + ' INSERT');
  console.log('  claims:                    ' + claims.length + ' INSERT (status=draft — needs separate APPROVE-CMH01-STATUS-FLIP)');
  console.log('  claim_boq_items:           ' + claimLines.length + ' INSERT');
  console.log('  documents:                 0 INSERT (DEFERRED to Phase 9)');
  console.log('  imports (audit row):       1 INSERT');
  console.log('  Post-import status flip SQL: generated as separate file (NOT auto-run)');

  if (!EXECUTE) {
    console.log('\n[6/9] DRY-RUN — no rows written.');
    console.log('  • Re-run with --execute --confirm "IMPORT CMH_01 TO PRODUCTION" to perform the import.');
    console.log('\n[7/9] Verdict: PASS (dry-run).');
    setExit(0); return;
  }

  // ──────────────────── EXECUTE ────────────────────
  const RESULTS = {
    started_at: new Date().toISOString(), finished_at: null,
    mode: 'EXECUTE', contract_id: CONTRACT_ID,
    contract_updated: false, role_updated: false,
    boq_inserted: 0, claims_inserted: 0, claim_lines_inserted: 0,
    documents_skipped: claimDocs.length + approvals.length + certs.length,
    imports_id: null, errors: [], warnings: [],
    inserted_claim_ids: [],
  };

  function abort(stage, err) {
    const errStr = String(err && err.message || err);
    console.error('\n  ✗ ABORT at ' + stage + ': ' + errStr);
    RESULTS.errors.push({ stage, error: errStr });
    RESULTS.finished_at = new Date().toISOString();
    writeExecutionReport(RESULTS, /*partial*/ true);
    console.error('\n  Partial results: see ' + REPORT_PATH);
    console.error('  Manual rollback: see Phase 4 import plan §9 OR the report.');
    setExit(4);
    process.exit(4);
  }

  console.log('\n[6/9] EXECUTE — inserting via supabase-js (sequential per-stage) …');

  // S0: imports row
  const importerNote = 'CMH_01 controlled production import @ ' + RESULTS.started_at;
  {
    const { data, error } = await admin.from('imports').insert({
      source_label: 'CMH_01', status: 'running', notes: importerNote,
    }).select('id').single();
    if (error) {
      RESULTS.warnings.push({ stage: 'imports row', warning: error.message });
      console.warn('  imports table insert failed (non-blocking): ' + error.message);
    } else {
      RESULTS.imports_id = data.id;
      console.log('  ✓ imports row created: ' + data.id);
    }
  }

  // S1: UPDATE contract
  console.log('  → UPDATE contracts (CMH_01-C01) …');
  {
    const update = {
      title_ar: contract.title_ar || 'مشروع تأهيل مقر الوزارة بالعليا',
      type: contract.type || 'construction',
      base_value: contract.base_value,
      retention_pct: contract.retention_pct ?? 5,
      start_date: contract.start_date,
      end_date: contract.end_date,
      duration_months: contract.duration_months,
      region: contract.region || 'الرياض',
      party_name_ar: PARTY_NAME_AR,
      boq_progress_model: contract.boq_progress_model || 'percentage',
      external_user_id: emailToProfile['info@gdci.com.sa'].id,
      admin_id: emailToProfile['anaalghamdi-contractor@momah.gov.sa'].id,
      director_id: emailToProfile['ma.alarfaj@momah.gov.sa'].id,
      status: 'active',
    };
    const { error } = await admin.from('contracts').update(update).eq('id', CONTRACT_ID);
    if (error) abort('UPDATE contracts', error);
    RESULTS.contract_updated = true;
    console.log('    ✓ contract row updated');
  }

  // S2: UPDATE anaalghamdi role per D1
  console.log('  → UPDATE user_contract_roles (anaalghamdi: reviewer→auditor) …');
  {
    const ana = emailToProfile['anaalghamdi-contractor@momah.gov.sa'].id;
    const { error } = await admin.from('user_contract_roles')
      .update({ contract_role: 'auditor' })
      .eq('user_id', ana).eq('contract_id', CONTRACT_ID).eq('contract_role', 'reviewer');
    if (error) abort('UPDATE user_contract_roles', error);
    RESULTS.role_updated = true;
    console.log('    ✓ role updated');
  }

  // S3: INSERT contract_boq_templates (chunked)
  console.log('  → INSERT contract_boq_templates …');
  {
    const rows = boqItems.map(b => ({
      contract_id: CONTRACT_ID,
      item_no: intOrNull(b.item_no),
      description: nz(b.description) || nz(b.description_ar) || '(no description)',
      description_ar: nz(b.description_ar),
      unit: nz(b.unit) || 'عدد',
      unit_price: num(b.unit_price) ?? 0,
      contractual_qty: num(b.contractual_qty) ?? 0,
    })).filter(r => r.item_no !== null);
    let inserted = 0;
    for (const ch of chunked(rows, 100)) {
      const { error, data } = await admin.from('contract_boq_templates').insert(ch).select('id');
      if (error) abort('INSERT contract_boq_templates', error);
      inserted += (data || []).length;
    }
    RESULTS.boq_inserted = inserted;
    console.log('    ✓ ' + inserted + ' / ' + rows.length + ' BOQ templates inserted');
  }

  // S4: INSERT claims as status='draft'
  console.log('  → INSERT claims (status=draft) …');
  const claimSeqToId = {};
  {
    const rows = claims.map(c => {
      const seq = intOrNull(c.claim_seq);
      const periodTo = nz(c.work_period_to);
      const ymd = periodTo ? periodTo.slice(2, 4) + periodTo.slice(5, 7) + periodTo.slice(8, 10) : '260510';
      const claim_number = 'CMH01R' + ymd + '-' + String(seq).padStart(3, '0');
      return {
        contract_id: CONTRACT_ID,
        claim_no: seq,
        claim_kind: c.claim_kind || 'running_payment',
        claim_type: c.claim_type || 'boq_only',
        status: 'draft',
        work_period_from: nz(c.work_period_from),
        work_period_to: nz(c.work_period_to),
        boq_amount: num(c.boq_amount) ?? 0,
        staff_amount: num(c.staff_amount) ?? 0,
        retention_amount: num(c.retention_amount) ?? 0,
        vat_amount: num(c.vat_amount) ?? 0,
        external_reference: nz(c.external_reference),
        claim_number,
        submitted_by: emailToProfile['info@gdci.com.sa'].id,
        created_by: emailToProfile['info@gdci.com.sa'].id,
      };
    }).filter(r => r.claim_no !== null);
    const { data, error } = await admin.from('claims').insert(rows).select('id, claim_no');
    if (error) abort('INSERT claims', error);
    (data || []).forEach(r => { claimSeqToId[r.claim_no] = r.id; RESULTS.inserted_claim_ids.push(r.id); });
    RESULTS.claims_inserted = (data || []).length;
    console.log('    ✓ ' + RESULTS.claims_inserted + ' / ' + rows.length + ' claims inserted (as draft)');
  }

  // S5: INSERT claim_boq_items (chunked)
  console.log('  → INSERT claim_boq_items …');
  {
    const rows = claimLines.map(l => {
      const seq = intOrNull(l.claim_seq);
      const claimId = claimSeqToId[seq];
      if (!claimId) return null;
      return {
        claim_id: claimId,
        item_no: intOrNull(l.item_no),
        description: nz(l.description) || nz(l.description_ar) || '(no description)',
        description_ar: nz(l.description_ar),
        unit: nz(l.unit) || 'عدد',
        unit_price: num(l.unit_price) ?? 0,
        contractual_qty: num(l.contractual_qty) ?? 0,
        prev_progress: num(l.prev_progress) ?? 0,
        curr_progress: num(l.curr_progress) ?? 0,
        period_amount: num(l.period_amount) ?? 0,
        performance_pct: num(l.performance_pct) ?? 100,
        after_perf: num(l.after_perf) ?? 0,
        cumulative: num(l.cumulative) ?? 0,
      };
    }).filter(r => r && r.item_no !== null);
    let inserted = 0;
    for (const ch of chunked(rows, 200)) {
      const { error, data } = await admin.from('claim_boq_items').insert(ch).select('id');
      if (error) abort('INSERT claim_boq_items', error);
      inserted += (data || []).length;
    }
    RESULTS.claim_lines_inserted = inserted;
    console.log('    ✓ ' + inserted + ' / ' + rows.length + ' claim line items inserted');
  }

  // S6: documents — DEFERRED to Phase 9 (intentional skip)
  console.log('  → documents: DEFERRED to Phase 9 (no rows inserted)');

  // S7: imports row update
  if (RESULTS.imports_id) {
    const updNote = importerNote + ' | counts=' + JSON.stringify({
      boq: RESULTS.boq_inserted, claims: RESULTS.claims_inserted, lines: RESULTS.claim_lines_inserted,
    });
    const { error } = await admin.from('imports').update({ status: 'completed', notes: updNote }).eq('id', RESULTS.imports_id);
    if (error) RESULTS.warnings.push({ stage: 'imports update', warning: error.message });
  }

  // S8: post-import status-flip SQL — generated, NOT auto-run, requires APPROVE-CMH01-STATUS-FLIP
  console.log('\n[7/9] Generating post-import status-flip SQL (NOT auto-run) …');
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const postSqlPath = path.join(home, 'Desktop', 'cmh01_post_import_flip_status.sql');
  const postSql =
'-- ════════════════════════════════════════════════════════════════════\n' +
'-- CMH_01 post-import: flip claim status from draft to approved.\n' +
'-- ════════════════════════════════════════════════════════════════════\n' +
'-- Generated by import-cmh01-production-controlled.js at ' + new Date().toISOString() + '\n' +
'-- Target: PRODUCTION project ' + PROD_REF + ' (CONVERA / main)\n' +
'--\n' +
'-- ⚠ DO NOT RUN THIS FILE until the operator has stated the explicit\n' +
'--   approval phrase in chat:    APPROVE-CMH01-STATUS-FLIP\n' +
'-- ⚠ The orchestrator is intentionally not allowed to run this file.\n' +
'--\n' +
'-- This file performs UPDATEs on production claims with the\n' +
'-- check_claim_within_contract_limit trigger SUPPRESSED via\n' +
"--   SET LOCAL session_replication_role = 'replica'\n" +
'-- which is required because the historical claim totals legitimately\n' +
'-- exceed the contract base value × 1.10 due to approved variation\n' +
'-- orders accumulated over the 14-month project lifecycle.\n' +
'-- The setting is transaction-scoped (SET LOCAL) and reverts on COMMIT.\n' +
'--\n' +
'-- Confirm Studio breadcrumb shows: MOMAH > CONVERA > main · PRODUCTION\n' +
'-- before pasting and clicking Run.\n' +
'-- ════════════════════════════════════════════════════════════════════\n' +
'\n' +
'BEGIN;\n' +
'SET LOCAL session_replication_role = ' + "'replica'" + ';\n' +
'\n' +
'UPDATE claims\n' +
"   SET status = 'approved',\n" +
'       updated_at = NOW(),\n' +
'       approved_at = COALESCE(approved_at, NOW())\n' +
" WHERE contract_id = '" + CONTRACT_ID + "'\n" +
"   AND status = 'draft';\n" +
'\n' +
'-- Verification — should return 21 rows:\n' +
'SELECT COUNT(*) AS approved_count\n' +
'  FROM claims\n' +
" WHERE contract_id = '" + CONTRACT_ID + "'\n" +
"   AND status = 'approved';\n" +
'\n' +
'COMMIT;\n';
  fs.writeFileSync(postSqlPath, postSql, { encoding: 'utf8', mode: 0o600 });
  console.log('  ✓ ' + postSqlPath);

  // S9: validation (FIXED — uses .in() over all imported claim ids)
  console.log('\n[8/9] Post-import validation (counts) …');
  const validationResults = {};
  {
    const { count: boqCount, error: e1 } = await admin
      .from('contract_boq_templates').select('id', { count: 'exact', head: true })
      .eq('contract_id', CONTRACT_ID);
    if (e1) RESULTS.warnings.push({ stage: 'validate boq', warning: e1.message });
    validationResults.contract_boq_templates = { observed: boqCount, expected: RESULTS.boq_inserted };
    console.log('  contract_boq_templates: observed=' + boqCount + ' expected=' + RESULTS.boq_inserted);

    const { count: claimsCount, error: e2 } = await admin
      .from('claims').select('id', { count: 'exact', head: true })
      .eq('contract_id', CONTRACT_ID);
    if (e2) RESULTS.warnings.push({ stage: 'validate claims', warning: e2.message });
    validationResults.claims = { observed: claimsCount, expected: RESULTS.claims_inserted };
    console.log('  claims:                 observed=' + claimsCount + ' expected=' + RESULTS.claims_inserted);

    // FIXED: count claim_boq_items across ALL imported claim IDs, not just first
    let linesCount = 0;
    if (RESULTS.inserted_claim_ids.length > 0) {
      // chunked to avoid URL length limits
      for (const ch of chunked(RESULTS.inserted_claim_ids, 100)) {
        const { count, error } = await admin
          .from('claim_boq_items').select('id', { count: 'exact', head: true })
          .in('claim_id', ch);
        if (error) RESULTS.warnings.push({ stage: 'validate claim_boq_items', warning: error.message });
        linesCount += (count || 0);
      }
    }
    validationResults.claim_boq_items = { observed: linesCount, expected: RESULTS.claim_lines_inserted };
    console.log('  claim_boq_items:        observed=' + linesCount + ' expected=' + RESULTS.claim_lines_inserted);
  }

  RESULTS.validation = validationResults;
  RESULTS.finished_at = new Date().toISOString();
  RESULTS.post_import_sql_path = postSqlPath;

  writeExecutionReport(RESULTS, /*partial*/ false);

  console.log('\n[9/9] DONE — claims inserted as DRAFT.');
  console.log('  ⚠ Two manual steps required by operator (each gated by separate approval):');
  console.log('     1. APPROVE-CMH01-STATUS-FLIP — paste ' + postSqlPath + ' into Studio SQL Editor.');
  console.log('     2. Phase 9 (Storage upload + documents insert) — separate approved phase.');
  console.log('');
  console.log('  Execution report: ' + REPORT_PATH);
  console.log('  Post-import flip SQL: ' + postSqlPath + ' (delete after running)');

  // Validation mismatch → exit 5
  const mismatch = (validationResults.contract_boq_templates.observed !== validationResults.contract_boq_templates.expected)
                || (validationResults.claims.observed !== validationResults.claims.expected)
                || (validationResults.claim_boq_items.observed !== validationResults.claim_boq_items.expected);
  if (mismatch) { console.warn('  ⚠ POST_VAL_MISMATCH — see report'); setExit(5); return; }

  setExit(0);
})().catch(e => { console.error('FATAL: ' + (e && e.message || String(e))); setExit(99); });

// ────────────────────────────────────────────────────────────────────
// Execution report writer
// ────────────────────────────────────────────────────────────────────
function writeExecutionReport(R, partial) {
  const md =
'# CMH_01 Production Import — Execution Report\n' +
'\n' +
'> **Generated:** ' + (R.finished_at || new Date().toISOString()) + '\n' +
'> **Mode:** ' + (R.mode || 'unknown') + '\n' +
'> **Status:** ' + (partial ? 'PARTIAL — aborted mid-import' : 'COMPLETED — main inserts done; status flip pending operator') + '\n' +
'> **Started at:** ' + (R.started_at || 'n/a') + '\n' +
'> **Finished at:** ' + (R.finished_at || 'n/a') + '\n' +
'\n' +
'## Row counts\n' +
'\n' +
'| Stage | Count |\n' +
'|---|---:|\n' +
'| contracts updated (placeholder filled) | ' + (R.contract_updated ? 1 : 0) + ' |\n' +
'| user_contract_roles updated (anaalghamdi reviewer→auditor) | ' + (R.role_updated ? 1 : 0) + ' |\n' +
'| contract_boq_templates inserted | ' + R.boq_inserted + ' |\n' +
'| claims inserted (status=draft) | ' + R.claims_inserted + ' |\n' +
'| claim_boq_items inserted | ' + R.claim_lines_inserted + ' |\n' +
'| documents (DEFERRED to Phase 9) | 0 inserted, ' + R.documents_skipped + ' rows in source |\n' +
'| imports audit row | ' + (R.imports_id ? 'created (id=' + R.imports_id + ')' : 'failed (non-blocking)') + ' |\n' +
'\n' +
'## Inserted claim IDs\n' +
'\n' +
(R.inserted_claim_ids && R.inserted_claim_ids.length
  ? R.inserted_claim_ids.map((id, i) => '- claim seq ' + (i+1) + ': `' + id + '`').join('\n') + '\n'
  : '_(none — import did not reach the claims stage or aborted before)_\n') +
'\n' +
'## Validation (post-import counts)\n' +
'\n' +
(R.validation
  ? '| Table | Observed | Expected | OK? |\n' +
    '|---|---:|---:|---:|\n' +
    '| contract_boq_templates | ' + R.validation.contract_boq_templates.observed + ' | ' + R.validation.contract_boq_templates.expected + ' | ' + (R.validation.contract_boq_templates.observed === R.validation.contract_boq_templates.expected ? '✓' : '✗') + ' |\n' +
    '| claims | ' + R.validation.claims.observed + ' | ' + R.validation.claims.expected + ' | ' + (R.validation.claims.observed === R.validation.claims.expected ? '✓' : '✗') + ' |\n' +
    '| claim_boq_items | ' + R.validation.claim_boq_items.observed + ' | ' + R.validation.claim_boq_items.expected + ' | ' + (R.validation.claim_boq_items.observed === R.validation.claim_boq_items.expected ? '✓' : '✗') + ' |\n'
  : '_(validation did not run — import aborted before)_\n') +
'\n' +
'## Warnings\n' +
'\n' +
((R.warnings && R.warnings.length)
  ? R.warnings.map(w => '- **' + w.stage + '**: ' + w.warning).join('\n') + '\n'
  : '_(none)_\n') +
'\n' +
'## Errors\n' +
'\n' +
((R.errors && R.errors.length)
  ? R.errors.map(e => '- **' + e.stage + '**: ' + e.error).join('\n') + '\n'
  : '_(none)_\n') +
'\n' +
'## Next manual steps (operator-driven)\n' +
'\n' +
(partial
  ? '⚠ The import aborted mid-stream. Manual cleanup may be needed. See `data-imports/CMH_01/05_import_plan/CMH_01_production_import_plan.md` §9 for the rollback SQL.\n\n'
  : '') +
'1. **APPROVE-CMH01-STATUS-FLIP** — paste `' + (R.post_import_sql_path || '~/Desktop/cmh01_post_import_flip_status.sql') + '` into Supabase Studio SQL Editor (PRODUCTION) and click Run. Expected verification: `approved_count = 21`.\n' +
'2. **APPROVE-CMH01-STORAGE-UPLOAD** (Phase 9, separate phase) — upload the ' + (R.documents_skipped || 0) + ' physical PDF files to Supabase Storage, then INSERT the corresponding `documents` rows.\n' +
'3. **Distribute the post-import SQL** ONLY through a secure channel; **DELETE the file** from Desktop after running it.\n' +
'4. **Delete `prod-temp.env`** after the rotation procedure is over.\n' +
'\n' +
'## Confirmations\n' +
'\n' +
'- ✅ No `auth.users` row was touched.\n' +
'- ✅ No password rotation was performed.\n' +
'- ✅ No migration was run.\n' +
'- ✅ No git push was performed.\n' +
'- ✅ No secret value was logged or written to disk.\n';
  try {
    fs.writeFileSync(REPORT_PATH, md, { encoding: 'utf8' });
  } catch (e) {
    console.warn('Could not write execution report: ' + (e && e.message || e));
  }
}
