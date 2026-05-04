#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * create-test-auth-users.js
 *
 * Provisions the 8 Phase 2.6 smoke-test users via the Supabase Admin
 * API.  This is the ONLY supported path for creating test users —
 * direct SQL INSERT into auth.users is forbidden because GoTrue
 * refuses to authenticate users it didn't create itself ("Database
 * error querying schema" at sign-in).
 *
 * Usage:
 *   1. Make sure .env.local contains:
 *        NEXT_PUBLIC_SUPABASE_URL=...
 *        SUPABASE_SERVICE_ROLE_KEY=...
 *        TEST_USER_PASSWORD=...        (do NOT commit a real value)
 *   2. Run:  npm run seed:auth-users
 *   3. Then run the SQL seed in Supabase SQL Editor:
 *        SQL/seeds/005_seed_test_users_cmh.sql
 *
 * The script is idempotent:
 *   - If the user does NOT exist, it is created with email_confirm=true.
 *   - If the user EXISTS, only metadata is refreshed by default.
 *     Pass `--reset-passwords` (or env RESET_PASSWORDS=1) to also
 *     update the password to TEST_USER_PASSWORD.
 *
 * The script never prints the password.
 *
 * Exit codes:
 *   0  → all 8 users present + healthy
 *   1  → one or more users could not be created / verified
 *   2  → environment misconfigured (missing env vars)
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── 1. Load .env.local manually (no extra dependency) ──────────────
function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val   = line.slice(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadDotEnv(path.join(process.cwd(), '.env.local'));
loadDotEnv(path.join(process.cwd(), '.env'));

const SUPABASE_URL              = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const TEST_USER_PASSWORD        = process.env.TEST_USER_PASSWORD       || '';

const RESET_PASSWORDS =
  process.argv.includes('--reset-passwords') ||
  process.env.RESET_PASSWORDS === '1';

// ── 2. Validate environment ────────────────────────────────────────
function fatalEnvMisconfig(msg) {
  console.error('────────────────────────────────────────────────────');
  console.error('  create-test-auth-users — environment error');
  console.error('────────────────────────────────────────────────────');
  console.error('  ✗ ' + msg);
  console.error('');
  console.error('  Expected variables (in .env.local at the repo root):');
  console.error('    NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co');
  console.error('    SUPABASE_SERVICE_ROLE_KEY=<service role key>');
  console.error('    TEST_USER_PASSWORD=<your bootstrap password>');
  console.error('');
  process.exit(2);
}

if (!SUPABASE_URL)              fatalEnvMisconfig('NEXT_PUBLIC_SUPABASE_URL is not set.');
if (!SUPABASE_SERVICE_ROLE_KEY) fatalEnvMisconfig('SUPABASE_SERVICE_ROLE_KEY is not set.');
if (!TEST_USER_PASSWORD)        fatalEnvMisconfig('TEST_USER_PASSWORD is not set (a single bootstrap password used for all 8 test users).');

// ── 3. Resolve @supabase/supabase-js ───────────────────────────────
let createClient;
try {
  // Use the same dependency the app already pins in package.json.
  ({ createClient } = require('@supabase/supabase-js'));
} catch (e) {
  console.error('────────────────────────────────────────────────────');
  console.error('  Cannot load @supabase/supabase-js — run `npm install` first.');
  console.error('  Underlying error:', e.message);
  process.exit(2);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── 4. Test-user roster ────────────────────────────────────────────
//
// The 8 unique users across CMH_01 / CMH_02 / CMH_03. Same set as
// SQL/seeds/005_seed_test_users_cmh.sql Phase 2 pre-flight check.

const USERS = [
  { email: 'Ma.Alarfaj@momah.gov.sa',                full_name: 'Mohammed Alarfaj',                full_name_ar: 'محمد العرفج',                  role: 'director'   },
  { email: 'halhablayn-Contractor@momah.gov.sa',     full_name: 'Hossam Al-Hablayn',               full_name_ar: 'حسام الحبلين',                  role: 'reviewer'   },
  { email: 'aaldera-contractor@momah.gov.sa',        full_name: 'Abdullah Al-Dera',                full_name_ar: 'عبدالله الدرع',                 role: 'reviewer'   },
  { email: 'anaalghamdi-contractor@momah.gov.sa',    full_name: 'Anas Al-Ghamdi',                  full_name_ar: 'أنس الغامدي',                   role: 'reviewer'   },
  { email: 'mahmoud.ragab@beeah.sa',                 full_name: 'Mahmoud Massad',                  full_name_ar: 'محمود مساد',                    role: 'consultant' },
  { email: 'info@gdci.com.sa',                       full_name: 'Gulf Development Contracting',    full_name_ar: 'شركة الخليج المتطورة للمقاولات', role: 'contractor' },
  { email: 'fakher@alleanzaa.com',                   full_name: 'Alleanzaa Contracting',           full_name_ar: 'شركة إليانزا للمقاولات',         role: 'contractor' },
  { email: 'malek.h.mkh@gmail.com',                  full_name: 'Malik Al-Oqab',                   full_name_ar: 'مالك العقاب',                    role: 'contractor' },
];

// ── 5. Helpers ─────────────────────────────────────────────────────
async function findExistingUser(emailLc) {
  // The Admin API does not expose a direct getUserByEmail RPC, so we
  // page through listUsers. With 8 test users plus a small staff set
  // a single page is sufficient. Increase perPage if your tenant has
  // > 200 users.
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw error;
  return data.users.find((u) => (u.email || '').toLowerCase() === emailLc) || null;
}

function metadataFor(spec) {
  return {
    full_name:     spec.full_name,
    full_name_ar:  spec.full_name_ar,
    role:          spec.role,
    email_verified: true,
  };
}

// ── 6. Per-user create-or-update ───────────────────────────────────
async function provisionUser(spec) {
  const emailLc = spec.email.toLowerCase();
  const existing = await findExistingUser(emailLc);

  if (!existing) {
    const { data, error } = await admin.auth.admin.createUser({
      email:         spec.email,
      password:      TEST_USER_PASSWORD,
      email_confirm: true,
      user_metadata: metadataFor(spec),
    });
    if (error) throw new Error(`createUser failed for ${spec.email}: ${error.message}`);
    return { email: spec.email, id: data.user.id, action: 'created' };
  }

  // User already exists — refresh metadata, optionally password.
  const updates = { user_metadata: metadataFor(spec) };
  if (RESET_PASSWORDS) updates.password = TEST_USER_PASSWORD;
  if (!existing.email_confirmed_at) updates.email_confirm = true;

  const { data, error } = await admin.auth.admin.updateUserById(existing.id, updates);
  if (error) throw new Error(`updateUserById failed for ${spec.email}: ${error.message}`);
  return {
    email:    spec.email,
    id:       data.user.id,
    action:   RESET_PASSWORDS ? 'updated (metadata + password)' : 'updated (metadata only)',
  };
}

// ── 7. Run ─────────────────────────────────────────────────────────
(async () => {
  console.log('────────────────────────────────────────────────────');
  console.log('  create-test-auth-users — provisioning 8 users');
  console.log(`  Supabase URL : ${SUPABASE_URL}`);
  console.log(`  Reset passwords : ${RESET_PASSWORDS ? 'YES' : 'no (metadata only)'}`);
  console.log('────────────────────────────────────────────────────');

  let failures = 0;
  for (const spec of USERS) {
    try {
      const result = await provisionUser(spec);
      console.log(`  ✓ ${result.email.padEnd(40)} ${result.action.padEnd(34)} ${result.id}`);
    } catch (e) {
      failures += 1;
      console.error(`  ✗ ${spec.email.padEnd(40)} FAILED: ${e.message}`);
    }
  }

  console.log('────────────────────────────────────────────────────');
  if (failures === 0) {
    console.log(`  ✓ All ${USERS.length} users present and healthy.`);
    console.log('  Next step: run SQL/seeds/005_seed_test_users_cmh.sql');
    console.log('  in Supabase SQL Editor (Phase 2 will pre-flight-check');
    console.log('  these auth users, then provision profiles + roles).');
    process.exit(0);
  } else {
    console.error(`  ✗ ${failures} of ${USERS.length} user provision attempts failed.`);
    process.exit(1);
  }
})();
