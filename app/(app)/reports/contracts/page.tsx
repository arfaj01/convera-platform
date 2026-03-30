'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '@/components/AuthProvider';
import PageHeader from '@/components/ui/PageHeader';
import Card, { CardHeader, CardBody } from 'A/components/ui/Card';
import Badge from 'A/components/ui/Badge';
import Button from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import DataTable from '@/components/ui/DataTable';
import { fetchContracts } from '@/services/contracts';
import { fmtCore } from '@/lib/formatters';

*base * ./
