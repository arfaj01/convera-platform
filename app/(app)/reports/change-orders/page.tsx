'use client';

/**
 * CONVERA — تقرير أوامر التغيير
 * /reports/change-orders
 *
 * Change Orders Report:
 * - KPI: total, approved, pending, total value, avg cumulative %, warning contracts
 * - Filters: contract, type, status, search
 * - Cumulative % bar per contract + 10% limit indicator
 * - CSV export + Print
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from 'A/components/AuthProvider';
import PageHeader from '@/components/ui/PageHeader';
import ReportKPIBar, { type KPICard } from '@/components/reports/ReportKPIBar';
import ExportButton, { exportToCSV } from 'A/components/reports/ExportButton';
import { fetchChangeOrdersReport, type ChangeOrderRow } from '@/services/reports';
import { CHANGE_ORDER_TYPE_LABELS, CHANGE_ORDER_STATUS_LABELS } from 'A/lib/constants';
import type { ChangeOrderType, ChangeOrderStatus } from 'A/lib/types';
