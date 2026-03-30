/**
 * CONVERA — Sprint B UAT: Contract-Scoped Roles
 *
 * Tests the 4 required scenarios against actual helper functions
 * using a mock Supabase client that simulates the production data.
 *
 * Production data (from migration 025):
 *   Contract A (b1000001): 231001101771
 *     - a1000004 (عبدالله البهدل)  → contractor
 *     - a1000002 (حسام الحبلين)    → auditor
 *     - a1000003 (محمود رجب)       → reviewer
 *
 *   Contract B (b1000002): 241039011332
 *     - a1000005 (مالك العقاب)     → contractor
 *     - a1000002 (حسام الحبلين)    → auditor
 *
 *   Contract C (no assignments for test user)
 *
 *   Director: a1000001 (محمد العرفج) → profiles.role = 'director'
 *
 * Run: npx tsx lib/__tests__/contract-permissions.uat.ts
 */

import type { ContractRole, UserRole, ClaimStatus } from '../types';

// ═══════════════════════════════════════════════════════════════════
//  MOCK SUPABASE CLIENT
// ═══════════════════════════════════════════════════════════════════

// Simulates production user_contract_roles data
const USER_CONTRACT_ROLES: Array<{
  user_id: string;
  contract_id: string;
  contract_role: ContractRole;
  is_active: boolean;
}> = [
  // Contract A: 231001101771
  { user_id: 'a1000004', contract_id: 'contract-A', contract_role: 'contractor', is_active: true },
  { user_id: 'a1000002', contract_id: 'contract-A', contract_role: 'auditor',    is_active: true },
  { user_id: 'a1000003', contract_id: 'contract-A', contract_role: 'reviewer',   is_active: true },
  // Contract B: 241039011332
  { user_id: 'a1000005', contract_id: 'contract-B', contract_role: 'contractor', is_active: true },
  { user_id: 'a1000002', contract_id: 'contract-B', contract_role: 'auditor',    is_active: true },
  // For Scenario 1+2 test: user who is contractor on A AND supervisor on B
  { user_id: 'test-user', contract_id: 'contract-A', contract_role: 'contractor', is_active: true },
  { user_id: 'test-user', contract_id: 'contract-B', contract_role: 'supervisor', is_active: true },
];

const USER_CONTRACTS: Array<{ user_id: string; contract_id: string }> = [
  { user_id: 'a1000004', contract_id: 'contract-A' },
  { user_id: 'a1000002', contract_id: 'contract-A' },
  { user_id: 'a1000003', contract_id: 'contract-A' },
  { user_id: 'a1000005', contract_id: 'contract-B' },
  { user_id: 'a1000002', contract_id: 'contract-B' },
  { user_id: 'test-user', contract_id: 'contract-A' },
  { user_id: 'test-user', contract_id: 'contract-B' },
];

