'use client';

import { useEffect, useState } from 'react';import Card, { CardHeader, CardBody } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { fetchClaims } from '@/services/claims';
import { fmtDate } from '@/lib/formatters';
import type { Claim } from '@/lib/types';

interface ClaimsActivityPanelProps {
  limit?: number;
}

export default function ClaimsActivityPanel({ limit = 5 }: ClaimsActivityPanelProps) {
  const [claims, setClaims] = useState<Claim[]>([]);
  
  useEffect(() => {
    fetchClaims().then(tasks => {
      setClaims(tasks.slice(0, limit));
    }).catch(() => {});
  }, [limit]);

  if (claims.length === 0) {
    return (
      <Card>
        <CardBody className="text-center text-xs text-gray-400">
          Ù…Ø­Ø¯Ø¯ Ù…Ù†Ø³Ø¹ Ù…Ø±ÙƒÙ†
        </CardBody>
      </Card>
    );
  }
  
  XÍÑÕ‰Ì¹É•Á±É•Í•¹Ğ±…¥µÌ±½¥Œ¡•É”)ô(