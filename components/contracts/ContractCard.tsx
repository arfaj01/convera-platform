'use client';

import { useRouter } from 'next/navigation';
import { fmt, fmtDate } from '@/lib/formatters';
import { CustomBadge } from '@/components/ui/Badge';
import type { ContractView } from '@/lib/types';

interface ContractCardProps {
  contract: ContractView;
  onClick?: () => void;
}

export default function ContractCard({ contract, onClick }: ContractCardProps) {
  const router = useRouter();
  const progress = 0; // TODO: calculate from claims

  function handleClick() {
    if (onClick) {
      onClick();
    } else {
      router.push(`/contracts/${contract.id}`);
    }
  }

  return (
    <div
      className="bg-white rounded border-[1.5px] border-gray-100 p-4 shadow-card transition-all hover:border-teal-light hover:shadow-cardHover cursor-pointer"
      onClick={handleClick}
    >
      <div className="flex justify-between items-start mb-2.5">
        <CustomBadge label={contract.no} variant="teal" />
        <CustomBadge
          label={contract.status === 'active' ? 'نشط' : contract.status}
          variant={contract.status === 'active' ? 'green' : 'gray'}
        />
      </div>

      <div className="text-sm font-bold text-teal-dark mt-1">{contract.title}</div>
      <div className="text-xs text-gray-600 mt-0.5">{contract.party}</div>

      <div className="grid grid-cols-4 gap-2 mt-3 pt-3 border-t border-gray-100">
        <div>
          <label className="text-[0.67rem] text-gray-400 font-bold block">القيمة</label>
          <span className="text-sm text-teal-dark font-bold">{fmt(contract.value)}</span>
        </div>
        <div>
          <label className="text-[0.67rem] text-gray-400 font-bold block">النوع</label>
          <span className="text-sm text-teal-dark font-bold">{contract.type}</span>
        </div>
        <div>
          <label className="text-[0.67rem] text-gray-400 font-bold block">البداية</label>
          <span className="text-sm text-teal-dark font-bold">{fmtDate(contract.start)}</span>
        </div>
        <div>
          <label className="text-[0.67rem] text-gray-400 font-bold block">المدة</label>
          <span className="text-sm text-teal-dark font-bold">{contract.duration} شهر</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-2.5">
        <div className="flex justify-between text-[0.73rem] text-gray-600 mb-1">
          <span>التقدم</span>
          <span>{progress}%</span>
        </div>
        <div className="h-[5px] bg-gray-100 rounded-[3px] overflow-hidden">
          <div
            className="h-full rounded-[3px] bg-gradient-to-l from-teal to-teal-light transition-[width] duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  
  }
}
