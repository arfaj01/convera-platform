#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * verify-repo-path.js
 *
 * Lightweight guard that catches the most common operational mistakes:
 *
 *   1. Running an npm script from the wrong working directory
 *      (the legacy `Desktop\CONVERA` folder, or anywhere else that
 *      doesn't end in `convera-platform`).
 *   2. Missing standard folder structure (`SQL/migrations`,
 *      `SQL/seeds`, `logs`).
 *   3. The Phase 2.6 smoke-test seed missing from
 *      `SQL/seeds/005_seed_test_users_cmh.sql`.
 *   4. Forbidden patterns inside the seed: hard-coded references to
 *      the legacy CONVERA path, `contract_role='auditor'`, or the
 *      stale `CMH_xx-C01` suffix variants.
 *
 * Exit codes:
 *   0  → all checks passed (with optional warnings printed)
 *   1  → at least one fatal check failed
 *
 * Run via:   `npm run verify:repo-path`
 *
 * NOTE: this script intentionally does NOT touch the database. It is
 * safe to run anywhere, any time. It is not a replacement for tsc /
 * build / DB checks — it is a fast prerequisite for those.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const REQUIRED_BASENAME = 'convera-platform';
const FORBIDDEN_PATH_NEEDLES = [
  'Desktop\\CONVERA',
  'Desktop/CONVERA',
];
const REQUIRED_DIRS = ['SQL/migrations', 'SQL/seeds', 'logs'];
const REQUIRED_SEED = 'SQL/seeds/005_seed_test_users_cmh.sql';

// Normalise a forward-slash relative path into the host's path
// separator so equality comparisons against `path.relative()` output
// work on both Linux/macOS and Windows.
function nrm(p) { return p.split('/').join(path.sep); }

const FORBIDDEN_SEED_PATTERNS = [
  // Legacy paths
  { pattern: /Desktop\\CONVERA/g,           label: 'legacy Windows path Desktop\\CONVERA' },
  { pattern: /Desktop\/CONVERA/g,           label: 'legacy Unix-style path Desktop/CONVERA' },
  // Forbidden role — only flag WRITE contexts, not read-only verification SELECTs.
  // Writes appear as either an explicit cast `'auditor'::contract_role`
  // or as the third value in a `(project_code, email, role)` VALUES tuple
  // matching the role_mapping shape used by Phase 5 of the seed.
  { pattern: /'auditor'\s*::\s*contract_role/g, label: "contract_role='auditor' write (cast)" },
  { pattern: /,\s*'auditor'\s*\)/g,             label: "contract_role='auditor' write (VALUES tuple)" },
  // Stale CMH suffix variants that don't exist in DB
  { pattern: /CMH_01-C01/g,                 label: 'stale CMH_01-C01 reference' },
  { pattern: /CMH_02-C01/g,                 label: 'stale CMH_02-C01 reference' },
  { pattern: /CMH_03-C01/g,                 label: 'stale CMH_03-C01 reference' },
];

const errors   = [];
const warnings = [];

// ── 1. Working directory must end with `convera-platform` ──────────
const cwd = process.cwd();
const cwdBase = path.basename(cwd);
if (cwdBase !== REQUIRED_BASENAME) {
  errors.push(
    `Wrong repository path. CWD ends in "${cwdBase}" but must be "${REQUIRED_BASENAME}".\n` +
    `   Expected:  C:\\Users\\Administrator\\Desktop\\${REQUIRED_BASENAME}\n` +
    `   Got CWD :  ${cwd}\n` +
    `   Use C:\\Users\\Administrator\\Desktop\\convera-platform only.`
  );
}

// ── 2. Required directories ────────────────────────────────────────
for (const rel of REQUIRED_DIRS) {
  const abs = path.join(cwd, rel);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    errors.push(`Missing required directory: ${rel}`);
  }
}

