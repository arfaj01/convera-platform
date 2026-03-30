# PROBLEM 1 & 2 — Implementation Validation

## Files Modified

### New Files
| File | Purpose |
|------|---------|
| `SQL/migrations/027_contract_role_browser_helpers.sql` | Helper RPC functions + RLS self-read policy on user_contract_roles |
| `FRONTEND/app/api/admin/users/[id]/contract-roles/route.ts` | GET endpoint to fetch user's contract-role assignments |

### Modified Files
| File | Changes |
|------|---------|
| `FRONTEND/services/contracts.ts` | Added `fetchContractorContracts()` and `fetchMyContractRoles()` with dual-read (RPC → legacy fallback) |
| `FRONTEND/app/(app)/claims/new/page.tsx` | Complete rewrite: contract selector dropdown, multi-contract support, auto-select for single |
| `FRONTEND/services/admin-users.ts` | Added `ContractRoleAssignment` type; extended `AdminUser`, `CreateUserInput`, `UpdateUserInput` |
| `FRONTEND/components/users/UserFormModal.tsx` | Per-contract role dropdown (contractor/supervisor/auditor/reviewer/viewer) replacing simple checkboxes |
| `FRONTEND/app/(app)/users/page.tsx` | Loads contract_roles from new API endpoint |
| `FRONTEND/app/api/admin/users/route.ts` | POST syncs `user_contract_roles` in addition to `user_contracts` |
| `FRONTEND/app/api/admin/users/[id]/route.ts` | PATCH syncs `user_contract_roles` via `syncContractRoles()` function |

---

## Test Scenario Validation

### Scenario 1: Contractor with ONE contract
- `fetchContractorContracts()` returns 1 contract
- `availableContracts.length === 1` → auto-select, no dropdown
- BOQ/Staff templates load immediately
- **Status: COVERED**

### Scenario 2: Contractor with TWO contracts
- `fetchContractorContracts()` returns 2 contracts
- `availableContracts.length > 1` → radio button selector shown (Step 1)
- "اختر العقد أعلاه لبدء إعداد المطالبة المالية" shown until selection
- On selection: contract state resets, templates reload for new contract
- **Status: COVERED**

### Scenario 3: User with NO contractor contracts
- `fetchContractorContracts()` returns []
- Empty state: "لا توجد عقود مرتبطة بحسابك" with guidance
- "العودة لقائمة المطالبات" button
- **Status: COVERED**

### Scenario 4: Director assigns contractor on 2 contracts + supervisor on 1
- UserFormModal shows all available contracts with per-contract role dropdown
- User A: contract X → contractor, contract Y → contractor, contract Z → supervisor
- `contract_roles` array sent to API: [{X, contractor}, {Y, contractor}, {Z, supervisor}]
- API syncs both `user_contracts` (legacy) and `user_contract_roles` (new)
- **Status: COVERED**

### Scenario 5: Mixed roles (same user, different roles on different contracts)
- UserFormModal supports any ContractRole per contract
- Each contract row has its own dropdown independently
- Default role matches user's profile role (e.g., auditor → auditor contract role)
- Can be changed per contract
- **Status: COVERED**

---

## Dual-Read Pattern

All new code follows the dual-read pattern established in Sprint B:

1. **New table first** (user_contract_roles via RPC or API)
2. **Legacy fallback** (user_contracts + external_user_id)
3. **Graceful degradation** if migration 027 is not yet applied

This ensures the platform works in three states:
- Pre-027: legacy behavior (no regression)
- Post-027, pre-026: new RPC works, old RLS still active
- Post-026+027: fully contract-scoped roles
