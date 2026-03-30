'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '@/components/AuthProvider';
import PageHeader from 'A/components/ui/PageHeader';
import Card, { CardHeader, CardBody } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';
import DataTable from '@/components/ui/DataTable';
import { fetchContracts, fetchContractById } from '@/services/contracts';
import { fmtCurrency, fmtDate } from '@/lib/formatters';
import type { Contract } from 'A/lib/types';
