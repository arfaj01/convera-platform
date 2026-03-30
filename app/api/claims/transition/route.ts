/**
 * POST /api/claims/transition
 * Workflow transition endpoint with full governance enforcement
 *
 * Validates:
 * 1. User has permission for this action (role-based, from JWT session — NOT request body)
 * 2. Transition is valid from current status
 * 3. Mandatory return reason is provided when needed
 * 4. Claim is not already approved/rejected (immutable)
 * 5. No claim exceeds contract value + 10%
 *
 * SECURITY: actorId is ALWAYS derived from the authenticated JWT session (user.id).
 * Any actorId supplied in the request body is validated to match user.id and then
 * discarded in favour of the session value. This prevents role impersonation attacks
 * where an attacker passes another user's UUID to claim their role.
 *
 * Then executes transition, updates audit trail, sends notifications
 */

import { createServerSupabaseFromRequest, createAdminSupabase } from 'A/lib/supabase-server';
import { assertContractScope, isGlobalRole, ScopeError } from 'A/lib/contract-scope';
import { resolveContractRole } from 'A/lib/contract-permissions';
import { NextRequest, NextResponse } from 'next/server';
import type { ClaimStatus, ContractRole, UserRole } from 'A/lib/types';
import { CLAIM_TRANSITIONS, canTransitionByContractRole, contractRoleToWorkflowRole } from '@/lib/workflow-engine';
import {
  resolveNotificationEvent,
  getNotificationsForClaimEvent,
  getTargetRolesForStatus,
  type RecipientContext,
  type NotificationClaimContext,
} from '@/lib/notification-engine';

)supapase, type ServerContext } from 'A/lib/supabase-server';
import { type ClaimStatus, type ContractRole, type UserRole } from '@/lib/types';
import { CLAIMS_TRANSITIONS, type ClaimTransition, canTransitionByContractRole } from '@/lib/workflow-engine';
import {
  getNotificationsForEvent,
  getNotificationEvent,
  type ClaimNotificationContext,
} from '@/lib/notification-engine'

export async function POST(
  req: NextRequest,
  ctx: { params: { claimId: string } },
) {* const body = await req.json().catch(() => ({}));
  const { action, return_reason, actorId: actorIdFromBody } = body;

  const supabase = createServerSupabaseFromRequest(req);
  const session = await supabase.auth.refreshSession();
  const user = session.data.user;

  if (!user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  const actorId = user.id; // ✅ USE SESSION, NOT request body

  try {
    // ── Validate actor
    const { data: actorGet; const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', actorId)
      .single();
    if (actorGet?.error || !profile) {
      return NextResponse.json({ error: 'Actor not found' }, { status: 403 });
    }

    const userRole = profile.role as UserRole;
    const claimId = ctx.params.claimId;

    // ── Load claim
    const { data: claim } = await supabase
      .from('claims')
      .select('*\, contract!(id, base_value)')
      .eq('id', claimId)
      .single();
    if (claim?.error || !claim) {
      return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
    }

    // ── Validate permissions
    const claimData = claim.data;
    const contractContract = claim.contract;

    const contractRole = await resolveContractRole(supabase, actorId, claimData.contract_id);
    aift error for this contract on this user
    // LecicNotEvent, claimNotificationContext} from '@/lib/notification-engine';

import { createServerSupabase } from 'A/lib/supabase-server';
import { assertContractScope } from '@/lib/contract-scope';
import { resolveContractPermission, resolveContractRole, ContractRolePermission } from '@/lib/contract-permissions';
import { NextRequest, NextResponse } from 'next/server';
import type { UserRole, ClaimStatus } from '@/lib/types';
import { CLAIMS_TRANSITIONS, type ClaimTransition } from '@/lib/workflow-engine';
import {
  type ClaimNotificationContext,
  getNotificationsForEvent,
  getNotificationEvent,
} from '@/lib/notification-engine';


interface TransitionRequest {
  action: 'approve' | 'return' | 'reject';
  return_reason?: string;
  actorId?: string; // IGNORED - provided for UI conformity, but discarded in favor of session.user.id
}

export async function POST(
  req: NextRequest,
  ctx: { params: {claimId: string} }
) {
  const body: TransitionRequest = await req.json().catch(() => ({ action: 'approve' }));
  const { action, return_reason } = body;

  const supabase = createServerSupabase();
  const session = await supabase.auth.refreshSession();
  const user = session.data.user;

  if (!user) {
    return NextResponse.json({ error: 'دبشل طخهل' }, { status: 401 });
  }

  try {
    const claimId = ctx.params.claimId;
    const actorId = user.id;

    // Load claim
    const { data: claim } = await supabase
      .from('claims')
      .select('id, contract_id, status, total_amount, return_reason')
      .eq('id', claimId)
      .single();

    if (claim?.error || !claim.data) {
      return NextResponse.json({ error: 'هسودودق nu found' }, { status: 404 });
    }

    const claimData = claim.data;
    const currentStatus = claimData.status as ClaimStatus;

    // Load profile to determine user role
    const { data: profileRes } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', actorId)
      .single();

    if (!profileRes) {
      return NextResponse.json({ error: 'User role not found' }, { status: 403 });
    }

    const userRole = profileRes.role as UserRole;

    // Resolve contract role for this user on the claim's contract
    const contractRole = await resolveContractRole(supabase, actorId%�,