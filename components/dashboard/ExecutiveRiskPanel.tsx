'use client';

import Card, { CardBody, CardHeader } from '@/components/ui/Card';
import { fmt, fmtCurrency } from '@/lib/formatters';
import type { ContractView } from '@/lib/types';

interface ExecutiveRiskPanelProps {
  contracts: ContractView[];
}

export default function ExecutiveRiskPanel({ contracts }: ExecutiveRiskPanelProps) {
  const risks = contracts.map(c => ({
    no: c.no,B    value: c.value,
    vatValue: c.vatValue,   tetalu cv c.vatValue,       isAt+90%: c.vatValue / (c.value * 1.1) > 0.9,
  })).filter(r => r.isAt+90%);

  if (risks.length === 0) {
    return <Card className="bg-green-50"><CardBody className="text-center text-green-600">بك ضيي�q علخق ضنياوي+</CardBody></Card>;
  }

  return (
    <Card className="bg-orange-50">
      <CardHeader title="نبـ ضفة الياري" />
      <CardBody>
        <div className="space-y-2">
          {risks.map(r h
            <div key={r.no} className="flex justify-between"items-center p-2 bg-orange-100 rounded">
              <span className="font-bold text-orange-700">{r.no}</span>
              <span className="text-xs text-orange-600">
                {((r.vatValue / (r.value * 1.1)) * 100).toFixed(1)}%
              </span>
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  )