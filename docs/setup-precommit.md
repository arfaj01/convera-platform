# Setting up the pre-commit secret scan

> **One-time setup per checkout.** Each developer who clones this repo
> should run §1 once. The hook is local-only — Git does not check in
> hooks, so a fresh clone has no protection until §1 is done.

---

## §1 — Wire up the Git native pre-commit hook (recommended)

No dependencies, no `npm install` step.

### Linux / macOS / Git-Bash on Windows

```bash
cd /path/to/convera-platform
ln -sf ../../scripts/secret-scan.sh .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

### Windows PowerShell

```powershell
cd C:\Users\Administrator\Desktop\convera-platform
Copy-Item scripts\secret-scan.sh .git\hooks\pre-commit -Force
# Git Bash on Windows will execute the .sh; PowerShell does not need chmod.
```

That's it. From this point on, every `git commit` runs the scan against
the staged file set first; if any pattern matches, the commit aborts and
prints a sanitized list of hits.

### Verifying the hook is active

```bash
# stage a fake leak to confirm the hook fires
echo 'SUPABASE_SERVICE_ROLE_KEY=<server-side secret key>' > /tmp/_leak_test
git add -f /tmp/_leak_test  # adjust path to inside the repo
git commit -m "test"
# Expected: commit aborts with `secret-scan: 1 hit(s) — refusing.`
git reset HEAD /tmp/_leak_test
rm /tmp/_leak_test
```

---

## §2 — Run the scan manually (any time)

```bash
# default — staged files only
npm run secret-scan

# everything tracked
npm run secret-scan:all

# tracked + untracked working tree
npm run secret-scan:working
```

Or directly:

```bash
bash scripts/secret-scan.sh --all
```

---

## §3 — Allowlisting intentional values

The scan flags **any** match by default. If you have a value that is
genuinely a placeholder, choose one of these mechanisms:

### Per-line: append `# secret-scan-allow`

```python
TEST_USER_PASSWORD = '<server-side secret key>'  # secret-scan-allow
```

### Per-file: add the path to `.secret-scan-allowlist` in the repo root

```
docs/secret_rotation_runbook.md
docs/patches/DEPLOYMENT_md_scrub.patch
```

(The scan auto-skips `node_modules/`, `.next/`, and the
`_runtime_b64/` / `_chunks_*/` scratch directories — no allowlist
entry needed for those.)

---

## §4 — What the scan catches

| Pattern | Severity | Why |
|---|---|---|
| `<server-side secret key>[A-Za-z0-9_-]{16,}` | HIGH | Supabase service-role key — bypasses RLS |
| `<publishable key>[A-Za-z0-9_-]{16,}` | LOW (informational) | Public anon key, but should not appear in tracked files |
| `eyJhbGciOi…` (40+ chars after) | HIGH | Generic JWT shape — could be any signed token |
| `postgres://user:pwd@host` | HIGH | Connection string with embedded password |
| `<old bootstrap password redacted>` | INSTANCE-SPECIFIC | The known bootstrap password literal in this repo |

The first 4 are repo-agnostic. The 5th is hard-coded for THIS repo —
when the bootstrap password is rotated and parameterized per
`docs/patches/seed_sql_password_parameterization_plan.md`, drop that
line from `scripts/secret-scan.sh` (or replace it with the new known
literal if a different one is chosen).

---

## §5 — When the scan shouts but you think it's wrong

1. Read the sanitized output. The match is shown as e.g.
   `[sb-service-role] path/to/file.ts:42: SUPABASE_SERVICE_ROLE_KEY=<server-side secret key>`.
2. Look at the file. Is it a real secret?
   - **Yes** → rotate per `docs/secret_rotation_runbook.md`, then
     replace the value with a placeholder. Re-stage. Re-run scan.
   - **No, it's a placeholder/example** → append `# secret-scan-allow`
     to the line, OR add the file to `.secret-scan-allowlist`.
3. If the pattern is a false positive in general (e.g. catches a
   variable named `password` in TypeScript), tighten the regex in
   `scripts/secret-scan.sh`. Don't add an allowlist for a recurring
   false-positive class — fix the regex.

---

## §6 — CI integration (later)

For team-wide enforcement (so a fresh clone can't push without the
hook), add a CI step in your GitHub Actions / GitLab CI / Vercel-Build
that runs `npm run secret-scan:all`. Failing the CI run prevents the
PR from being merged.

Tracked as backlog item A4 in `docs/low_effort_improvement_backlog.md`.

---

## §7 — Troubleshooting

| Symptom | Fix |
|---|---|
| Hook doesn't fire on `git commit` | `ls -la .git/hooks/pre-commit` — must exist and be executable. Repeat §1. |
| `secret-scan: not inside a git repo` | Run from inside the convera-platform working tree, not from `~/`. |
| `bash: scripts/secret-scan.sh: Permission denied` | `chmod +x scripts/secret-scan.sh` |
| Hook fires on a value you swear is fake | Double-check the value matches the regex bank in §4. Use `# secret-scan-allow` or `.secret-scan-allowlist`. |
| Want to bypass for a one-off emergency commit | `git commit --no-verify` — but document why in the commit body. |
