# `final_approver` Role Drift — Review & Fix Plan

> **Date:** 2026-05-10
> **Operator:** Claude (Cowork mode)
> **Sprint phase:** P3 of Production Stabilization Sprint
> **Status:** REVIEW ONLY. **No code modified by this sprint.** Awaits operator approval to execute either Path A or Path B.

---

## 1. TL;DR

Production's PostgreSQL enums have settled into a clean two-tier model:

- `user_role` (5 values): `director`, `admin`, `reviewer`, `consultant`, `contractor`. **Global** authority on `profiles.role`.
- `contract_role` (8 values): `contractor`, `supervisor`, `auditor`, `reviewer`, `viewer`, `project_manager`, `quality`, `final_approver`. **Per-contract** assignment via `user_contract_roles`.

The TypeScript codebase is **mid-migration** between an older "everything is a UserRole" model and the new two-tier model. Specifically, `lib/types.ts` declares **`UserRole`** as an **8-value union that includes `final_approver`, `auditor`, and `supervisor`** — values that **do not exist** in the production `user_role` enum. Any attempt to write `profiles.role = 'final_approver'` against production would raise:

```
ERROR:  invalid input value for enum user_role: "final_approver"
```

This is the schema/code drift surfaced by the prior assessment. The user-facing manifestation is that `UserFormModal` and `UsersTable` offer those values in role-selection UI, and any "save user" submission that selects them will fail at the database round-trip.

There are two viable resolutions. **Path A (recommended)** updates the codebase to match production reality (5-value strict UserRole, all role-aware permission checks defer to `user_contract_roles` for the workflow roles). **Path B** applies a fresh migration to production that adds the missing values to `user_role` (creating two parallel sources of truth — discouraged).

---

## 2. Where the drift lives — exhaustive map

### 2.1 The single declaration that drives everything

**`lib/types.ts:13`**
```typescript
export type UserRole = 'director' | 'admin' | 'reviewer' | 'consultant' | 'contractor'
                      | 'auditor' | 'supervisor' | 'final_approver';
```

This declaration is the root cause of the drift. The 5 production values (`director`, `admin`, `reviewer`, `consultant`, `contractor`) are correct. The trailing 3 values (`auditor`, `supervisor`, `final_approver`) are only valid in `contract_role`, not in `user_role`.

### 2.2 ContractRole declaration (correct, matches production)

**`lib/types.ts:65-73`**
```typescript
export type ContractRole =
  | 'contractor' | 'supervisor' | 'auditor' | 'reviewer' | 'viewer'
  | 'project_manager' | 'quality' | 'final_approver';
```

Matches production `contract_role` enum exactly. ✅ No change needed here.

### 2.3 Surfaces that treat `final_approver` as a UserRole (BUG)

