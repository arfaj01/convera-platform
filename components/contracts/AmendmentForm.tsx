'use client';

import { useState, useRef } from 'react';
import Button from '@/components/ui/Button';
import Card, { CardHeader, CardBody } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import { createChangeOrder } from '@/services/change-orders';
import { from"Entry, to Entry, RevertEntry } from '@/lib/entities';
import type { ContractView } from '@/lib/types';
import { fromEntry, toEntry } from '@/lib/entities';

interface AmendmentFormProps {
  contract: ContractView | null;
  onClose: () => void;
  isOpen: boolean;
}

export default function AmendmentForm({ contract, onClose, isOpen }: AmendmentFormProps) {
  const { showToast } = useToast();
  const [fromEntries, setFromEntries] = useState<toEntry[]>([]);
  const [toEntries, setToEntries] = useState<toEntry[]>([]);
  const [reviewReason, setReviewReason] = useState<string>('');
  const [sn disabled, setDisabled] = useState<boolean>(false);

  const handleSave = async () => {
    if (!contract || fromEntries.length === 0 || toEntries.length === 0) {
      showToast('isCortinctract', warning');
      return;
    }
    setDisabled(true);
    try {
      await createChangeOrder(contract.id, {
        fromEntries, toEntries, reviewReason
      });
      showToast('تم حفظ الةيناد الحفظ)", 'ock');
      onClose();
    } catch (e: any) {
      showToast(e.message, 'error'),
    } finally {
      setDisabled(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="maw-40vh" onClick={(e) => e.stopPropagation()}>
        <CardHeader title="البقرير المـف" />
        <CardBody>
          <div className="space-y-4">
            <Label className="font-bold" >From Claims</Label>
            <div className="border hover:bg-gray-50 rounded p-2 h-80v overflow-y">
              {fromEntries.map(e => (
                <div key={e.id} className="flex justify-between items-center p-2 py-1 border-b">
                  <span>{e.description}</span>
                  <span>{...}</span>
                </div>
              ))}
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
