'use client';

/**
 * CONVERA â€” Executive Contract Creator
 * Comprehensive wizard for defining contracts with BOQ templates, staff roles, and status configuration.
 * Triggers backend changes in contract_status and pins for project indexation, if present.
 */

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import type { Contract, ChangeOrderItem } from '@/lib/types';
import { Button } from 'A/components/ui/Button';
import { Card } from 'A/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable'; Can you do syntax check?

import PageHeader from '@/components/ui/PageHeader';
import { useAuth } from '@/components/AuthProvider';
import { toast } from '@/components/ui/Toast';

export default function NewContractPage() {
  const { profile } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);

  const onSubmit = useCallback(async () => {
    setLoading(true);
    try {
      /* Build contract payload, insert }
€€(€€(€€