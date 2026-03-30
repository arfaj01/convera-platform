/**
 * GET /api/audit — Fetch audit logs (director and admin only)
 *
 * Query params:
 *   entity_type  — filter by table name (contracts, claims, etc.)
 *   entity_id    — filter by specific record UUID
 *   actor_id     — filter by user who performed action
 *   action       — filter by action type (CREATE, UPDATE, TRANSITION, etc.)
 *   from         — ISO date string, lower bound on created_at
 *   to           — ISO date string, upper bound on created_at
 *   limit        — max records to return (default 100, max 500)
 *   offset       — pagination offset
 *
 * Audit logs are immutable (no PATCH/DELETE exposed).
 */

import { NextRequest } from 'next/server';
import { withAuth, apiOk, apiError } from '@/lib/api-guard';
import { isValidUUID } from '@/lib/security';

export const GET = withAuth(
  async (req: NextRequest, ctx) => {
    const { admin } = ctx;
    const { searchParams } = req.nextUrl;

    // Parse query params
    const entity_type = searchParams.get('entity_type') ?? undefined;
    const entity_id   = searchParams.get('entity_id')   ?? undefined;
    const actor_id    = searchParams.get('actor_id')     ?? undefined;
    const action      = searchParams.get('action')       ?? undefined;
    const from        = searchParams.get('from')         ?? undefined;
    const to          = searchParams.get('to')           ?? undefined;
    const limit       = Math.min(500, parseInt(searchParams.get('limit') ?? '100', 10));
    const offset      = Math.max(0,   parseInt(searchParams.get('offset') ?? '0', 10));

    // Validate UUIDs to prevent injection
    if (entity_id && !isValidUUID(entity_id)) return apiError('معرف الكيان غير صالح');
    if (actor_id  && !isValidUUID(actor_id))  return apiError('معرف المستخدم غير صالح');

    // Build query
    let query = admin
      .from('audit_logs')
      .select('*, profiles!actor_id(full_name_ar, full_name, role)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (entity_type) query = query.eq('table_name',  entity_type);
    if (entity_id)   query = query.eq('record_id',   entity_id);
    if (actor_id)    query = query.eq('actor_id',    actor_id);
    if (action)      query = query.eq('action',      action);
    if (from)        query = query.gte('created_at', from);
    if (to)          query = query.lte('created_at', to);

    const { data, error, count } = await query;

    if (error) {
      console.error('[GET /api/audit]', error);
      return apiError('فشل تحميل سجل التدقيق', 500);
    }

    return apiOk({
      logs:   data ?? [],
      total:  count ?? 0,
      limit,
      offset,
    });
  },
  { roles: ['director', 'admin'] },
);