| File | Lines | Symptom |
|---|---|---|
| `lib/constants.ts` | 244-247 (`USER_ROLE_LABELS`), 295-296 (`USER_ROLE_COLORS`), 274 (`USER_FORM_PERMISSION_GROUPS`), 410, 417, 424 (nav-menu role lists) | Treats `final_approver` as a global label/color/menu-target |
| `components/users/UsersTable.tsx` | 18-27 (`ROLE_BADGE` keyed by `UserRole`) | Renders a badge for `final_approver` users — but no such users can exist in `profiles.role` |
| `components/users/UserFormModal.tsx` | 30-72 (`ROLE_OPTIONS`, `ROLES_WITH_CONTRACT_LINKS`), 64 (the literal `'final_approver'` option) | Lists `final_approver` as a selectable global role; user can pick it; save will fail at DB |
| `app/api/admin/users/route.ts` | 17, 91 (allow-list `'viewer', 'project_manager', 'quality', 'final_approver'`) | Server-side role validator allows these as global roles (it actually accepts them — note the API's own translation layer; see §2.5) |
| `app/api/admin/users/[id]/route.ts` | 1 occurrence | Same pattern |
| `app/(app)/permissions/page.tsx` | 3 occurrences | Permissions UI lists final_approver as a UserRole option |

### 2.4 Surfaces that treat `final_approver` as a ContractRole (CORRECT)

These are using the post-Migration-045 model and should stay as-is:

| File | Lines | Use |
|---|---|---|
| `lib/types.ts` | 65-73 (ContractRole declaration) | Type-level source of truth |
| `lib/active-role.ts` | 2 occurrences | Resolves the user's ACTIVE role on the current contract |
| `lib/workflow-engine.ts` | 13 occurrences | Workflow-stage authority lookup; should be deriving from `user_contract_roles` |
| `lib/action-engine.ts` | 5 occurrences | Action-center derivation |
| `services/approvers.ts` | 2 occurrences | Reads `user_contract_roles` to get final approvers |
| `app/api/claims/transition/route.ts` | 6 occurrences | Workflow transitions; should check ContractRole, not UserRole |

### 2.5 The translation layer that hides the drift in production

**`app/api/admin/users/route.ts:48` `roleToDb()`**

This function maps the rich client-side UserRole (8 values) down to the 5 production `user_role` values before writing to `profiles.role`. So in practice, when `UserFormModal` lets you pick `final_approver`, the API silently translates it to (e.g.) `consultant` before insert. **That's why nothing is visibly broken in production today** — but it also means the user's chosen role and the stored role are different, with all the downstream confusion that implies. The `final_approver` semantics are then re-attached by an `INSERT INTO user_contract_roles` for the relevant contract.

This translation layer is the duct tape that makes the drift survive. Removing the 3 ContractRole-only values from `UserRole` makes the translation layer redundant for those values.

### 2.6 SQL artifacts

`SQL/migrations/041_final_approver_role.sql` (17 occurrences) was authored to add `final_approver` to the `user_role` enum. **Production never applied this migration in the form intended** — instead, Migration 045 (`contract_role_multi_assignment`) added the value to `contract_role` and called it done. The `user_role` enum still has 5 values. So `041` in the repo is **historically aspirational**; it does not match the world. It can either be:

- **Retired** (rename the file to `041_DEPRECATED_final_approver_role.sql.bak` and add a top-of-file note that the role lives in `contract_role` instead), OR
- **Re-purposed** as the source for Path B if you decide to add `final_approver` to `user_role` after all.

---

## 3. Path A — Update code to match production (RECOMMENDED)

### What changes

1. **`lib/types.ts`** — trim the `UserRole` union to the 5 production values:
   ```typescript
   export type UserRole = 'director' | 'admin' | 'reviewer' | 'consultant' | 'contractor';
   ```
   Keep `ContractRole` exactly as-is. Add a comment explaining why these names overlap (`reviewer` is in both, etc.).

2. **`lib/constants.ts`** — drop `final_approver`, `auditor`, `supervisor` keys from:
   - `USER_ROLE_LABELS`
   - `USER_ROLE_COLORS`
   - `USER_FORM_PERMISSION_GROUPS` (the global "الصلاحيات العامة" group)
   - The 3 nav-menu role lists at lines 410, 417, 424.

3. **`components/users/UsersTable.tsx`** — `ROLE_BADGE` becomes a `Record<UserRole, …>` of 5 entries. The badge for ContractRole-only users (e.g. final_approver) moves to a separate `ContractRoleBadge` shown on the user's contract-detail row, not on the global users list.

4. **`components/users/UserFormModal.tsx`** — `ROLE_OPTIONS` becomes 5 entries. The "Workflow roles" subsection (currently lines 64-67) moves into a separate "Per-contract roles" section that shows AFTER the user picks a global UserRole, and writes into `user_contract_roles` not `profiles.role`. (The form already half-does this via `ROLES_WITH_CONTRACT_LINKS` — extending the pattern is mechanical.)

5. **`app/api/admin/users/route.ts`** — drop `final_approver`, `viewer`, `project_manager`, `quality` from the global-role allow-list at line 91. They remain valid in the `contract_role` validator.

6. **`app/api/admin/users/[id]/route.ts`** — same.

7. **`app/(app)/permissions/page.tsx`** — UI for listing/editing global permissions hides the 3 ContractRole-only values; the per-contract permissions surface (separate page) shows them.

8. **`lib/workflow-engine.ts`, `lib/action-engine.ts`, `services/approvers.ts`, `app/api/claims/transition/route.ts`** — audit each occurrence to confirm it's reading from `user_contract_roles` (correct) not `profiles.role` (would be the bug). Most of these probably already read from the right place; this is a fast read-through, not a refactor.

9. **Delete `roleToDb()` translation layer** in `app/api/admin/users/route.ts:48` once the union is trimmed — it becomes a no-op.

10. **`SQL/migrations/041_final_approver_role.sql`** — rename to `041_DEPRECATED_final_approver_role.sql.bak` (or move to a `SQL/migrations/_deprecated/` folder) with a top-of-file note: "This migration was never applied to production. The `final_approver` role lives in `contract_role` instead — see Migration 045."

### Pros
- Single source of truth (production schema = TypeScript types).
- Removes the silent-translate-on-save behaviour.
- Aligns with the original two-tier-role design intent.
- TypeScript catches every leftover reference at compile time.

### Cons
- ~25 files touched.
- Requires UX clarity: "global role" vs. "per-contract role" needs to be explained somewhere visible (likely a one-line tooltip in `UserFormModal`).

### Effort estimate
**Medium**: ~½ day of focused work plus a careful manual smoke test of the user-creation flow against staging. Mostly mechanical edits driven by TypeScript errors after step 1.

### Risk
**Low**: production is already consistent with this view. Worst-case error mode is a TypeScript compile failure, caught locally before deploy.

### Suggested PR shape
- **PR 1**: trim `UserRole` to 5 values; fix all the resulting TS errors in mechanical edits; delete `roleToDb()`. Manual smoke: create a user with each global role on staging.
- **PR 2**: refactor `UserFormModal` to surface per-contract role assignment as a follow-up step instead of a global option. Manual smoke: assign a final_approver to a contract on staging; confirm `user_contract_roles` row appears.
- **PR 3**: rename Migration 041 to deprecated; update `lib/constants.ts` nav-menu role lists.

---

## 4. Path B — Apply Migration 041 to production

### What changes

1. **Apply `SQL/migrations/041_final_approver_role.sql` (or a stripped version of it) against production** so that `user_role` enum gains the 3 missing values. After the apply:
   ```sql
   SELECT enumlabel FROM pg_enum
    WHERE enumtypid = 'public.user_role'::regtype
    ORDER BY enumsortorder;
   -- Expected: director, admin, reviewer, consultant, contractor,
   --           auditor, supervisor, final_approver
   ```

2. **Keep all TypeScript code as-is.** The `UserRole` union and the `ContractRole` union now share 3 values, which the code already handles via the translation layer.

### Pros
- Smallest code change.
- "Global authority" can now be granted via `profiles.role` directly (e.g. the lone director can be set as a global `final_approver` without per-contract assignment).

### Cons
- **Two parallel sources of truth.** A user who is a `final_approver` globally (via `profiles.role`) and a `contractor` on a specific contract (via `user_contract_roles`) introduces a precedence question that the codebase doesn't currently answer cleanly.
- The translation layer in `app/api/admin/users/route.ts` becomes load-bearing in a way that's now harder to remove.
- Production schema becomes more permissive than the original two-tier intent.
- Requires production DDL: `ALTER TYPE user_role ADD VALUE` runs in its own transaction (PG 55P04 if combined with a data update, like Migration 009).

### Effort estimate
**Low** code-side, **Medium** governance-side (must document the precedence rule).

### Risk
**Medium**: changes the production schema in a non-trivial way; introduces ambiguity without resolving it.

---

## 5. Recommendation

**Take Path A.** Reasons:

- The two-tier role model (global UserRole + per-contract ContractRole) is the documented intent (see the lengthy comment at `lib/types.ts:38-72`).
- Production has already settled into Path A's end state. Changing the code to match is the smaller delta in semantic terms.
- The translation layer in the admin API is a code smell that gets removed as a side-effect.
- The cost of Path B (two parallel sources of truth) compounds over time; the cost of Path A is a one-shot mechanical refactor.

---

## 6. Safe immediate code change (if pre-approved)

The single one-line change that's both safe AND obvious is to ADD a runtime guard at the API boundary so that any future drift fails loudly instead of silently translating. Without trimming the union yet:

```typescript
// app/api/admin/users/route.ts — add at top of the role allow-list block (near line 91)
const PRODUCTION_USER_ROLE_ENUM = ['director', 'admin', 'reviewer', 'consultant', 'contractor'] as const;
function assertProductionUserRole(role: string): asserts role is typeof PRODUCTION_USER_ROLE_ENUM[number] {
  if (!PRODUCTION_USER_ROLE_ENUM.includes(role as any)) {
    throw new Error(
      `Invalid global UserRole: ${role}. Production user_role enum has only ` +
      PRODUCTION_USER_ROLE_ENUM.join(', ') + '. Per-contract roles like final_approver ' +
      'must be assigned via user_contract_roles, not profiles.role.'
    );
  }
}
```

This catches the bug at the server boundary with a useful Arabic-mappable error message before the database raises a less-actionable enum error.

**This sprint did NOT make this change.** It is documented here for the operator to apply if Path A is approved.

---

## 7. Verification plan (for either path)

After the chosen path is applied:

- **`npx tsc --noEmit`** — must pass with zero errors.
- **Manual smoke (staging)**: open `/إدارة المستخدمين`, create a new user with each available global role, confirm save succeeds.
- **Manual smoke (staging)**: open `/إدارة الصلاحيات`, assign each role on a test contract, confirm `user_contract_roles` row is created with the right `contract_role` value.
- **Production query** to detect any leftover drift:
  ```sql
  -- Run in production (read-only) AFTER apply.
  SELECT role, COUNT(*) FROM profiles WHERE role NOT IN
    ('director','admin','reviewer','consultant','contractor')
  GROUP BY role;
  -- Expected: 0 rows (the enum prevents storage of any other value).
  ```

---

## 8. Approval phrases

To proceed with **Path A** (recommended — code aligns to production):

> **APPROVE-DRIFT-PATH-A**

To proceed with **Path B** (production aligns to code via Migration 041):

> **APPROVE-DRIFT-PATH-B**

To **just apply the safe runtime guard from §6** without trimming the union yet:

> **APPROVE-DRIFT-RUNTIME-GUARD-ONLY**

---

*See also: `current_platform_state_assessment.md` §6 (drift listing), `low_effort_improvement_backlog.md` item C2, `migration_049_production_apply_note.md` (an unrelated migration but a good reference for the apply-note format).*