// ── 3. Required seed must exist ────────────────────────────────────
const seedAbs = path.join(cwd, nrm(REQUIRED_SEED));
let seedContent = null;
if (!fs.existsSync(seedAbs)) {
  errors.push(`Missing required seed file: ${REQUIRED_SEED}`);
} else if (!fs.statSync(seedAbs).isFile()) {
  errors.push(`Required seed path exists but is not a file: ${REQUIRED_SEED}`);
} else {
  try {
    seedContent = fs.readFileSync(seedAbs, 'utf8');
  } catch (e) {
    errors.push(`Cannot read seed file ${REQUIRED_SEED}: ${e.message}`);
  }
}

// ── 4. Forbidden patterns inside the seed ──────────────────────────
if (seedContent !== null) {
  for (const { pattern, label } of FORBIDDEN_SEED_PATTERNS) {
    const matches = seedContent.match(pattern);
    if (matches && matches.length > 0) {
      // Some forbidden patterns can legitimately appear inside SQL
      // comments that document the rule (e.g., "Excludes: auditor is
      // NOT used"). Detect if the only occurrences are within `--`
      // comment lines, and downgrade those to warnings.
      const lines = seedContent.split(/\r?\n/);
      const codeHits = lines.filter((line) => {
        if (!pattern.test(line)) {
          // Reset stateful regex when needed
          pattern.lastIndex = 0;
          return false;
        }
        pattern.lastIndex = 0;
        const trimmed = line.trim();
        return !trimmed.startsWith('--');
      }).length;

      if (codeHits > 0) {
        errors.push(
          `Forbidden pattern in ${REQUIRED_SEED} (in code): ${label} — found ${codeHits} occurrence(s) outside SQL comments.`
        );
      } else {
        warnings.push(
          `Forbidden pattern "${label}" appears only in SQL comments of ${REQUIRED_SEED} — acceptable as documentation.`
        );
      }
    }
  }
}

// ── 5. Convera-platform tree must not contain legacy-path references
//     in code/scripts (md/sql/json/ts/tsx/js/cjs/mjs). Heavy globbing
//     is intentionally avoided — this is a fast check, not exhaustive.
//     For a full sweep, use `grep -r "Desktop\\\\CONVERA" .`
function walkAndCheck(dir, depth = 0) {
  if (depth > 6) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.next' || e.name === '.git'
        || e.name === 'scripts' /* skip self */) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      walkAndCheck(p, depth + 1);
    } else if (e.isFile()) {
      if (!/\.(ts|tsx|js|jsx|cjs|mjs|json|sql|md)$/.test(e.name)) continue;
      let txt;
      try { txt = fs.readFileSync(p, 'utf8'); } catch { continue; }
      for (const needle of FORBIDDEN_PATH_NEEDLES) {
        if (txt.includes(needle)) {
          // Allow legacy-path references only inside the rules
          // document — that file IS the documented spec for the
          // forbidden path. The seed must NOT reference the legacy
          // path; if a future maintainer reintroduces it, we want to
          // catch it here.
          const rel = path.relative(cwd, p);
          if (rel === nrm('logs/REPOSITORY_PATH_AND_SEEDING_RULES.md')) continue;
          errors.push(`Legacy-path reference "${needle}" in ${rel}`);
          break;
        }
      }
    }
  }
}
walkAndCheck(cwd);

// ── Output ─────────────────────────────────────────────────────────
console.log('────────────────────────────────────────────────────');
console.log('  CONVERA repo-path / seed safety guard');
console.log('────────────────────────────────────────────────────');
console.log(`  CWD              : ${cwd}`);
console.log(`  Required base    : ${REQUIRED_BASENAME}`);
console.log(`  Errors           : ${errors.length}`);
console.log(`  Warnings         : ${warnings.length}`);

if (warnings.length) {
  console.log('\n── Warnings ────────────────────────────────────────');
  for (const w of warnings) console.log('  ⚠  ' + w);
}

if (errors.length) {
  console.log('\n── Errors ──────────────────────────────────────────');
  for (const e of errors) console.log('  ✗  ' + e);
  console.log('\n  ✗ verify:repo-path FAILED');
  process.exit(1);
}

console.log('\n  ✓ verify:repo-path passed');
process.exit(0);
