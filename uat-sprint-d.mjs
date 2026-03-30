/**
 * CONVERA — Sprint D UAT Test Suite
 * ─────────────────────────────────────────────────────────────────
 * Tests PROBLEM 1 (multi-contract /claims/new) and PROBLEM 2
 * (user management contract-role assignment).
 *
 * Scenarios:
 *  1. Contractor with 2 contracts → both appear in claim creation
 *  2. Supervisor on 3rd contract → excluded from claim creation
 *  3. Single contractor contract → auto-select
 *  4. Zero contractor contracts → empty state
 *  5. User management CRUD for contract-role assignments
 *  6. Effective permissions after assignment changes
 *
 * Run: node uat-sprint-d.mjs
 */

import { createClient } from '@supabase/supabase-js';

// ── Configuration ────────────────────────────────────────────────

const SUPABASE_URL  = 'https://ngwxlockzkjpmzuvgakx.supabase.co';
const ANON_KEY      = 'sb_publishable_6xkw-2RiY8Y23OYQUFsvkw_4yj4ocr6';
const SERVICE_KEY   = 'sb_secret_Cfs8TGG2JINrQy3PmnCs2Q_26rccZFK';

// Known users from seed data
const USERS = {
  director:   { email: 'ma.alarfaj@momah.gov.sa',    pass: '0555180602', id: null },
  auditor:    { email: 'h.hablayn@momah.gov.sa',      pass: '0555180602', id: null },
  supervisor: { email: 'mahmoud@fiveam.co',            pass: '0555180602', id: null },
  contractor1:{ email: 'a.bahdal@momah.gov.sa',       pass: '0555180602', id: null },
  contractor2:{ email: 'malik@contracting.com',        pass: '0555180602', id: null },
  reviewer:   { email: 'ahmed.rashidi@momah.gov.sa',   pass: '0555180602', id: null },
};

// ── Clients ──────────────────────────────────────────────────────

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function anonClient() {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ── Test Framework ───────────────────────────────────────────────

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];
const warnings = [];

function test(name, ok, detail = '') {
  if (ok) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
    failed++;
    failures.push({ name, detail });
  }
}

function warn(msg) {
  console.log(`  ⚠️  ${msg}`);
  warnings.push(msg);
}

function skip(name, reason) {
  console.log(`  ⏭️  ${name} — SKIPPED: ${reason}`);
  skipped++;
}

function section(title) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('═'.repeat(60));
}

// ── Helpers ──────────────────────────────────────────────────────

async function signIn(userKey) {
  const u = USERS[userKey];
  const client = anonClient();
  const { data, error } = await client.auth.signInWithPassword({
    email: u.email, password: u.pass,
  });
  if (error) throw new Error(`Sign-in failed for ${u.email}: ${error.message}`);
  u.id = data.user.id;
  return client;
}

async function getContracts() {
  const { data, error } = await admin.from('contracts').select('id, contract_no, title, title_ar, status, external_user_id');
  if (error) throw error;
  return data;
}

async function getUserContractRoles(userId) {
  const { data, error } = await admin
    .from('user_contract_roles')
    .select('*')
    .eq('user_id', userId);
  if (error) {
    if (error.code === '42P01') return []; // table doesn't exist
    throw error;
  }
  return data || [];
}

async function setUserContractRoles(userId, assignments, assignedBy) {
  // Deactivate existing
  await admin
    .from('user_contract_roles')
    .update({ is_active: false })
    .eq('user_id', userId)
    .eq('is_active', true);

  if (assignments.length === 0) return;

  // Upsert new
  const rows = assignments.map(a => ({
    user_id: userId,
    contract_id: a.contract_id,
    contract_role: a.contract_role,
    is_active: true,
    assigned_by: assignedBy,
    notes: 'UAT Sprint D test setup',
  }));

  const { error } = await admin
    .from('user_contract_roles')
    .upsert(rows, { onConflict: 'user_id,contract_id' });

  if (error) throw error;
}

// ── RPC helpers (test migration 027 functions) ───────────────────

async function testRpc_getMyContractsByRole(client, role) {
  const { data, error } = await client.rpc('get_my_contracts_by_role', { _role: role });
  return { data, error };
}

async function testRpc_getMyContractRoles(client) {
  const { data, error } = await client.rpc('get_my_contract_roles');
  return { data, error };
}

