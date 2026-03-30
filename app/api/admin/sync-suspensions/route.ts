/**
 * POST /api/admin/sync-suspensions
 *
 * ONE-TIME UTILITY — Run once after deploying the is_active enforcement fix.
 *
 * Problem: Before the fix, setting profiles.is_active = false did NOT ban
 * the user in Supabase Auth (GoTrue). Users marked as suspended could still
 * sign in because GoTrue is independent from the profiles table.
 *
 * This endpoint reads ALL profiles where is_active = false and applies
 * ban_duration = '87600h' (10 years) to each one via the Supabase Admin API.
 *
 * It also ensures all active users (is_active = true) have ban_duration = 'none'
 * to undo any accidental bans.
 *
 * Director only. Idempotent — safe to run multiple times.
 *
 * Usage:
 *   POST /api/admin/sync-suspensions
 *   Authorization: Bearer <director_jwt>
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseFromRequest, createAdminSupabase } from '@/lib/supabase-server';