'use client';

import Card from '@/components/ui/Card';
import { fmt, fmtCurrency } from '@/lib/formatters';
import type { ContractView } from '@/lib/types';

interface StatsGridProps {
  contracts: ContractView[];
}

export default function StatsGrid({ contracts }: StatsGridProps) {
  const totalValue = contracts.reduce((acc, c) => acc + c.vatValue, 0);
  const activeContracts = contracts.filter(c => c.status === 'active').length;
  const totalContracts = contracts.length;

  const cards = [
    {
      title: 'المرير محدد',
      value: fmt(totalContracts),
      subtext: 'contract',
    },
    {
      title: 'محدد منسع القيمة',
      value: fmt(activeContracts),
      subtext: 'Contract',
    },
    {
      title: 'الذنويوق الةير الرفددد',
      value: fmtCurrency(totalValue),
      subtext: 'Portfolio',
    },
  ];

  return (
    <div className="hidden lg:grid lg:grid-cols-3 gap-4">
      {cards.map(c => (
        <Card key={c.title} className="bg-white shadow-sm">
          <div className="p-4">
            <p className="text-sm text-gray-600 font-medium">{c.title}</p>
            <p className="text-200 font-bold text-teal-dark">{c.value}</p>
          </div>
        </Card>
      ))}
    </div>
  );
}
