# Claim 15 Patch Log

> Applied: 2026-05-05 (operator-approved option-b-header-only).
> Source of patched values: `data-imports/CMH_01/04_validation/claim_15_investigation.md` §6.

## Diff (before → after)

| Field | Before | After |
|---|---|---|
| `work_period_from` | `(empty)` | `2024-08-24` |
| `work_period_to` | `(empty)` | `2024-11-07` |
| `boq_amount` | `0.0` | `9661835.75` |
| `gross_amount` | `0.0` | `9661835.75` |
| `retention_amount` | `0.0` | `966183.575` |
| `net_amount` | `0.0` | `8695652.175` |
| `vat_amount` | `0.0` | `1304347.826` |
| `total_amount` | `0.0` | `10000000.0` |
| `cumulative_amount` | `32167779.621160492` | `42167777.28` |
| `data_quality_notes` | `(empty)` | `Claim header restored from المستخلص 15.pdf + شهادة اعتماد-15.pdf + شهادة انجاز-1…` |
| `extraction_method` | `sheet المطالبات` | `sheet المطالبات (header) + claim_15_investigation.md §6 patch (totals from PDFs)` |


## Verification

- File modified: `data-imports/CMH_01/03_normalized/claims.csv` (claim_seq=15 row only).
- All 9 fields populated with values extracted from the three PDFs.
- `data_quality_notes` carries the provenance and the structural rationale.
- No claim_line_items added (option-b-header-only intent preserved).
- No other rows modified.

## Next step

The Phase-8 import script (`scripts/import-cmh01-controlled.js`) reads this patched
claims.csv and sends `POST /api/claims/create` for claim_seq=15 with `boq_items: []`.
Cumulative continuity for claims 16-21 is preserved because SMART's per-item
cumulative tracking already excludes claim 15.
