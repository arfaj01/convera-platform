/**
 * CONVERA — Project-code resolver for claim_number generation.
 *
 * Phase 2.6 / Commit 3 (2026-05-04): formal contract resolved with
 * the user — `claim_number` MUST embed a 5-character `<ProjectCode>`
 * derived from `contracts.contract_no` via this resolver. There is
 * NO fallback such as "first 8 alphanumeric characters of
 * contract_no" — the previous, more permissive draft was rejected
 * because it would produce nonsense codes for numeric MoMaH
 * contract numbers.
 *
 * Authoritative mapping (test-database state at 2026-05-04):
 *
 *   contract_no            project_code
 *   ─────────────────────  ────────────
 *   'CMH_01-C01'         → 'CMH01'
 *   '250101116428'       → 'CMH02'
 *   '241039011332'       → 'CMH03'
 *
 * Pattern fallback (only for future contracts that follow the
 * documented short-code shape):
 *
 *   contract_no matches /^CMH_(\d{2})-C\d+$/  →  'CMH' + the two
 *                                                 captured digits.
 *
 * Anything else MUST return `null`. The API caller must surface a
 * 422 with the Arabic error
 *   "تعذّر تحديد كود المشروع لهذا العقد — تواصل مع مدير الإدارة قبل
 *    المتابعة."
 * and abort claim creation. Never silently emit a malformed
 * claim_number.
 *
 * Adding a new test contract: extend EXPLICIT_PROJECT_CODE_MAP and
 * also append a row to the table in
 * `logs/REPOSITORY_PATH_AND_SEEDING_RULES.md` §4.
 */

const EXPLICIT_PROJECT_CODE_MAP: Readonly<Record<string, string>> = Object.freeze({
  'CMH_01-C01':   'CMH01',
  '250101116428': 'CMH02',
  '241039011332': 'CMH03',
});

const CMH_SHORT_CODE_RE = /^CMH_(\d{2})-C\d+$/;

/**
 * Resolve a contracts.contract_no to its 5-character project code.
 * Returns null when the input cannot be resolved with confidence —
 * the caller MUST treat null as a hard failure, not a fallback.
 */
export function resolveProjectCode(contractNo: string | null | undefined): string | null {
  if (!contractNo) return null;
  const trimmed = contractNo.trim();
  if (trimmed.length === 0) return null;

  const explicit = EXPLICIT_PROJECT_CODE_MAP[trimmed];
  if (explicit) return explicit;

  const m = trimmed.match(CMH_SHORT_CODE_RE);
  if (m) return `CMH${m[1]}`;

  return null;
}

/**
 * Map a ClaimKind enum value to its single-letter code used in
 * `claim_number`. Returns null for unknown values.
 */
export function claimKindCode(kind: string | null | undefined): 'R' | 'F' | 'A' | null {
  switch (kind) {
    case 'running_payment': return 'R';
    case 'final_payment':   return 'F';
    case 'advance_payment': return 'A';
    default:                return null;
  }
}
