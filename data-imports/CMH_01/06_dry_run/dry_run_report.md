# CMH_01 — Phase 7 Dry-Run Report

> Generated 2026-05-05. Read-only — no SQL, no Supabase writes, no API mutations, no file moves.

## Scope

Constructed every payload that Phase 8 controlled migration would send, validated each against schema + business rules, and produced an ordered sequence with offsets per step.

## Payload counts

| Step | Kind | Count | Status |
|---:|---|---:|---|
| 1 | contract | 1 | ready |
| 2 | user_contract_roles | 6 | ready |
| 3 | boq_template | 386 | ready (batch) |
| 4 | change_orders | 5 | ready |
| 5 | change_order_items | 603 | ready (batch per VO) |
| 6 | claims_create | 21 | ready |
| 7 | claim_transitions | 105 | ready (variable per-claim) |
| 8 | claim_documents | 70 | ready |
| 8 | approvals | 40 | ready |
| 8 | certificates | 35 | ready |

**Total payloads constructed:** 278

## Validation results

- Critical errors blocking Phase 8: **1**
- Payload-validation issues: **1**

### Payload validation issues

| endpoint | issues | note |
|---|---|---|
| `/api/claims/create` | claim has no positive curr_progress lines, work_period_* missing | claim_seq=15; expected claim_number prefix CMH01R<YYMMDD>-<NNN>. |

## Live DB schema check

This sandbox does not have read-only access to the staging Supabase instance. The dry-run is therefore offline:
- Payload structure verified against the platform's API request types in `app/api/claims/create/route.ts` (`CreateClaimRequest`).
- RPC parameter list verified against `SQL/migrations/048_create_claim_with_items_atomic.sql` and `050_fix_claim_rpc_claim_type_cast.sql`.
- ENUM values verified against `lib/types.ts::ContractRole`, `claim_kind`, and the platform's claim_status union.

## Read-only constraints honoured

- ✅ No SQL executed.
- ✅ No Supabase writes.
- ✅ No API mutations.
- ✅ No file moves from source.
- ✅ No push.
- ✅ Source folder unchanged.
- ✅ Database state unchanged.

## Verdict

⚠ READY with 1 payload-validation warnings — operator review required before Phase 8.
