#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
# CONVERA — Secret-pattern scanner
# ═══════════════════════════════════════════════════════════════════════
#
# Greps for known credential patterns and refuses to let them be committed.
# Pure Bash + grep — no external dependencies, safe to run on any platform
# that has a POSIX shell + GNU grep (Git for Windows includes both).
#
# USAGE
#   bash scripts/secret-scan.sh             # scan files staged for commit (default)
#   bash scripts/secret-scan.sh --all       # scan every tracked file in the repo
#   bash scripts/secret-scan.sh --working   # scan tracked + untracked working-tree
#   bash scripts/secret-scan.sh --staged    # explicit alias for default
#   bash scripts/secret-scan.sh --files a b # scan a specific list of files
#
# EXIT CODES
#   0  — no real-looking secrets found
#   1  — at least one match; details printed to stderr (sanitized)
#   2  — bad usage / cannot run
#
# ALLOWLIST
#   - Add `# secret-scan-allow` at the end of a line that is intentionally
#     test data or a placeholder.
#   - Add a file path (one per line, glob ok) to `.secret-scan-allowlist`
#     in the repo root to skip whole files.
#   - The script's own pattern definitions are auto-allowed.
#
# PATTERNS DETECTED
#   <server-side secret key prefix>     — Supabase service-role key (HIGH)
#   <publishable key prefix>            — Supabase anon/publishable key (LOW:
#                                          usually public, but should not appear
#                                          in *.example with a real value)
#   <legacy JWT prefix>                 — JSON Web Token (legacy Supabase + general JWT)
#   <postgres URL with password>        — Postgres connection string with password
#   <old bootstrap password redacted>   — known bootstrap password literal for
#                                          this repo (rotated 2026-05-10; if it
#                                          reappears, the rotation is undone)
#
# SAFETY
#   - The script does NOT print the matched value verbatim. It prints
#     a sanitized form (prefix + "<R>") so the value never echoes in
#     CI logs or terminal scrollback.
#
# SUGGESTED INSTALLATION
#   - Wire up as a Git native pre-commit hook:
#       cp scripts/secret-scan.sh .git/hooks/pre-commit
#       chmod +x .git/hooks/pre-commit
#     (or symlink). See docs/setup-precommit.md for alternatives.
#   - As an npm script: `npm run secret-scan` (added in package.json).
# ═══════════════════════════════════════════════════════════════════════

set -u  # error on unset variables (NOT -e — we need to continue past grep no-match)

MODE="staged"
EXPLICIT_FILES=()

while [ "$#" -gt 0 ]; do
  case "$1" in
    --staged)  MODE="staged"; shift ;;
    --all)     MODE="all"; shift ;;
    --working) MODE="working"; shift ;;
    --files)   MODE="files"; shift; EXPLICIT_FILES=("$@"); break ;;
    -h|--help)
      sed -n '/^# USAGE/,/^# EXIT CODES/p' "$0" | sed 's/^#\s\?//'
      exit 0
      ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "secret-scan: not inside a git repo" >&2
  exit 2
}
cd "$REPO_ROOT" || exit 2

# ─── Build the file list to scan ───────────────────────────────────────
case "$MODE" in
  staged)
    mapfile -t FILES < <(git diff --cached --name-only --diff-filter=ACMR 2>/dev/null)
    ;;
  all)
    mapfile -t FILES < <(git ls-files)
    ;;
  working)
    mapfile -t FILES < <( (git ls-files; git ls-files --others --exclude-standard) | sort -u )
    ;;
  files)
    FILES=("${EXPLICIT_FILES[@]}")
    ;;
esac

# Filter out files that don't exist (deletes) or are scratch dirs.
FILTERED=()
for f in "${FILES[@]}"; do
  [ -z "$f" ] && continue
  [ -f "$f" ] || continue
  case "$f" in
    node_modules/*|.next/*|*/_runtime_b64/*|*/_chunks_*/*) continue ;;
  esac
  # File-level allowlist
  if [ -f .secret-scan-allowlist ]; then
    if grep -Fxq "$f" .secret-scan-allowlist 2>/dev/null; then continue; fi
  fi
  # Skip the script itself (its pattern definitions would self-trigger)
  case "$f" in scripts/secret-scan.sh) continue ;; esac
  FILTERED+=("$f")
done

if [ "${#FILTERED[@]}" -eq 0 ]; then
  echo "secret-scan: no files to scan (mode=$MODE)"
  exit 0
fi

# ─── Patterns ──────────────────────────────────────────────────────────
# Each pattern is an extended-regex string; the SEVERITY column is
# informational. The "PRINT_PREFIX" controls how to sanitize matches
# in output.

# Bash regex array of (pattern, label, prefix-to-show)
# NOTE: pattern strings are split with adjacent quoted literals (e.g. "sb""_secret_") so
#       this source file itself does NOT contain the contiguous prefix substring on any
#       single line — keeping findstr-style scans clean. Bash concatenates adjacent
#       quoted strings at parse time, so the runtime values are unchanged.
PATTERNS=(
  "sb""_secret_[A-Za-z0-9_-]{16,}|sb-service-role|sb""_secret_<R>"
  "sb""_publishable_[A-Za-z0-9_-]{16,}|sb-publishable|sb""_publishable_<R>"
  "eyJhbGciOi[A-Za-z0-9_-]{40,}|jwt-shape|eyJ…<R>"
  "postgres://[^[:space:]@]+:[^[:space:]@]+@[^[:space:]/]+|pg-conn-with-pwd|postgres://<R>@<R>"
  "055518""0602|bootstrap-pwd-literal|<bootstrap-pwd>"
)

ALLOW_TAG="# secret-scan-allow"
HITS=0

for entry in "${PATTERNS[@]}"; do
  IFS='|' read -r RX LABEL SAFE <<< "$entry"
  # Use grep -nE on the filtered file list. Suppress the match value.
  while IFS= read -r LINE; do
    [ -z "$LINE" ] && continue
    # LINE shape: path:lineno:matched-content
    # Skip if line carries the allow tag
    case "$LINE" in *"$ALLOW_TAG"*) continue ;; esac
    # Sanitize: replace the matched fragment with $SAFE before printing
    SANITIZED=$(echo "$LINE" | sed -E "s|$RX|$SAFE|g")
    if [ "$HITS" -eq 0 ]; then
      echo "secret-scan: real-looking credential patterns found:" >&2
      echo "─────────────────────────────────────────────────────" >&2
    fi
    echo "  [$LABEL] $SANITIZED" >&2
    HITS=$((HITS + 1))
  done < <(grep -nE "$RX" "${FILTERED[@]}" 2>/dev/null || true)
done

if [ "$HITS" -gt 0 ]; then
  echo "─────────────────────────────────────────────────────" >&2
  echo "secret-scan: $HITS hit(s) — refusing." >&2
  echo "" >&2
  echo "  • If the value is INTENTIONALLY a placeholder, append \`$ALLOW_TAG\`" >&2
  echo "    at the end of the line." >&2
  echo "  • If the value is REAL, rotate it (docs/secret_rotation_runbook.md)" >&2
  echo "    and replace with a placeholder before re-staging." >&2
  echo "  • To skip an entire file, add its path to .secret-scan-allowlist." >&2
  exit 1
fi

echo "secret-scan: clean (mode=$MODE, scanned ${#FILTERED[@]} files, ${#PATTERNS[@]} patterns)"
exit 0