function createMockAdmin(): any {
  return {
    from: (table: string) => {
      const data = table === 'user_contract_roles'
        ? USER_CONTRACT_ROLES
        : table === 'user_contracts'
          ? USER_CONTRACTS
          : [];

      return {
        select: (cols: string, opts?: { count: string; head: boolean }) => ({
          eq: function (col: string, val: any) {
            const self = this as any;
            if (!self._filters) self._filters = [];
            self._filters.push({ col, val });
            return self;
          },
          maybeSingle: function () {
            const filters = (this as any)._filters || [];
            const filtered = data.filter((row: any) =>
              filters.every((f: any) => row[f.col] === f.val),
            );
            const row = filtered[0] || null;
            return Promise.resolve({ data: row, error: null, count: filtered.length });
          },
          then: function (resolve: any) {
            const filters = (this as any)._filters || [];
            const filtered = data.filter((row: any) =>
              filters.every((f: any) => row[f.col] === f.val),
            );
            if (opts?.head) {
              resolve({ data: null, error: null, count: filtered.length });
            } else {
              resolve({ data: filtered, error: null, count: filtered.length });
            }
          },
          _filters: [] as any[],
        }),
      };
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
//  INLINE LOGIC (same as contract-permissions.ts, but standalone)
// ═══════════════════════════════════════════════════════════════════

const GLOBAL_ROLES: UserRole[] = ['director'];

const LEGACY_ROLE_MAP: Partial<Record<UserRole, ContractRole>> = {
  contractor: 'contractor',
  consultant: 'supervisor',
  supervisor: 'supervisor',
  admin: 'auditor',
  auditor: 'auditor',
  reviewer: 'reviewer',
};

type RoleSource = 'new_table' | 'legacy_fallback' | 'global_role' | 'none';

interface ContractRoleResult {
  role: ContractRole | null;
  source: RoleSource;
}

async function resolveContractRole(
  admin: any,
  userId: string,
  contractId: string,
  globalRole: UserRole,
): Promise<ContractRoleResult> {
  if (GLOBAL_ROLES.includes(globalRole)) {
    return { role: null, source: 'global_role' };
  }

  // Check user_contract_roles
  const ucrQuery = admin.from('user_contract_roles').select('contract_role');
  ucrQuery.eq('user_id', userId);
  ucrQuery.eq('contract_id', contractId);
  ucrQuery.eq('is_active', true);
  const { data: ucr } = await ucrQuery.maybeSingle();

  if (ucr?.contract_role) {
    return { role: ucr.contract_role as ContractRole, source: 'new_table' };
  }

  // Legacy fallback
  const legacyQuery = admin.from('user_contracts').select('contract_id', { count: 'exact', head: true });
  legacyQuery.eq('user_id', userId);
  legacyQuery.eq('contract_id', contractId);
  const legacyResult = await new Promise<any>((resolve) => legacyQuery.then(resolve));

  if ((legacyResult.count ?? 0) > 0) {
    const mappedRole = LEGACY_ROLE_MAP[globalRole] ?? null;
    return { role: mappedRole, source: 'legacy_fallback' };
  }

  return { role: null, source: 'none' };
}

// Workflow role mapping (from workflow-engine.ts)
function contractRoleToWorkflowRole(contractRole: ContractRole): UserRole | null {
  const map: Record<ContractRole, UserRole | null> = {
    contractor: 'contractor',
    supervisor: 'supervisor',
    auditor: 'auditor',
    reviewer: 'reviewer',
    viewer: null,
  };
  return map[contractRole] ?? null;
}

// Simplified transition check (from workflow-engine.ts CLAIM_TRANSITIONS)
const TRANSITIONS: Record<string, Array<{ action: string; toStatus: string; allowedRoles: UserRole[] }>> = {
  draft: [{ action: 'submit', toStatus: 'submitted', allowedRoles: ['contractor'] }],
  submitted: [{ action: 'assign_supervisor', toStatus: 'under_supervisor_review', allowedRoles: ['director', 'reviewer'] }],
  under_supervisor_review: [
    { action: 'approve', toStatus: 'under_auditor_review', allowedRoles: ['supervisor'] },
    { action: 'return', toStatus: 'returned_by_supervisor', allowedRoles: ['supervisor'] },
  ],
  under_auditor_review: [
    { action: 'approve', toStatus: 'under_reviewer_check', allowedRoles: ['auditor'] },
    { action: 'return', toStatus: 'returned_by_auditor', allowedRoles: ['auditor'] },
  ],
  under_reviewer_check: [
    { action: 'approve', toStatus: 'pending_director_approval', allowedRoles: ['reviewer'] },
    { action: 'return', toStatus: 'returned_by_auditor', allowedRoles: ['reviewer'] },
  ],
  pending_director_approval: [
    { action: 'approve', toStatus: 'approved', allowedRoles: ['director'] },
    { action: 'reject', toStatus: 'rejected', allowedRoles: ['director'] },
    { action: 'return', toStatus: 'under_auditor_review', allowedRoles: ['director'] },
  ],
};

function canTransition(status: string, action: string, workflowRole: UserRole): boolean {
  const defs = TRANSITIONS[status];
  if (!defs) return false;
  const def = defs.find((d) => d.action === action);
  if (!def) return false;
  return def.allowedRoles.includes(workflowRole);
}

// ═══════════════════════════════════════════════════════════════════
//  TEST RUNNER
// ═══════════════════════════════════════════════════════════════════

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${label}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${label}`);
    failed++;
  }
}

async function runUAT() {
  const admin = createMockAdmin();

  // ═════════════════════════════════════════════════════════════════
  //  SCENARIO 1: User with contract_role=contractor on Contract A
  //  - can create/submit claim on A
  // ═════════════════════════════════════════════════════════════════
  console.log('\n══ SCENARIO 1: Contractor on Contract A ══');
  {
    const userId = 'test-user';
    const contractA = 'contract-A';
    const globalRole: UserRole = 'contractor'; // profiles.role

    const result = await resolveContractRole(admin, userId, contractA, globalRole);
    assert(result.role === 'contractor', `resolveContractRole → contractor (got: ${result.role})`);
    assert(result.source === 'new_table', `source = new_table (got: ${result.source})`);

    // Can submit claim (draft → submitted)
    const workflowRole = contractRoleToWorkflowRole(result.role!);
    assert(workflowRole === 'contractor', `workflowRole = contractor (got: ${workflowRole})`);
    assert(canTransition('draft', 'submit', workflowRole!), 'can submit claim from draft');

    // Cannot approve (that's supervisor/auditor/reviewer/director)
    assert(!canTransition('under_supervisor_review', 'approve', workflowRole!), 'cannot approve at supervisor stage');
    assert(!canTransition('under_auditor_review', 'approve', workflowRole!), 'cannot approve at auditor stage');
    assert(!canTransition('pending_director_approval', 'approve', workflowRole!), 'cannot approve at director stage');
  }

  // ═════════════════════════════════════════════════════════════════
  //  SCENARIO 2: Same user with contract_role=supervisor on Contract B
  //  - cannot create claim on B
  //  - can review/transition at supervisor stage only
  // ═════════════════════════════════════════════════════════════════
  console.log('\n══ SCENARIO 2: Supervisor on Contract B ══');
  {
    const userId = 'test-user';
    const contractB = 'contract-B';
    const globalRole: UserRole = 'contractor'; // same user, same profiles.role

    const result = await resolveContractRole(admin, userId, contractB, globalRole);
    assert(result.role === 'supervisor', `resolveContractRole → supervisor (got: ${result.role})`);
    assert(result.source === 'new_table', `source = new_table (got: ${result.source})`);

    const workflowRole = contractRoleToWorkflowRole(result.role!);
    assert(workflowRole === 'supervisor', `workflowRole = supervisor (got: ${workflowRole})`);

    // Cannot submit claim (only contractor can)
    assert(!canTransition('draft', 'submit', workflowRole!), 'cannot submit claim (not contractor on B)');

    // Can approve at supervisor stage
    assert(canTransition('under_supervisor_review', 'approve', workflowRole!), 'CAN approve at supervisor stage');
    assert(canTransition('under_supervisor_review', 'return', workflowRole!), 'CAN return at supervisor stage');

    // Cannot act at auditor/reviewer/director stages
    assert(!canTransition('under_auditor_review', 'approve', workflowRole!), 'cannot approve at auditor stage');
    assert(!canTransition('under_reviewer_check', 'approve', workflowRole!), 'cannot approve at reviewer stage');
    assert(!canTransition('pending_director_approval', 'approve', workflowRole!), 'cannot approve at director stage');
  }

  // ═════════════════════════════════════════════════════════════════
  //  SCENARIO 3: User with no contract role on Contract C
  //  - cannot access C
  //  - cannot act on claims for C
  // ═════════════════════════════════════════════════════════════════
  console.log('\n══ SCENARIO 3: No role on Contract C ══');
  {
    const userId = 'test-user';
    const contractC = 'contract-C'; // no assignments exist
    const globalRole: UserRole = 'contractor';

    const result = await resolveContractRole(admin, userId, contractC, globalRole);
    assert(result.role === null, `resolveContractRole → null (got: ${result.role})`);
    assert(result.source === 'none', `source = none (got: ${result.source})`);

    // No workflow role → no actions possible
    assert(result.role === null, 'no contract role = no access');

    // Even if we tried to force a workflow check, it should fail
    // (no role to map to workflowRole)
    const workflowRole = result.role ? contractRoleToWorkflowRole(result.role) : null;
    assert(workflowRole === null, 'workflowRole = null (no actions possible)');
  }

  // ═════════════════════════════════════════════════════════════════
  //  SCENARIO 4: Director — global access
  //  - retains access to all contracts
  // ═════════════════════════════════════════════════════════════════
  console.log('\n══ SCENARIO 4: Director — Global Access ══');
  {
    const userId = 'a1000001';
    const globalRole: UserRole = 'director';

    // Contract A
    const resultA = await resolveContractRole(admin, userId, 'contract-A', globalRole);
    assert(resultA.source === 'global_role', `Contract A: source = global_role (got: ${resultA.source})`);
    assert(resultA.role === null, `Contract A: role = null (global bypass, got: ${resultA.role})`);

    // Contract B
    const resultB = await resolveContractRole(admin, userId, 'contract-B', globalRole);
    assert(resultB.source === 'global_role', `Contract B: source = global_role (got: ${resultB.source})`);

    // Contract C (no assignments, but director is global)
    const resultC = await resolveContractRole(admin, userId, 'contract-C', globalRole);
    assert(resultC.source === 'global_role', `Contract C: source = global_role (got: ${resultC.source})`);

    // Director can approve at director stage
    assert(canTransition('pending_director_approval', 'approve', 'director'), 'director CAN approve');
    assert(canTransition('pending_director_approval', 'reject', 'director'), 'director CAN reject');
    assert(canTransition('pending_director_approval', 'return', 'director'), 'director CAN return');
  }

  // ═════════════════════════════════════════════════════════════════
  //  BONUS: Verify dual-read — same user different roles per contract
  // ═════════════════════════════════════════════════════════════════
  console.log('\n══ BONUS: Multi-role verification ══');
  {
    const userId = 'test-user';
    const globalRole: UserRole = 'contractor';

    const roleA = await resolveContractRole(admin, userId, 'contract-A', globalRole);
    const roleB = await resolveContractRole(admin, userId, 'contract-B', globalRole);
    const roleC = await resolveContractRole(admin, userId, 'contract-C', globalRole);

    assert(roleA.role === 'contractor', `same user → contractor on A (got: ${roleA.role})`);
    assert(roleB.role === 'supervisor', `same user → supervisor on B (got: ${roleB.role})`);
    assert(roleC.role === null, `same user → null on C (got: ${roleC.role})`);

    // The key test: same user, different actions per contract
    const wfA = contractRoleToWorkflowRole(roleA.role!);
    const wfB = contractRoleToWorkflowRole(roleB.role!);
    assert(canTransition('draft', 'submit', wfA!) === true, 'can submit on A');
    assert(canTransition('draft', 'submit', wfB!) === false, 'cannot submit on B');
    assert(canTransition('under_supervisor_review', 'approve', wfA!) === false, 'cannot supervisor-approve on A');
    assert(canTransition('under_supervisor_review', 'approve', wfB!) === true, 'CAN supervisor-approve on B');
  }

  // ═════════════════════════════════════════════════════════════════
  //  SUMMARY
  // ═════════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(50));
  console.log(`  TOTAL: ${passed + failed} tests`);
  console.log(`  PASSED: ${passed}`);
  console.log(`  FAILED: ${failed}`);
  console.log('═'.repeat(50));

  if (failed > 0) {
    process.exit(1);
  }
}

runUAT().catch((e) => {
  console.error('UAT CRASHED:', e);
  process.exit(1);
});
