# CMH_01 — Phase 4 Data Mapping Report

| Source field (Arabic) | Normalized field | Transformation | Confidence | Validation rule | Source |
|---|---|---|---|---|---|
| كود العقد | contract.contract_no | direct | high | matches `CMH_01-C01` literal | sheet العقد r2 |
| اسم المشروع | contract.title_ar | direct | high | non-empty | sheet العقد r2 |
| رقم العقد (اعتماد) | contract.contract_no_official | str(int) | high | numeric → string | sheet العقد r2 |
| نوع العقد | contract.type + .type_source_ar | CONTRACT_TYPE_MAP | high | enum membership | sheet العقد r2 |
| المقاول | parties[contractor].name_ar | direct | high | non-empty | sheet العقد r2 |
| قيمة العقد (بدون ض.م) | contract.base_value | float | high | > 0 | sheet العقد r2 |
| نسبة ض.ق.م % | contract.vat_rate | float | high | 0 < x ≤ 100 | sheet العقد r2 |
| الإجمالي شامل الضريبة (تلقائي) | contract.total_value | float | high | base_value * (1 + vat_rate/100) within 1% | sheet العقد r2 |
| تاريخ البدء / تاريخ الانتهاء | contract.start_date / .end_date | ISO-8601 date | high | start ≤ end | sheet العقد r2 |
| المدة (أشهر) | contract.duration_months | float | high | within ±2 of (end-start)/30 | sheet العقد r2 |
| نسبة الاستقطاع % | contract.retention_pct | float | high | 0 ≤ x ≤ 25 (10% in this contract) | sheet العقد r2 |
| حالة العقد | contract.status + .status_source_ar | STATUS_MAP | high | enum membership | sheet العقد r2 |
| الدور (سيدة المستخدمون) | user_contract_roles.contract_role | ROLE_MAP | high | ContractRole enum | sheet المستخدمون |
| الحالة (سيدة المطالبات) | claims.status + .status_source_ar | STATUS_MAP | high | claim_status enum | sheet المطالبات |
| نوع المطالبة | claims.claim_kind + .claim_kind_source_ar | CLAIM_KIND_FROM_AR / final detection | high | claim_kind enum | sheet المطالبات |
| الفترة من / إلى | claims.work_period_from / _to | ISO-8601 date | high | from ≤ to | sheet المطالبات |
| سعر الوحدة | boq_items.unit_price | float | high | ≥ 0 | sheet بنود العقد |
| الكمية التعاقدية | boq_items.contractual_qty | float | high | > 0 | sheet بنود العقد |
| نموذج التقدم | boq_items.progress_model | 'count' if 'عددي' else 'percentage' | high | enum {count, percentage, monthly_lump_sum} | sheet بنود العقد |
| كمية هذه الفترة | claim_line_items.curr_progress | float | high | server-validated against contractual_qty | sheet بنود المطالبات |
| المنصرف السابق (تلقائي) | claim_line_items.prev_progress | float (informational) | low | NOT trusted; RPC recomputes | sheet بنود المطالبات |
| نوع العملية (سيدة بنود أوامر التغيير) | variation_order_items.operation_ar | direct | medium | one of: زيادة كمية, تقليل كمية, إضافة بند, … | sheet بنود أوامر التغيير |
| نسبة الإنجاز التراكمية | cumulative_item_progress.cumulative_pct | float (0-100 or 0-1 normalised) | high | reconcile with SUM(curr_progress) | sheet الملخص التراكمي |

Every Arabic source label is preserved in the corresponding `*_source_ar` column for traceability and audit.
