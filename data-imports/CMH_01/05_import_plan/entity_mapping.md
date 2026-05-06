# CMH_01 — Entity Mapping (Normalized → Platform Schema)

| Normalized file | Platform table | Key columns | Notes |
|---|---|---|---|
| `contract.json` | `contracts` | contract_no, base_value, vat_rate, retention_pct, start_date, end_date, status | post Migration 045/046/047 |
| `parties.json` | `contracts.party_name_ar` (+ Future: separate `contract_parties` if added) | — | Owner is implicit; contractor flows into contract row |
| `users.csv` | `auth.users` (Admin API) + `profiles` | email, full_name_ar, role | provisioning via `npm run seed:auth-users` |
| `user_contract_roles.csv` | `user_contract_roles` | (user_id, contract_id, contract_role) — 3-tuple unique key | post Migration 045 |
| `boq_items.csv` | `contract_boq_templates` | item_no, description, unit, unit_price, contractual_qty | progress_model derived |
| `claims.csv` | `claims` | claim_number (server-issued), claim_kind, work_period_*, status | RPC `create_claim_with_items_atomic` |
| `claim_line_items.csv` | `claim_boq_items` | claim_id, item_no, curr_progress | prev_progress recomputed by RPC |
| `variation_orders.csv` | `change_orders` | order_no, status, net_impact | 10% governance enforced |
| `variation_order_items.csv` | `change_order_boq_items` | order_id, item_no, qty | |
| `workflow_log.csv` | `claim_workflow` | (auto-populated by platform on transition) | not directly imported |
| `claim_documents.csv` | `documents` (entity_type='claim', document_type='invoice') | claim_id, file_path | Supabase Storage upload |
| `approvals.csv` | `documents` (entity_type='claim', document_type='approval_certificate') | | |
| `certificates.csv` | `documents` (entity_type='claim', document_type='completion_certificate') | | |
| `cumulative_item_progress.csv` | (verification only — derived from claim_boq_items) | | Phase-9 reconciliation |
