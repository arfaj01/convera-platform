# CMH_01 Production Import — Execution Report

> **Generated:** 2026-05-10T15:06:15.328Z
> **Mode:** EXECUTE
> **Status:** COMPLETED — main inserts done; status flip pending operator
> **Started at:** 2026-05-10T15:06:09.457Z
> **Finished at:** 2026-05-10T15:06:15.328Z

## Row counts

| Stage | Count |
|---|---:|
| contracts updated (placeholder filled) | 1 |
| user_contract_roles updated (anaalghamdi reviewer→auditor) | 1 |
| contract_boq_templates inserted | 386 |
| claims inserted (status=draft) | 21 |
| claim_boq_items inserted | 1562 |
| documents (DEFERRED to Phase 9) | 0 inserted, 145 rows in source |
| imports audit row | failed (non-blocking) |

## Inserted claim IDs

- claim seq 1: `ae7ad90f-eb80-4a22-b816-75a51abbb1c3`
- claim seq 2: `62f9e8c1-34c7-46c1-a787-7d2cc3660dac`
- claim seq 3: `8ddfc1d2-4c72-4f4c-a002-51b924557c33`
- claim seq 4: `d4791e9b-81b8-408c-96dc-ef45b0b06cd5`
- claim seq 5: `6d84d6a0-e511-41a1-b328-839e54d31115`
- claim seq 6: `b132c0e2-37dc-4f1a-b0a1-2d59c9d1dd5f`
- claim seq 7: `7883478d-b1d6-4ca1-b13e-50ff6dd1a0f7`
- claim seq 8: `8bc58ad1-ad30-4b84-bc00-2df5b9fa84c5`
- claim seq 9: `0fc558de-8c14-40b2-9293-a013febd27b8`
- claim seq 10: `a14e853b-19fc-47bd-92dd-8c7c5e8ecb7c`
- claim seq 11: `7e361920-6311-4286-904f-6231931db023`
- claim seq 12: `a5d9c985-e3e9-4581-a214-4bda12538b60`
- claim seq 13: `4fb53e2f-6ff2-4340-aada-738321e6185e`
- claim seq 14: `112108f3-11ba-4e0d-949a-30b6ffa20fdd`
- claim seq 15: `36bbad7c-f59c-4c2f-b7b2-3d11b1339825`
- claim seq 16: `d9a846dc-20e0-4dcb-a4c2-8582c212d12c`
- claim seq 17: `bf2d39ff-394e-4979-a7be-9f6502451129`
- claim seq 18: `2e14173c-1479-4210-bbe1-8ba8eedb2b1c`
- claim seq 19: `c7d35fea-c195-4d85-9a8b-7fabc084f623`
- claim seq 20: `fc041686-aa08-4aeb-990e-e8c3c8beffd7`
- claim seq 21: `71fbf5c7-3923-48b3-8175-e0ca2af465ef`

## Validation (post-import counts)

| Table | Observed | Expected | OK? |
|---|---:|---:|---:|
| contract_boq_templates | 386 | 386 | ✓ |
| claims | 21 | 21 | ✓ |
| claim_boq_items | 1562 | 1562 | ✓ |

## Warnings

- **imports row**: Could not find the 'source_label' column of 'imports' in the schema cache

## Errors

_(none)_

## Next manual steps (operator-driven)

1. **APPROVE-CMH01-STATUS-FLIP** — paste `C:\Users\Administrator\Desktop\cmh01_post_import_flip_status.sql` into Supabase Studio SQL Editor (PRODUCTION) and click Run. Expected verification: `approved_count = 21`.
2. **APPROVE-CMH01-STORAGE-UPLOAD** (Phase 9, separate phase) — upload the 145 physical PDF files to Supabase Storage, then INSERT the corresponding `documents` rows.
3. **Distribute the post-import SQL** ONLY through a secure channel; **DELETE the file** from Desktop after running it.
4. **Delete `prod-temp.env`** after the rotation procedure is over.

## Confirmations

- ✅ No `auth.users` row was touched.
- ✅ No password rotation was performed.
- ✅ No migration was run.
- ✅ No git push was performed.
- ✅ No secret value was logged or written to disk.