async function testRpc_getUserContractRolesAdmin(client, userId) {
  const { data, error } = await client.rpc('get_user_contract_roles_admin', { _user_id: userId });
  return { data, error };
}

// ══════════════════════════════════════════════════════════════════
//  MAIN TEST EXECUTION
// ══════════════════════════════════════════════════════════════════

async function run() {
  console.log('\n🧪 CONVERA Sprint D — Focused UAT');
  console.log('─'.repeat(60));

  // ── Pre-flight: discover contracts and users ───────────────────
  section('PRE-FLIGHT: Discover Contracts & Users');

  const contracts = await getContracts();
  console.log(`  Found ${contracts.length} contracts:`);
  contracts.forEach(c => console.log(`    • ${c.contract_no} — ${c.title_ar || c.title} (${c.status})`));

  if (contracts.length < 2) {
    console.log('\n⛔ Need at least 2 contracts for UAT. Aborting.');
    process.exit(1);
  }

  const CONTRACT_A = contracts[0];
  const CONTRACT_B = contracts[1];
  console.log(`\n  CONTRACT_A: ${CONTRACT_A.contract_no} (${CONTRACT_A.id.slice(0,8)}...)`);
  console.log(`  CONTRACT_B: ${CONTRACT_B.contract_no} (${CONTRACT_B.id.slice(0,8)}...)`);

  // Sign in all users to get IDs
  for (const key of Object.keys(USERS)) {
    try {
      const c = await signIn(key);
      console.log(`  ${key}: ${USERS[key].email} → ${USERS[key].id?.slice(0,8)}...`);
    } catch (e) {
      console.log(`  ${key}: ${USERS[key].email} → SIGN-IN FAILED: ${e.message}`);
    }
  }

  // Check if migration 027 RPC functions exist
  let has027 = false;
  try {
    const testClient = anonClient();
    await testClient.auth.signInWithPassword({ email: USERS.director.email, password: USERS.director.pass });
    const { error } = await testClient.rpc('get_my_contract_roles');
    has027 = !error;
    console.log(`\n  Migration 027 RPC functions: ${has027 ? '✅ Available' : '❌ Not applied yet'}`);
    if (!has027) console.log(`    Error: ${error?.message}`);
  } catch (e) {
    console.log(`  Migration 027 RPC functions: ❌ Not available (${e.message})`);
  }

  // ══════════════════════════════════════════════════════════════
  //  SCENARIO 1: Contractor with 2 contracts
  // ══════════════════════════════════════════════════════════════
  section('SCENARIO 1: Contractor with 2 contracts');

  // Setup: assign contractor1 as contractor on both contracts
  const c1Id = USERS.contractor1.id;
  if (!c1Id) {
    skip('All Scenario 1 tests', 'contractor1 sign-in failed');
  } else {
    await setUserContractRoles(c1Id, [
      { contract_id: CONTRACT_A.id, contract_role: 'contractor' },
      { contract_id: CONTRACT_B.id, contract_role: 'contractor' },
    ], USERS.director.id);

    // Verify assignment persisted
    const roles = await getUserContractRoles(c1Id);
    const activeRoles = roles.filter(r => r.is_active);
    test('1.1 — contractor1 has 2 active contract_roles',
      activeRoles.length === 2,
      `Expected 2, got ${activeRoles.length}`);

    const contractorRoles = activeRoles.filter(r => r.contract_role === 'contractor');
    test('1.2 — both roles are "contractor"',
      contractorRoles.length === 2,
      `Expected 2 contractor roles, got ${contractorRoles.length}`);

    const contractIds = new Set(activeRoles.map(r => r.contract_id));
    test('1.3 — roles are on CONTRACT_A and CONTRACT_B',
      contractIds.has(CONTRACT_A.id) && contractIds.has(CONTRACT_B.id),
      `Missing contracts: A=${contractIds.has(CONTRACT_A.id)}, B=${contractIds.has(CONTRACT_B.id)}`);

    // Test RPC function (if 027 applied)
    if (has027) {
      const client1 = await signIn('contractor1');
      const { data: rpcData, error: rpcErr } = await testRpc_getMyContractsByRole(client1, 'contractor');
      test('1.4 — RPC get_my_contracts_by_role returns 2 contracts',
        !rpcErr && rpcData && rpcData.length === 2,
        rpcErr ? rpcErr.message : `Got ${rpcData?.length} contracts`);

      if (rpcData) {
        const rpcIds = new Set(rpcData);
        test('1.5 — RPC returns correct contract IDs',
          rpcIds.has(CONTRACT_A.id) && rpcIds.has(CONTRACT_B.id),
          `A=${rpcIds.has(CONTRACT_A.id)}, B=${rpcIds.has(CONTRACT_B.id)}`);
      }

      // get_my_contract_roles should return both
      const { data: allRoles, error: allErr } = await testRpc_getMyContractRoles(client1);
      test('1.6 — RPC get_my_contract_roles returns 2 rows',
        !allErr && allRoles && allRoles.length === 2,
        allErr ? allErr.message : `Got ${allRoles?.length}`);
    } else {
      skip('1.4 — RPC get_my_contracts_by_role', 'Migration 027 not applied');
      skip('1.5 — RPC returns correct IDs', 'Migration 027 not applied');
      skip('1.6 — RPC get_my_contract_roles', 'Migration 027 not applied');
    }

    // Test self-read RLS policy (if 027 applied)
    if (has027) {
      const client1 = await signIn('contractor1');
      const { data: selfRows, error: selfErr } = await client1
        .from('user_contract_roles')
        .select('contract_id, contract_role')
        .eq('is_active', true);

      test('1.7 — Self-read RLS: contractor1 can read own rows',
        !selfErr && selfRows && selfRows.length >= 2,
        selfErr ? selfErr.message : `Got ${selfRows?.length} rows`);
    } else {
      skip('1.7 — Self-read RLS', 'Migration 027 not applied');
    }

    // Test that contractor1 can see both contracts via contracts table RLS
    {
      const client1 = await signIn('contractor1');
      const { data: visibleContracts, error: vcErr } = await client1
        .from('contracts')
        .select('id');

      const visible = (visibleContracts || []).map(c => c.id);
      const seesA = visible.includes(CONTRACT_A.id);
      const seesB = visible.includes(CONTRACT_B.id);
      test('1.8 — contractor1 sees CONTRACT_A via contracts RLS',
        seesA, `Visible: ${visible.length} contracts`);
      test('1.9 — contractor1 sees CONTRACT_B via contracts RLS',
        seesB, `Visible: ${visible.length} contracts`);
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  SCENARIO 2: Supervisor on 3rd contract → excluded from claims/new
  // ══════════════════════════════════════════════════════════════
  section('SCENARIO 2: Supervisor role excluded from claim creation');

  if (!c1Id) {
    skip('All Scenario 2 tests', 'contractor1 sign-in failed');
  } else {
    // Setup: contractor1 = contractor on A, contractor on B, supervisor on...
    // We only have 2 contracts, so we'll test the filter logic:
    // Make contractor1: contractor on A, supervisor on B
    await setUserContractRoles(c1Id, [
      { contract_id: CONTRACT_A.id, contract_role: 'contractor' },
      { contract_id: CONTRACT_B.id, contract_role: 'supervisor' },
    ], USERS.director.id);

    const roles = await getUserContractRoles(c1Id);
    const active = roles.filter(r => r.is_active);
    test('2.1 — contractor1 has contractor on A, supervisor on B',
      active.length === 2 &&
      active.some(r => r.contract_id === CONTRACT_A.id && r.contract_role === 'contractor') &&
      active.some(r => r.contract_id === CONTRACT_B.id && r.contract_role === 'supervisor'),
      `Roles: ${JSON.stringify(active.map(r => ({c: r.contract_id.slice(0,8), role: r.contract_role})))}`);

    if (has027) {
      const client1 = await signIn('contractor1');

      // get_my_contracts_by_role('contractor') should return ONLY contract A
      const { data: contractorContracts } = await testRpc_getMyContractsByRole(client1, 'contractor');
      test('2.2 — RPC contractor role → only CONTRACT_A',
        contractorContracts && contractorContracts.length === 1 && contractorContracts[0] === CONTRACT_A.id,
        `Got: ${JSON.stringify(contractorContracts)}`);

      // get_my_contracts_by_role('supervisor') should return ONLY contract B
      const { data: supervisorContracts } = await testRpc_getMyContractsByRole(client1, 'supervisor');
      test('2.3 — RPC supervisor role → only CONTRACT_B',
        supervisorContracts && supervisorContracts.length === 1 && supervisorContracts[0] === CONTRACT_B.id,
        `Got: ${JSON.stringify(supervisorContracts)}`);

      // get_my_contract_roles should return both (different roles)
      const { data: allRoles } = await testRpc_getMyContractRoles(client1);
      test('2.4 — RPC all roles returns 2 rows with different roles',
        allRoles && allRoles.length === 2,
        `Got ${allRoles?.length}`);

      if (allRoles && allRoles.length === 2) {
        const roleA = allRoles.find(r => r.contract_id === CONTRACT_A.id);
        const roleB = allRoles.find(r => r.contract_id === CONTRACT_B.id);
        test('2.5 — Role A is contractor, Role B is supervisor',
          roleA?.contract_role === 'contractor' && roleB?.contract_role === 'supervisor',
          `A=${roleA?.contract_role}, B=${roleB?.contract_role}`);
      }

      // has_contract_role checks
      const { data: hasContractorA } = await client1.rpc('has_contract_role', {
        _contract_id: CONTRACT_A.id, _role: 'contractor'
      });
      test('2.6 — has_contract_role(A, contractor) = true', hasContractorA === true);

      const { data: hasContractorB } = await client1.rpc('has_contract_role', {
        _contract_id: CONTRACT_B.id, _role: 'contractor'
      });
      test('2.7 — has_contract_role(B, contractor) = false', hasContractorB === false,
        `Got: ${hasContractorB}`);

      const { data: hasSupervisorB } = await client1.rpc('has_contract_role', {
        _contract_id: CONTRACT_B.id, _role: 'supervisor'
      });
      test('2.8 — has_contract_role(B, supervisor) = true', hasSupervisorB === true);

    } else {
      skip('2.2-2.8', 'Migration 027 not applied');
    }

    // Restore: put contractor1 back to contractor on both for remaining tests
    await setUserContractRoles(c1Id, [
      { contract_id: CONTRACT_A.id, contract_role: 'contractor' },
      { contract_id: CONTRACT_B.id, contract_role: 'contractor' },
    ], USERS.director.id);
  }

  // ══════════════════════════════════════════════════════════════
  //  SCENARIO 3: Single contractor contract → auto-select
  // ══════════════════════════════════════════════════════════════
  section('SCENARIO 3: Single contractor contract');

  const c2Id = USERS.contractor2.id;
  if (!c2Id) {
    skip('All Scenario 3 tests', 'contractor2 sign-in failed');
  } else {
    // Setup: contractor2 as contractor on CONTRACT_A only
    await setUserContractRoles(c2Id, [
      { contract_id: CONTRACT_A.id, contract_role: 'contractor' },
    ], USERS.director.id);

    const roles = await getUserContractRoles(c2Id);
    const active = roles.filter(r => r.is_active);
    test('3.1 — contractor2 has exactly 1 active contractor role',
      active.length === 1 && active[0].contract_role === 'contractor',
      `Active: ${active.length}, role: ${active[0]?.contract_role}`);

    test('3.2 — contractor2 role is on CONTRACT_A',
      active[0]?.contract_id === CONTRACT_A.id);

    if (has027) {
      const client2 = await signIn('contractor2');
      const { data: myContracts } = await testRpc_getMyContractsByRole(client2, 'contractor');
      test('3.3 — RPC returns exactly 1 contract for contractor2',
        myContracts && myContracts.length === 1,
        `Got: ${myContracts?.length}`);
      test('3.4 — RPC returns CONTRACT_A',
        myContracts && myContracts[0] === CONTRACT_A.id);
    } else {
      skip('3.3-3.4', 'Migration 027 not applied');
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  SCENARIO 4: Zero contractor contracts → empty state
  // ══════════════════════════════════════════════════════════════
  section('SCENARIO 4: Zero contractor contracts');

  // Use the reviewer user who should have no contractor assignments
  const reviewerId = USERS.reviewer.id;
  if (!reviewerId) {
    skip('All Scenario 4 tests', 'reviewer sign-in failed');
  } else {
    // Setup: reviewer has reviewer role on contracts, NOT contractor
    await setUserContractRoles(reviewerId, [
      { contract_id: CONTRACT_A.id, contract_role: 'reviewer' },
      { contract_id: CONTRACT_B.id, contract_role: 'reviewer' },
    ], USERS.director.id);

    if (has027) {
      const clientR = await signIn('reviewer');
      const { data: contractorContracts } = await testRpc_getMyContractsByRole(clientR, 'contractor');
      test('4.1 — Reviewer has ZERO contractor contracts',
        contractorContracts && contractorContracts.length === 0,
        `Got: ${contractorContracts?.length}`);

      // But should have reviewer role
      const { data: reviewerContracts } = await testRpc_getMyContractsByRole(clientR, 'reviewer');
      test('4.2 — Reviewer has 2 reviewer contracts',
        reviewerContracts && reviewerContracts.length === 2,
        `Got: ${reviewerContracts?.length}`);

      // has_contract_role checks
      const { data: hasContractorA } = await clientR.rpc('has_contract_role', {
        _contract_id: CONTRACT_A.id, _role: 'contractor'
      });
      test('4.3 — has_contract_role(A, contractor) = false for reviewer',
        hasContractorA === false, `Got: ${hasContractorA}`);

      const { data: hasReviewerA } = await clientR.rpc('has_contract_role', {
        _contract_id: CONTRACT_A.id, _role: 'reviewer'
      });
      test('4.4 — has_contract_role(A, reviewer) = true for reviewer',
        hasReviewerA === true, `Got: ${hasReviewerA}`);

    } else {
      skip('4.1-4.4', 'Migration 027 not applied');
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  SCENARIO 5: User management — assign, save, reload
  // ══════════════════════════════════════════════════════════════
  section('SCENARIO 5: User management — contract-role CRUD');

  if (!c1Id || !USERS.director.id) {
    skip('All Scenario 5 tests', 'director or contractor1 sign-in failed');
  } else {
    // 5.1: Director sets contractor1 as: contractor A, contractor B, supervisor on...
    // We only have 2 contracts. Test: contractor on A, supervisor on B.
    await setUserContractRoles(c1Id, [
      { contract_id: CONTRACT_A.id, contract_role: 'contractor' },
      { contract_id: CONTRACT_B.id, contract_role: 'supervisor' },
    ], USERS.director.id);

    // 5.2: Read back and verify
    const roles1 = await getUserContractRoles(c1Id);
    const active1 = roles1.filter(r => r.is_active);
    test('5.1 — After save: 2 active roles for contractor1',
      active1.length === 2, `Got: ${active1.length}`);

    const roleMap1 = {};
    active1.forEach(r => roleMap1[r.contract_id] = r.contract_role);
    test('5.2 — CONTRACT_A = contractor',
      roleMap1[CONTRACT_A.id] === 'contractor', `Got: ${roleMap1[CONTRACT_A.id]}`);
    test('5.3 — CONTRACT_B = supervisor',
      roleMap1[CONTRACT_B.id] === 'supervisor', `Got: ${roleMap1[CONTRACT_B.id]}`);

    // 5.4: Update — change B from supervisor to auditor
    await setUserContractRoles(c1Id, [
      { contract_id: CONTRACT_A.id, contract_role: 'contractor' },
      { contract_id: CONTRACT_B.id, contract_role: 'auditor' },
    ], USERS.director.id);

    const roles2 = await getUserContractRoles(c1Id);
    const active2 = roles2.filter(r => r.is_active);
    const roleMap2 = {};
    active2.forEach(r => roleMap2[r.contract_id] = r.contract_role);
    test('5.4 — After update: CONTRACT_B changed to auditor',
      roleMap2[CONTRACT_B.id] === 'auditor', `Got: ${roleMap2[CONTRACT_B.id]}`);
    test('5.5 — CONTRACT_A unchanged (still contractor)',
      roleMap2[CONTRACT_A.id] === 'contractor', `Got: ${roleMap2[CONTRACT_A.id]}`);

    // 5.6: Remove all assignments
    await setUserContractRoles(c1Id, [], USERS.director.id);
    const roles3 = await getUserContractRoles(c1Id);
    const active3 = roles3.filter(r => r.is_active);
    test('5.6 — After removing all: 0 active roles',
      active3.length === 0, `Got: ${active3.length}`);

    // 5.7: Inactive rows should still exist (soft delete)
    const inactive3 = roles3.filter(r => !r.is_active);
    test('5.7 — Soft-deleted rows still exist',
      inactive3.length >= 2, `Got: ${inactive3.length} inactive rows`);

    // 5.8: Re-assign (upsert should reactivate)
    await setUserContractRoles(c1Id, [
      { contract_id: CONTRACT_A.id, contract_role: 'contractor' },
      { contract_id: CONTRACT_B.id, contract_role: 'contractor' },
    ], USERS.director.id);
    const roles4 = await getUserContractRoles(c1Id);
    const active4 = roles4.filter(r => r.is_active);
    test('5.8 — Re-assignment: 2 active roles restored',
      active4.length === 2, `Got: ${active4.length}`);

    // 5.9: Test director admin RPC (if 027 applied)
    if (has027) {
      const dirClient = await signIn('director');
      const { data: adminView, error: adminErr } = await testRpc_getUserContractRolesAdmin(dirClient, c1Id);
      test('5.9 — Director admin RPC returns contractor1 roles',
        !adminErr && adminView && adminView.length >= 2,
        adminErr ? adminErr.message : `Got ${adminView?.length}`);
    } else {
      skip('5.9 — Director admin RPC', 'Migration 027 not applied');
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  SCENARIO 6: Effective permissions after assignment changes
  // ══════════════════════════════════════════════════════════════
  section('SCENARIO 6: Effective permissions after changes');

  if (!c1Id) {
    skip('All Scenario 6 tests', 'contractor1 sign-in failed');
  } else {
    // Setup: contractor1 = contractor on A only (not B)
    await setUserContractRoles(c1Id, [
      { contract_id: CONTRACT_A.id, contract_role: 'contractor' },
    ], USERS.director.id);

    // "Re-login" — create fresh client
    const freshClient = await signIn('contractor1');

    // 6.1: has_contract_role(A, contractor) should be true
    const { data: hasA } = await freshClient.rpc('has_contract_role', {
      _contract_id: CONTRACT_A.id, _role: 'contractor'
    });
    test('6.1 — After re-login: has_contract_role(A, contractor) = true',
      hasA === true, `Got: ${hasA}`);

    // 6.2: has_contract_role(B, contractor) should be false (was removed)
    const { data: hasB } = await freshClient.rpc('has_contract_role', {
      _contract_id: CONTRACT_B.id, _role: 'contractor'
    });
    test('6.2 — After re-login: has_contract_role(B, contractor) = false',
      hasB === false, `Got: ${hasB}`);

    // 6.3: has_contract_access(A) should be true
    const { data: accessA } = await freshClient.rpc('has_contract_access', {
      _contract_id: CONTRACT_A.id,
    });
    test('6.3 — has_contract_access(A) = true', accessA === true, `Got: ${accessA}`);

    // 6.4: has_contract_access(B) should be false
    const { data: accessB } = await freshClient.rpc('has_contract_access', {
      _contract_id: CONTRACT_B.id,
    });
    test('6.4 — has_contract_access(B) = false', accessB === false, `Got: ${accessB}`);

    // 6.5: get_contract_role(A) should be 'contractor'
    const { data: roleA } = await freshClient.rpc('get_contract_role', {
      _contract_id: CONTRACT_A.id,
    });
    test('6.5 — get_contract_role(A) = contractor', roleA === 'contractor', `Got: ${roleA}`);

    // 6.6: get_contract_role(B) should be null
    const { data: roleB } = await freshClient.rpc('get_contract_role', {
      _contract_id: CONTRACT_B.id,
    });
    test('6.6 — get_contract_role(B) = null', roleB === null, `Got: ${roleB}`);

    // 6.7: Now add B back as supervisor — check effective permissions change
    await setUserContractRoles(c1Id, [
      { contract_id: CONTRACT_A.id, contract_role: 'contractor' },
      { contract_id: CONTRACT_B.id, contract_role: 'supervisor' },
    ], USERS.director.id);

    // Re-check with same session (no re-login needed — permissions are DB-level)
    const { data: hasBnow } = await freshClient.rpc('has_contract_role', {
      _contract_id: CONTRACT_B.id, _role: 'supervisor'
    });
    test('6.7 — After adding B as supervisor: has_contract_role(B, supervisor) = true',
      hasBnow === true, `Got: ${hasBnow}`);

    const { data: accessBnow } = await freshClient.rpc('has_contract_access', {
      _contract_id: CONTRACT_B.id,
    });
    test('6.8 — After adding B: has_contract_access(B) = true',
      accessBnow === true, `Got: ${accessBnow}`);

    // 6.9: But contractor role on B should still be false
    const { data: contractorBnow } = await freshClient.rpc('has_contract_role', {
      _contract_id: CONTRACT_B.id, _role: 'contractor'
    });
    test('6.9 — has_contract_role(B, contractor) still false (is supervisor)',
      contractorBnow === false, `Got: ${contractorBnow}`);

    if (has027) {
      const { data: myContracts } = await testRpc_getMyContractsByRole(freshClient, 'contractor');
      test('6.10 — get_my_contracts_by_role(contractor) returns only A',
        myContracts && myContracts.length === 1 && myContracts[0] === CONTRACT_A.id,
        `Got: ${JSON.stringify(myContracts)}`);
    } else {
      skip('6.10 — get_my_contracts_by_role', 'Migration 027 not applied');
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  BONUS: Cross-user isolation
  // ══════════════════════════════════════════════════════════════
  section('BONUS: Cross-user isolation');

  if (has027 && c1Id && c2Id) {
    // contractor2 should NOT see contractor1's roles
    const client2 = await signIn('contractor2');
    const { data: c2Rows } = await client2
      .from('user_contract_roles')
      .select('user_id, contract_id, contract_role')
      .eq('is_active', true);

    const c2SelfOnly = (c2Rows || []).every(r => r.user_id === c2Id);
    test('BONUS.1 — contractor2 can only see own rows (not contractor1)',
      c2SelfOnly, `Sees ${c2Rows?.length} rows, all self: ${c2SelfOnly}`);

    // contractor2 should NOT be able to call admin RPC
    const { error: adminErr } = await testRpc_getUserContractRolesAdmin(client2, c1Id);
    test('BONUS.2 — contractor2 cannot call admin RPC',
      !!adminErr, adminErr ? `Correctly blocked: ${adminErr.message.slice(0,50)}` : 'Should have failed');

  } else {
    skip('BONUS tests', has027 ? 'Users not available' : 'Migration 027 not applied');
  }

  // ══════════════════════════════════════════════════════════════
  //  CLEANUP: Restore test data
  // ══════════════════════════════════════════════════════════════
  section('CLEANUP');

  // Restore contractor1 to contractor on both
  if (c1Id) {
    await setUserContractRoles(c1Id, [
      { contract_id: CONTRACT_A.id, contract_role: 'contractor' },
      { contract_id: CONTRACT_B.id, contract_role: 'contractor' },
    ], USERS.director.id);
    console.log('  Restored contractor1: contractor on A + B');
  }

  // Restore contractor2 to contractor on A only
  if (c2Id) {
    await setUserContractRoles(c2Id, [
      { contract_id: CONTRACT_A.id, contract_role: 'contractor' },
    ], USERS.director.id);
    console.log('  Restored contractor2: contractor on A');
  }

  // Restore reviewer
  if (reviewerId) {
    await setUserContractRoles(reviewerId, [
      { contract_id: CONTRACT_A.id, contract_role: 'reviewer' },
      { contract_id: CONTRACT_B.id, contract_role: 'reviewer' },
    ], USERS.director.id);
    console.log('  Restored reviewer: reviewer on A + B');
  }

  // ══════════════════════════════════════════════════════════════
  //  RESULTS
  // ══════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(60));
  console.log('  UAT RESULTS');
  console.log('═'.repeat(60));
  console.log(`  ✅ Passed:  ${passed}`);
  console.log(`  ❌ Failed:  ${failed}`);
  console.log(`  ⏭️  Skipped: ${skipped}`);
  console.log('─'.repeat(60));

  if (failures.length > 0) {
    console.log('\n  FAILURES:');
    failures.forEach((f, i) => {
      console.log(`    ${i+1}. ${f.name}`);
      if (f.detail) console.log(`       Detail: ${f.detail}`);
    });
  }

  if (warnings.length > 0) {
    console.log('\n  WARNINGS:');
    warnings.forEach(w => console.log(`    • ${w}`));
  }

  console.log('\n' + '═'.repeat(60));

  // Exit code
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => {
  console.error('\n⛔ Unhandled error:', e);
  process.exit(2);
});
