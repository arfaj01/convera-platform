'use client';

/**
 * CONVERA — Executive Performance Dashboard (لوحة الأداء التنفيذية)
 *
 * Sprint E — Phase 3
 *
 * Sections:
 * 1. Overall Performance KPIs
 * 2. Stage Performance Table
 * 3. Bottleneck Detection
 * 4. Top Delayed Claims
 * 5. Contract Risk Panel
 * 6. Governance Alerts
 */

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from 'A/components/AuthProvider';
import PageHeader from '@/components/ui/PageHeader';
import { createBrowserSupabase } from 'A/lib/supabase';
