# CMH_01 — Rollback Strategy

## Rollback windows

| Step | Reversibility | Action |
|---|---|---|
| 1-3 (contract row) | UPDATE-revert | Revert contract row to pre-import snapshot. |
| 4-5 (users + roles) | Soft-deactivate | Set is_active=false on user_contract_roles rows; revert profiles via PATCH. |
| 6 (BOQ template) | DELETE-able | DELETE contract_boq_templates rows for this contract. |
| 7 (VOs) | DELETE-able if not referenced | If any claim already references the VO, mark VO is_active=false. |
| 8 (claims) | **Cannot DELETE — legacy claims violate immutability rule** | Mark status='cancelled'; surface a `data_quality_notes` flag indicating this is a rolled-back import. |
| 9 (workflow log) | **Cannot DELETE** | The platform's workflow log is append-only by design. Compensating entries describe the rollback. |
| 10 (attachments) | DELETE-able | Remove documents rows + Storage objects for this contract. |

## Per-step rollback recipe
1. Capture the contract_id of CMH_01-C01.
2. Run the SQL rollback script (provided as `rollback.sql` in the migration runbook — operator-supplied; not in this repo).
3. Verify with the same diagnostic queries used in Phase 9.

## Hard-stop conditions

If any of the following is observed during Phase 8 migration, STOP immediately:
- HTTP 500 from `/api/claims/create` (likely RPC issue — capture error_code).
- A claim_number is duplicated (advisory lock failure).
- A user's contract_role assignment fails silently (regression of IAM-3 fix).

The operator initiates rollback per the table above; no further claims are imported until the issue is fixed.
