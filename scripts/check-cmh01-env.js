#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * check-cmh01-env.js
 *
 * Read-only safety gate for the CMH_01 Phase-8 controlled migration.
 *
 * Verifies that `.env.local` (in the repo root) is populated with values
 * pointing at a staging Supabase project — never the known production
 * project. Prints only MASKED status; secrets are never echoed.
 *
 * Exit codes:
 *   0  → environment is staging-safe, Phase 8 may proceed.
 *   2  → environment is missing or unsafe; Phase 8 must NOT run.
 *
 * Usage:
 *   node scripts/check-cmh01-env.js
 *
 * Authored 2026-05-06 alongside the CMH_01 staging-readiness package.
 *
 * Hard guarantees of this script:
 *   • No DB connection is made.
 *   • No HTTP calls are made.
 *   • No values are echoed in cleartext — only `present`/`missing`/
 *     `placeholder`/`prod-looking` plus mask lengths.
 *   • Safe to run anywhere, any time.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── 1. Locate repo root + .env.local ────────────────────────────────
const REPO_ROOT = path.resolve(__dirname, '..');
const ENV_PATH  = path.join(REPO_ROOT, '.env.local');

// ── 2. Manual env-file loader (no extra dep) ────────────────────────
function loadDotEnv(p) {
  const out = {};
  if (!fs.existsSync(p)) return out;
  const raw = fs.readFileSync(p, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

// ── 3. Heuristics ───────────────────────────────────────────────────

// Patterns that indicate the value is still a placeholder (Arabic + English).
const PLACEHOLDER_PATTERNS = [
  /^$/,                            // empty
  /^\s*$/,                         // whitespace only
  /<.*>/,                          // <staging-...>, <replace-me>
  /\bplaceholder\b/i,
  /\byour_/i,
  /\breplace[- _]?me\b/i,
  /\bxxxx+/i,
  /\bsample\b/i,
  /\bexample\b/i,
  /ضع[_ ]?هنا/,                    // Arabic: "put here"
  /استبدل/,                        // Arabic: "replace"
  /^[؀-ۿ_]+$/,           // pure Arabic / underscore string (no JWT shape)
];

const PROD_PROJECT_REF      = 'ngwxlockzkjpmzuvgakx';
const SUPABASE_URL_REGEX    = /^https:\/\/([a-z0-9-]+)\.supabase\.co\/?$/i;
const JWT_THREE_SEGMENT_RX  = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

// New-format Supabase keys (introduced 2025): privileged and publishable have
// separate, self-identifying prefixes. The legacy formats were JWT-shaped for
// both. This checker accepts either generation but enforces that the right
// kind of key is in the right slot:
//   • SUPABASE_SERVICE_ROLE_KEY       must be  sb_secret_*       or legacy-JWT
//   • NEXT_PUBLIC_SUPABASE_ANON_KEY   must be  sb_publishable_*  or legacy-JWT
const SB_SECRET_PREFIX_RX      = /^sb_secret_[A-Za-z0-9_-]{16,}$/;
const SB_PUBLISHABLE_PREFIX_RX = /^sb_publishable_[A-Za-z0-9_-]{16,}$/;

/**
 * Classify a Supabase key. Returns one of:
 *   'sb_secret'        — new privileged backend key
 *   'sb_publishable'   — new publishable / anon key
 *   'legacy_jwt'       — three-segment JWT (either role under the old format)
 *   'unknown'          — does not match any recognised shape
 */
function classifyKey(v) {
  if (typeof v !== 'string' || v.length === 0) return 'unknown';
  if (SB_SECRET_PREFIX_RX.test(v))      return 'sb_secret';
  if (SB_PUBLISHABLE_PREFIX_RX.test(v)) return 'sb_publishable';
  if (JWT_THREE_SEGMENT_RX.test(v) && v.length >= 100) return 'legacy_jwt';
  return 'unknown';
}

function isPlaceholder(v) {
  if (typeof v !== 'string') return true;
  for (const re of PLACEHOLDER_PATTERNS) {
    if (re.test(v)) return true;
  }
  return false;
}

function maskTail(v) {
  if (typeof v !== 'string' || v.length === 0) return '(empty)';
  if (v.length <= 6) return `len=${v.length}`;
  return `len=${v.length}, …${v.slice(-4)}`;
}

// ── 4. Run checks ───────────────────────────────────────────────────

const env = loadDotEnv(ENV_PATH);
let fatal = 0;
const lines = [];

function ok(label, msg)    { lines.push(`  [OK]    ${label.padEnd(34)} ${msg}`); }
function bad(label, msg)   { lines.push(`  [FAIL]  ${label.padEnd(34)} ${msg}`); fatal++; }
function warn(label, msg)  { lines.push(`  [WARN]  ${label.padEnd(34)} ${msg}`); }

console.log('────────────────────────────────────────────────────────────');
console.log(' check-cmh01-env  —  CMH_01 Phase 8 environment safety gate');
console.log('────────────────────────────────────────────────────────────');
console.log(` env file:  ${ENV_PATH}`);
console.log(` exists:    ${fs.existsSync(ENV_PATH)}`);
console.log('');

// 4.1 .env.local must exist
if (!fs.existsSync(ENV_PATH)) {
  bad('.env.local', 'MISSING — create it from data-imports/CMH_01/08_migration/staging_env_template.txt');
}

// 4.2 SUPABASE URL — accept either NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL
const urlPub = env.NEXT_PUBLIC_SUPABASE_URL || '';
const urlSrv = env.SUPABASE_URL || '';
const url    = urlSrv || urlPub;

if (!url) {
  bad('SUPABASE_URL', 'MISSING — set NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL');
} else if (isPlaceholder(url)) {
  bad('SUPABASE_URL', `PLACEHOLDER — value still contains template text (${maskTail(url)})`);
} else {
  const m = url.match(SUPABASE_URL_REGEX);
  if (!m) {
    bad('SUPABASE_URL', `INVALID — must look like https://<ref>.supabase.co (${maskTail(url)})`);
  } else {
    const ref = m[1];
    if (ref === PROD_PROJECT_REF) {
      bad('SUPABASE_URL', `PROD-LOOKING — project ref "${ref}" is the production project. Phase 8 must target staging.`);
    } else if (/prod|production/i.test(url)) {
      bad('SUPABASE_URL', `PROD-LOOKING — URL contains "prod"/"production". Phase 8 must target staging.`);
    } else {
      ok('SUPABASE_URL', `OK — staging-shaped (ref=${ref})`);
    }
  }
  // Sanity: if both NEXT_PUBLIC_SUPABASE_URL and SUPABASE_URL are set, they should match.
  if (urlPub && urlSrv && urlPub !== urlSrv) {
    warn('SUPABASE_URL/NEXT_PUBLIC', 'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_URL disagree — they should be identical');
  }
}

// 4.3 SUPABASE_SERVICE_ROLE_KEY
//     Accept either the new sb_secret_* format or the legacy JWT format.
//     REJECT a publishable key in this slot — that would be a privilege error.
const srk = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || '';
if (!srk) {
  bad('SUPABASE_SERVICE_ROLE_KEY', 'MISSING — required for Phase 8 (paste from staging Supabase project)');
} else if (isPlaceholder(srk)) {
  bad('SUPABASE_SERVICE_ROLE_KEY', `PLACEHOLDER — value still contains template text (${maskTail(srk)})`);
} else {
  const cls = classifyKey(srk);
  if (cls === 'sb_publishable') {
    bad('SUPABASE_SERVICE_ROLE_KEY', `WRONG-KIND — got an sb_publishable_* key in the SERVICE_ROLE slot. Paste the sb_secret_* key from the staging project. (${maskTail(srk)})`);
  } else if (cls === 'unknown') {
    bad('SUPABASE_SERVICE_ROLE_KEY', `INVALID — must be sb_secret_* or a legacy JWT (3 dot-separated base64url segments, ≥100 chars). Got: ${maskTail(srk)}`);
  } else if (cls === 'sb_secret') {
    ok('SUPABASE_SERVICE_ROLE_KEY', `present (sb_secret_*, ${maskTail(srk)})`);
  } else {
    ok('SUPABASE_SERVICE_ROLE_KEY', `present (legacy JWT, ${maskTail(srk)})`);
  }
}

// 4.4 PLATFORM_BASE_URL
const baseUrl = env.PLATFORM_BASE_URL || '';
if (!baseUrl) {
  bad('PLATFORM_BASE_URL', 'MISSING — set to http://localhost:3000 or staging app URL');
} else if (isPlaceholder(baseUrl)) {
  bad('PLATFORM_BASE_URL', `PLACEHOLDER — value still contains template text (${maskTail(baseUrl)})`);
} else if (!/^https?:\/\/.+/i.test(baseUrl)) {
  bad('PLATFORM_BASE_URL', `INVALID — must start with http:// or https:// (${maskTail(baseUrl)})`);
} else {
  ok('PLATFORM_BASE_URL', `OK — ${baseUrl.replace(/(:\d+)?\/?$/, (m) => m)}`);
}

// 4.5 NEXT_PUBLIC_SUPABASE_ANON_KEY (warn-only — not strictly required by the import script)
//     Accept either the new sb_publishable_* format or the legacy JWT format.
//     A privileged sb_secret_* key in this slot is a SECURITY issue — fail hard.
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
if (!anon) {
  warn('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'missing — not required by the import script, but the dev server will not boot without it');
} else if (isPlaceholder(anon)) {
  warn('NEXT_PUBLIC_SUPABASE_ANON_KEY', `PLACEHOLDER (${maskTail(anon)}) — fix before starting the dev server`);
} else {
  const ac = classifyKey(anon);
  if (ac === 'sb_secret') {
    bad('NEXT_PUBLIC_SUPABASE_ANON_KEY', `SECURITY — got an sb_secret_* key in the public ANON slot. This must NEVER happen: NEXT_PUBLIC_* values ship to the browser. Replace with the sb_publishable_* anon key. (${maskTail(anon)})`);
  } else if (ac === 'unknown') {
    warn('NEXT_PUBLIC_SUPABASE_ANON_KEY', `unrecognised shape (${maskTail(anon)}) — expected sb_publishable_* or a legacy JWT`);
  } else if (ac === 'sb_publishable') {
    ok('NEXT_PUBLIC_SUPABASE_ANON_KEY', `present (sb_publishable_*, ${maskTail(anon)})`);
  } else {
    ok('NEXT_PUBLIC_SUPABASE_ANON_KEY', `present (legacy JWT, ${maskTail(anon)})`);
  }
}

// 4.6 TEST_USER_PASSWORD (warn-only — only used by seed:auth-users)
const tup = env.TEST_USER_PASSWORD || '';
if (!tup) {
  warn('TEST_USER_PASSWORD', 'missing — only needed for npm run seed:auth-users');
} else if (isPlaceholder(tup)) {
  warn('TEST_USER_PASSWORD', 'PLACEHOLDER — only an issue if you intend to seed auth users');
} else {
  ok('TEST_USER_PASSWORD', `present (${maskTail(tup)})`);
}

// ── 5. Print summary ────────────────────────────────────────────────
console.log(lines.join('\n'));
console.log('');
if (fatal > 0) {
  console.log(`────────────────────────────────────────────────────────────`);
  console.log(` RESULT: NOT SAFE FOR PHASE 8 — ${fatal} fatal issue(s).`);
  console.log(` Action: populate .env.local from data-imports/CMH_01/08_migration/staging_env_template.txt`);
  console.log(`         then re-run: node scripts/check-cmh01-env.js`);
  console.log(`────────────────────────────────────────────────────────────`);
  process.exit(2);
}
console.log(`────────────────────────────────────────────────────────────`);
console.log(` RESULT: STAGING-SAFE — Phase 8 is permitted to run.`);
console.log(`────────────────────────────────────────────────────────────`);
process.exit(0);
