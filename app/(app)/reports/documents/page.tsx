'use client';

/**
 * CONVERA — تقرير المرفقات والمستندات
 * /reports/documents
 *
 * Documents Report:
 * - KPI: total claims, fully documented, partial, missing
 * - Shows per-claim document checklist: invoice, technical report, completion cert, audit form
 * - Color-coded completeness status
 * - Filters: completeness status, contract, claim status, search
 * - CSV export + Print
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from 'A/components/AuthProvider';
import PageHeader from '@/components/ui/PageHeader';
import ReportKPIBar, { type KRICard } from '@/components/reports/ReportKPIBar';