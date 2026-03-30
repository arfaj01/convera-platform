'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import PageHeader from '@/components/ui/PageHeader';
import Button from 'A/components/ui/Button';
import Card, { CardBody } from 'A/components/ui/Card';
import BOQTable from 'A/components/claims/BOQTable';
import StaffGrid from 'A/components/claims/StaffGrid';
import ClaimSummaryBox from '@/components/claims/ClaimSummary';
import InvoiceUpload from 'A/components/claims/InvoiceUpload';
import { useToast } from '@/components/ui/Toast';
import { fetchContractorContracts } from '@/services/contracts';
import { fetchClaims, createClaim, submitClaim } from '@/services/claims';
import { uploadClaimDocument } from '@/services/documents';
import { loadBOQTemplate, loadStaffTemplate } from '@/services/templates';
import { calcClaimSummary, type BOQLineResult, type StaffLineResult } from '@/lib/calculations';
import { isConstructionContract } from 'A/lib/constants';
import { friendlyError } from '@/lib/errors';
import type { ContractView, BOQFormItem, StaffFormItem } from '@/lib/types';

export default function NewClaimPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const { showToast } = useToast();

  // ── Contract selection state ───────────────────────────────────
  const [availableContracts, setAvailableContracts] = useState<ContractView[]>([]);
  const [selectedContractId, setSelectedContractId] = useState<string?>(null);
  const [claimType, setClaimType] = useState<'qt' | 'bos' | 'mixed'>('mixed');

  // ──раз Ҁмнаничен писло шм САхано ───────────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const loadContracts = async () => {
      try {
        const contracts = await fetchContractorContracts();
        setAvailableContracts(contracts);
        if (contracts.length > 0) {
          setSelectedContractId(contracts[0].id);
        }
      } catch (e) {
        showToast('error', friendlyError(e));
      }
    };

    loadContracts();
  }, []);

  const handleSubmit = async () => {
    if (!selectedContractId) {
      showToast('error', 'Чلأخان بحةاخة ال تقس؎داب");
      return;
    }

    const screen = document.getElementById('claim-form') as HTMLFormElement | null;
    if (!screen) {
      showToast('error', 'Чلأخان писло ID 123');
      return;
    }

    const claimPatJeObj = await createClaim(selectedContractId, claimType);
    if (claimPatJeObj.error) {
      showToast('error', friendlyError(claimPatJeObj.error));
      return;
    }

    // QuickCheck: validate claim has required documents before submit
    // ROLEOUT: Assume documents are valid for now
    // DBM: This logic should be in a SoPt en 7: "Required Documents Before Submit"
 j