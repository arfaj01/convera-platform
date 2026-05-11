#!/usr/bin/env node
/**
 * scripts/rotate-user-passwords.js
 *
 * Rotates the password of every user in auth.users to a UNIQUE random
 * temporary value via Supabase Auth Admin API. Outputs a CSV (OUTSIDE
 * this repo) with the new passwords for the operator to distribute via
 * a secure channel; the operator must DELETE the CSV after distribution.
 *
 * MODES (mutually exclusive — first match wins)
 *   --diagnose-auth   Probe what works/doesn't with the configured key.
 *                     Read-only. Distinguishes Auth-Admin failures from
 *                     PostgREST failures so we know if we need a fallback
 *                     (e.g. legacy JWT) before --execute.
 *   --execute         Actually rotate.
 *   (none)            DRY-RUN: list users only, mutate nothing.
 *
 * USAGE
 *   node scripts/rotate-user-passwords.js                                              # dry-run, .env.local
 *   node scripts/rotate-user-passwords.js --diagnose-auth --env-file=...               # diagnostic probe
 *   node scripts/rotate-user-passwords.js --env-file=...                               # dry-run vs prod
 *   node scripts/rotate-user-passwords.js --env-file=... --execute                     # rotate vs prod
 *   node scripts/rotate-user-passwords.js --env-file=... --execute --csv-out="C:\\path\\to.csv"
 *
 * STRICT GUARDS
 *   - Refuses to use any password equal to the leaked bootstrap value.
 *   - Generates a unique 24-char base64url password per user via crypto.randomBytes(18).
 *   - Never logs the password value.
 *   - Writes CSV ONLY OUTSIDE this repo.
 *   - --env-file path MUST be outside this repo.
 *
 * EXIT CODES
 *   0  success
 *   2  bad env / bad CLI args / unsafe path
 *   3  upstream Supabase Admin API error
 *   99 unexpected error
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Use process.exitCode + return so Node can drain pending I/O before exit.
// Avoids the Windows libuv assertion when we exit while a fetch is pending.
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

// --env-file FIRST (highest priority for this run)
const envFileArg = process.argv.slice(2).find(a => a.startsWith('--env-file='));
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

const args = process.argv.slice(2);
const DIAGNOSE = args.includes('--diagnose-auth');
const EXECUTE = !DIAGNOSE && args.includes('--execute');
const CSV_OUT = (args.find(a => a.startsWith('--csv-out=')) || '').split('=').slice(1).join('=');

function fatalSync(msg, code) {
  console.error('────────────────────────────────────────────────────────────');
  console.error('  rotate-user-passwords — FATAL');
  console.error('────────────────────────────────────────────────────────────');
  console.error('  ✗ ' + msg);
  process.exit(code || 2);
}

if (!SUPABASE_URL) fatalSync('NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL is not set.', 2);
if (!SUPABASE_SERVICE_ROLE_KEY) fatalSync('SUPABASE_SERVICE_ROLE_KEY is not set.', 2);
if (SUPABASE_SERVICE_ROLE_KEY.length < 20) fatalSync('SUPABASE_SERVICE_ROLE_KEY looks too short.', 2);
if (/PLACEHOLDER|YOUR_/.test(SUPABASE_SERVICE_ROLE_KEY)) fatalSync('SUPABASE_SERVICE_ROLE_KEY contains placeholder text.', 2);

const refMatch = SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i);
const projectRef = refMatch ? refMatch[1] : '<unknown>';
const keyKind = SUPABASE_SERVICE_ROLE_KEY.startsWith('<server-side secret key>') ? '<server-side secret key>*'
              : SUPABASE_SERVICE_ROLE_KEY.startsWith('<publishable key>') ? '<publishable key>*'
              : SUPABASE_SERVICE_ROLE_KEY.startsWith('eyJ') ? 'legacy JWT'
              : 'unknown';

console.log('────────────────────────────────────────────────────────────');
console.log('  Convera User Password Rotation');
console.log('────────────────────────────────────────────────────────────');
console.log('  Supabase URL: ' + SUPABASE_URL);
console.log('  Project ref:  ' + projectRef);
console.log('  Service-role key: present (length ' + SUPABASE_SERVICE_ROLE_KEY.length + ', kind=' + keyKind + ', prefix ' + SUPABASE_SERVICE_ROLE_KEY.slice(0, 12) + '…)');
console.log('  Mode:         ' + (DIAGNOSE ? 'DIAGNOSE-AUTH (read-only probes)' : EXECUTE ? 'EXECUTE — will rotate passwords' : 'DRY-RUN (default — no changes)'));
console.log('────────────────────────────────────────────────────────────');

function defaultCsvPath() {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return path.join(home, 'Desktop', 'convera-temp-passwords-' + ts + '.csv');
}
const csvPath = CSV_OUT || defaultCsvPath();
const repoRoot = path.resolve(__dirname, '..');
const resolvedCsvPath = path.resolve(csvPath);
if (resolvedCsvPath === repoRoot || resolvedCsvPath.startsWith(repoRoot + path.sep)) {
  fatalSync('CSV path resolves INSIDE the repo. Choose a path outside the repo.', 2);
}

const FORBIDDEN = new Set(['<old bootstrap password redacted>', '<rejected shared password redacted>']);
function genPassword() {
  for (let i = 0; i < 5; i++) {
    const p = crypto.randomBytes(18).toString('base64url');
    if (p.length < 20) continue;
    if (FORBIDDEN.has(p)) continue;
    return p;
  }
  fatalSync('Failed to generate non-forbidden password (statistically impossible).', 99);
}

let createClient;
try { createClient = require('@supabase/supabase-js').createClient; }
catch (e) { fatalSync('@supabase/supabase-js not found. Run `npm install` first.', 2); }
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── DIAGNOSE-AUTH: read-only probes ──────────────────────────────
async function runDiagnose() {
  console.log('\nRunning 4 read-only probes …');
  const results = [];

  // PROBE 1: PostgREST — SELECT count(*) from profiles
  // Tests whether the key authenticates against PostgREST AT ALL.
  console.log('\n[probe 1/4] PostgREST: SELECT count from public.profiles');
  try {
    const { data, error, status } = await admin.from('profiles').select('id', { count: 'exact', head: true });
    if (error) {
      console.log('  ✗ FAIL  status=' + status + '  message=' + error.message);
      results.push({ probe: 'postgrest_select', ok: false, status, error: error.message });
    } else {
      console.log('  ✓ PASS  (count returned)');
      results.push({ probe: 'postgrest_select', ok: true });
    }
  } catch (e) {
    console.log('  ✗ EXCEPTION ' + (e && e.message || String(e)));
    results.push({ probe: 'postgrest_select', ok: false, exception: e && e.message || String(e) });
  }

  // PROBE 2: PostgREST — SELECT count(*) from auth.users (often blocked even for service_role)
  console.log('\n[probe 2/4] PostgREST: SELECT count from auth.users (usually blocked)');
  try {
    const { error, status } = await admin.schema('auth').from('users').select('id', { count: 'exact', head: true });
    if (error) {
      console.log('  ✗ FAIL  status=' + status + '  message=' + error.message + '   (expected — auth schema usually requires Auth Admin endpoint)');
      results.push({ probe: 'postgrest_auth_users', ok: false, status, error: error.message });
    } else {
      console.log('  ✓ PASS');
      results.push({ probe: 'postgrest_auth_users', ok: true });
    }
  } catch (e) {
    console.log('  ✗ EXCEPTION ' + (e && e.message || String(e)));
    results.push({ probe: 'postgrest_auth_users', ok: false, exception: e && e.message || String(e) });
  }

  // PROBE 3: Auth Admin — listUsers (the failing call)
  console.log('\n[probe 3/4] Auth Admin: GET /auth/v1/admin/users (listUsers)');
  try {
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (error) {
      console.log('  ✗ FAIL  message=' + error.message);
      results.push({ probe: 'auth_admin_listUsers', ok: false, error: error.message });
    } else {
      console.log('  ✓ PASS  (returned ' + (data && data.users ? data.users.length : 0) + ' user(s))');
      results.push({ probe: 'auth_admin_listUsers', ok: true });
    }
  } catch (e) {
    console.log('  ✗ EXCEPTION ' + (e && e.message || String(e)));
    results.push({ probe: 'auth_admin_listUsers', ok: false, exception: e && e.message || String(e) });
  }

  // PROBE 4: raw fetch to Auth Admin so we can read the response status code precisely
  console.log('\n[probe 4/4] Raw fetch: GET ' + SUPABASE_URL + '/auth/v1/admin/users?per_page=1');
  try {
    const r = await fetch(SUPABASE_URL + '/auth/v1/admin/users?per_page=1', {
      headers: {
        'Authorization': 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY,
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
      },
    });
    const status = r.status;
    let bodyPreview = '';
    try { bodyPreview = (await r.text()).slice(0, 240); } catch (_) {}
    console.log('  status=' + status);
    if (bodyPreview) console.log('  body  =' + bodyPreview);
    results.push({ probe: 'raw_auth_admin', status, ok: status >= 200 && status < 300, bodyPreview });
  } catch (e) {
    console.log('  ✗ EXCEPTION ' + (e && e.message || String(e)));
    results.push({ probe: 'raw_auth_admin', ok: false, exception: e && e.message || String(e) });
  }

  // Verdict
  console.log('\n────────────────────────────────────────────────────────────');
  console.log('  VERDICT');
  console.log('────────────────────────────────────────────────────────────');
  const pgOk = results.find(r => r.probe === 'postgrest_select')?.ok;
  const authOk = results.find(r => r.probe === 'auth_admin_listUsers')?.ok;
  if (pgOk && authOk) {
    console.log('  ✓ Key works for PostgREST AND Auth Admin. Safe to --execute.');
  } else if (pgOk && !authOk) {
    console.log('  ⚠ Key works for PostgREST but FAILS for Auth Admin.');
    console.log('  → The new <server-side secret key>* key likely has SCOPE-LIMITED admin access');
    console.log('    on this project, or the project requires the LEGACY service_role');
    console.log('    JWT for Auth Admin operations.');
    console.log('  → FALLBACK PATH:');
    console.log('    1. In Supabase Studio → Settings → API Keys → "Legacy anon, service_role API keys"');
    console.log('    2. Click "Reveal" on the service_role row, copy the value.');
    console.log('    3. Edit your prod-temp.env file:');
    console.log('       SUPABASE_SERVICE_ROLE_KEY=<paste the legacy JWT>');
    console.log('    4. Re-run this diagnose:');
    console.log('       node scripts/rotate-user-passwords.js --diagnose-auth --env-file=...');
    console.log('    5. If probe 3 PASSES with the legacy JWT, proceed with rotation.');
    console.log('    6. After rotation, restore the <server-side secret key>* in prod-temp.env if you keep it,');
    console.log('       OR delete prod-temp.env entirely (recommended).');
  } else if (!pgOk && !authOk) {
    console.log('  ✗ Key fails BOTH PostgREST and Auth Admin.');
    console.log('  → The key value is probably wrong, expired, or for a different project.');
    console.log('    Verify the key in Vercel matches what you copy-pasted.');
  } else {
    console.log('  ? Unexpected combination. Review probe outputs above.');
  }
  console.log('────────────────────────────────────────────────────────────');
}

// ── Main ──────────────────────────────────────────────────────────
(async () => {
  if (DIAGNOSE) {
    await runDiagnose();
    setExit(0);
    return;
  }

  console.log('\n[1/4] Fetching all auth.users …');
  const { data, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (listErr) {
    console.error('────────────────────────────────────────────────────────────');
    console.error('  rotate-user-passwords — FATAL');
    console.error('────────────────────────────────────────────────────────────');
    console.error('  ✗ listUsers failed: ' + listErr.message);
    console.error('');
    console.error('  HINT: re-run with --diagnose-auth to probe what works:');
    console.error('    node scripts/rotate-user-passwords.js --diagnose-auth --env-file=...');
    setExit(3);
    return;
  }
  const users = (data && data.users) || [];
  console.log('  Found ' + users.length + ' users.');
  if (users.length === 0) {
    console.error('FATAL: No users returned. Aborting.');
    setExit(3);
    return;
  }

  console.log('\n[2/4] Users to rotate (email only):');
  users
    .map(u => u.email || '(no-email-' + u.id.slice(0, 8) + ')')
    .sort()
    .forEach((email, i) => console.log('  ' + String(i + 1).padStart(2) + '. ' + email));

  if (!EXECUTE) {
    console.log('\n[3/4] DRY-RUN — no rotations performed.');
    console.log('  • Would generate a unique 24-char base64url password per user.');
    console.log('  • Would call admin.auth.admin.updateUserById() per user.');
    console.log('  • Would write CSV to: ' + csvPath);
    console.log('  • Operator must DELETE the CSV after distribution.');
    console.log('\n[4/4] Re-run with --execute to perform the rotation.');
    setExit(0);
    return;
  }

  console.log('\n[3/4] Rotating ' + users.length + ' users …');
  const rows = [];
  let ok = 0, fail = 0;
  for (const u of users) {
    const email = u.email || '(no-email-' + u.id.slice(0, 8) + ')';
    const newPwd = genPassword();
    try {
      const { error: updateErr } = await admin.auth.admin.updateUserById(u.id, { password: newPwd });
      if (updateErr) {
        console.log('  FAILED ' + email + ': ' + updateErr.message);
        rows.push({ email, temp_password: '', status: 'failed', error: updateErr.message, ts: new Date().toISOString() });
        fail++;
        continue;
      }
      console.log('  rotated ' + email);
      rows.push({ email, temp_password: newPwd, status: 'rotated', error: '', ts: new Date().toISOString() });
      ok++;
    } catch (e) {
      console.log('  EXCEPTION ' + email + ': ' + (e && e.message || String(e)));
      rows.push({ email, temp_password: '', status: 'exception', error: (e && e.message) || String(e), ts: new Date().toISOString() });
      fail++;
    }
  }

  console.log('\n[4/4] Writing CSV …');
  const csvHeader = 'email,temp_password,status,error,timestamp\n';
  const csvBody = rows.map(r =>
    '"' + (r.email || '').replace(/"/g, '""') + '"' +
    ',"' + (r.temp_password || '').replace(/"/g, '""') + '"' +
    ',"' + r.status + '"' +
    ',"' + (r.error || '').replace(/"/g, '""') + '"' +
    ',"' + r.ts + '"'
  ).join('\n');
  fs.writeFileSync(csvPath, csvHeader + csvBody + '\n', { encoding: 'utf8', mode: 0o600 });
  console.log('  CSV: ' + csvPath);
  console.log('  Result: ' + ok + ' rotated, ' + fail + ' failed.');

  console.log('\n────────────────────────────────────────────────────────────');
  console.log('  NEXT STEPS — operator responsibility');
  console.log('────────────────────────────────────────────────────────────');
  console.log('  1. Distribute each user\'s temp password via a SECURE channel.');
  console.log('  2. After distribution, DELETE the CSV file:');
  console.log('       Remove-Item "' + csvPath + '" -Force');
  console.log('  3. Do NOT commit, push, copy, or screenshot the CSV.');
  console.log('────────────────────────────────────────────────────────────');
  setExit(fail > 0 ? 3 : 0);
})().catch(e => { console.error('FATAL: ' + (e && e.message || String(e))); setExit(99); });
