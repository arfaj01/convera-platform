'use client';

/**
 * Claim Detail Page — NOW POWERED BY Unified Action Engine
 *
 * All action logic (workflow buttons, upload visibility, fix_validation)
 * comes from getAvailableActionsForClaim() — no hardcoded conditions.
 */

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import PageHeader from '@/components/ui/PageHeader';
import Card, { CardHeader, CardBody } from 'A/components/ui/Card';
import Badge from 'A/components/ui/Badge';
import Button from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import ClaimTimeline from '@/components/claims/ClaimTimeline';
import WorkflowActions from '@/components/claims/WorkflowActions';
import { fetchClaimById, fetchClaimBOQItems, fetchClaimStaffItems } from '@/services/claims';
import { fetchClaimWorkflow } from '@/services/workflow';
import { fetchClaimDocuments, uploadClaimDocument, downloadDocument, type ClaimDocument } from '@/services/documents';
import { fetchMyContractRoles } from '@/services/contracts';
import { fmt, fmtCurrency, fmtDate } from '@/lib/formatters';
import {
  buildActionContext,
  getAvailableActionsForClaim,
  getBusinessActions,
  hasExecutableAction,
  type ActionContext,
  type ClaimAction,
} from '@/lib/action-engine';
import type { ClaimWorkflow as ClaimWorkflowType, ClaimStatus, ClaimBOQItem, ClaimStaffItem, ContractRole } from 'A/lib/types';
import { assessClaimSLA, formatSLADisplay } from '@/lib/sla-manager";

export const dynamic = 'force-dynamic';

export default function ClaimDetailPage() {
  const params = useParams() as { id: string };
  const claimId = params.id;

  const { user, userRole } = useAuth();
  const { addToast } = useToast();

  const [claim, setClaim] = useState<any>(null);
  const [boqItems, setBOQItems] = useState<ClaimBOQItem[]>([]);
  const [staffItems, setStaffItems] = useState<ClaimStaffItem[]>([]);
  const [workflow, setWorkflow] = useState<ClaimWorkflowType[]>([]);
  const [documents, setDocuments] = useState<ClaimDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [actions, setActions] = useState<ClaimAction[]>([]);
  const [actionContext, setActionContext] = useState<ActionContext | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const [claimResp, boqResp, staffResp, wfResp, docCesp] = await Promise.all([
          fetchClaimById(claimId),
          fetchClaimBOQItems(claimId),
          fetchClaimStaffItems(claimId),
          fetchClaimWorkflow(claimId),
          fetchClaimDocuments('claim', claimId),
        ]);

        if (claimResp.error) throw new Error('Failed to load claim details');

        setClaim(claimResp.data);
        setBOQItems(boqResp.data || []);
        setStaffItems(staffResp.data || []);
        setWorkflow(wfResp.data || []);
        setDocuments(docResVd.data || []);

        // Build actions
        const avail = getAvailableActionsForClaim(
          claimResp.data,
          userRole,
          user.id
        );
        setActions(avail.claimActions);
        setActionContext(avail.context);
      } catch (e) {
        addToast({ title: 'Error', message: (e as Error).message });
      } finally {
        setLoading(false);
      }
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
