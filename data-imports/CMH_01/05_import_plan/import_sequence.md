# CMH_01 — Import Sequence

> Order is dependency-aware. Each step uses platform APIs / RPCs;
> nothing bypasses the open-claim guard, atomic RPC, advisory lock,
> retention/VAT computation, or workflow engine.

| # | Step | Source | Target | Endpoint / RPC | Goes through governance |
|---:|---|---|---|---|---|
| 1 | Verify contract shell exists | normalized contract.json | `contracts` table | (read-only) `GET /api/contracts?contract_no=CMH_01-C01` | n/a (read) |
| 2 | (Conditional) create/update contract | normalized contract.json | `contracts` | `POST /api/contracts` | platform guards |
| 3 | Insert parties / contractor metadata | parties.json | `contracts.party_*` columns | `PATCH /api/contracts/[id]` if needed | platform guards |
| 4 | Provision/refresh users via Admin API | users.csv | `auth.users` + `profiles` | `npm run seed:auth-users` (Admin API only) | Yes — never raw SQL on auth.* |
| 5 | Sync user_contract_roles | user_contract_roles.csv | `user_contract_roles` | `PATCH /api/admin/users/[id]` (post IAM-3 fix; 3-tuple onConflict) | Yes |
| 6 | Insert BOQ items | boq_items.csv | `contract_boq_templates` | `POST /api/contracts/[id]/boq-template` (or admin equivalent) | n/a (template, not claim) |
| 7 | Insert variation orders | variation_orders.csv + variation_order_items.csv | `change_orders` + `change_order_*_items` | `POST /api/change-orders` then approve via the same path the platform uses | Yes — 10% governance enforced |
| 8 | Create claims (one at a time, in seq order) | claims.csv | `claims` (status=draft) | `POST /api/claims/create` (Migration 048 RPC) | **Yes — open-claim guard, advisory lock, claim_number generated server-side, prev_progress recomputed server-side** |
| 9 | For each claim: drive workflow to historical status | workflow_log.csv (sparse) + claims.csv.status | platform stage transitions | `POST /api/claims/transition` per stage | **Yes — full workflow engine, role validation via actor_role** |
| 10 | Link attachments per claim | claim_documents.csv + approvals.csv + certificates.csv | `documents` + Supabase Storage | `POST /api/documents` (or admin upload helper) | n/a |
| 11 | Reconciliation verification | platform DB + normalized layer | (read-only) | `GET` various report endpoints | n/a |

**Critical sequencing rules:**
- Claims must be inserted in `claim_seq` order (1 → 21).
- Each claim must be transitioned to its historical final status BEFORE the next claim is created — otherwise the open-claim guard rejects.
- VOs are inserted before claims that reference modified items.
- Stakeholders + roles are provisioned BEFORE any claim/transition (the transition route validates `actor_role` against `user_contract_roles`).
