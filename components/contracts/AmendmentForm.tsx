'use client';

import { useState } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { createAmendment } from '@/services/amendments';

interface AmendmentFormProps {
  contractId: string;
  createdBy: string;
  existingCount: number;
  onClose: () => void;
  onCreated: () => void;
}

export default function AmendmentForm({
  contractId,
  createdBy,
  existingCount,
  onClose,
  onCreated,
}: AmendmentFormProps) {
  const nextNo = `AM-${String(existingCount + 1).padStart(2, '0')}`;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [valueChange, setValueChange] = useState('');
  const [durationChange, setDurationChange] = useState('0');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const val = parseFloat(valueChange);
    if (isNaN(val) || val === 0) {
      setError('يجب إدخال قيمة التعديل (موجبة للزيادة، سالبة للتخفيض)');
      return;
    }
    if (!title.trim()) {
      setError('يجب إدخال عنوان التعديل');
      return;
    }

    setLoading(true);
    try {
      await createAmendment({
        contractId,
        amendmentNo: nextNo,
        title: title.trim(),
        description: description.trim() || undefined,
        valueChange: val,
        durationChange: parseInt(durationChange) || 0,
        createdBy,
      });
      onCreated();
    } catch (err) {
      setError((err as Error).message || 'حدث خطأ أثناء إنشاء التعديل');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="طلب تعديل عقد"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button variant="teal" onClick={handleSubmit} disabled={loading}>
            {loading ? 'جاري الإرسال...' : 'تقديم طلب التعديل'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-2.5 bg-red-light text-red border-r-[3px] border-red rounded-sm text-sm">
            {error}
          </div>
        )}

        {/* Amendment number (auto) */}
        <div>
          <label className="block text-xs font-bold text-gray-600 mb-1">رقم التعديل</label>
          <input
            type="text"
            value={nextNo}
            readOnly
            className="w-full px-3 py-2.5 border-[1.5px] border-gray-100 rounded-sm text-sm font-sans bg-gray-100 text-gray-500 text-right"
          />
        </div>

        {/* Title */}
        <div>
          <label className="block text-xs font-bold text-gray-600 mb-1">عنوان التعديل *</label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="مثال: زيادة كميات أعمال السلامة"
            required
            className="w-full px-3 py-2.5 border-[1.5px] border-gray-100 rounded-sm text-sm font-sans bg-gray-50 focus:outline-none focus:border-teal text-right"
          />
        </div>

        {/* Value change */}
        <div>
          <label className="block text-xs font-bold text-gray-600 mb-1">
            قيمة التعديل (ريال) * <span className="text-gray-400 font-normal">— موجب للزيادة، سالب للتخفيض</span>
          </label>
          <input
            type="number"
            value={valueChange}
            onChange={e => setValueChange(e.target.value)}
            placeholder="500000"
            step="0.01"
            required
            className="w-full px-3 py-2.5 border-[1.5px] border-gray-100 rounded-sm text-sm font-sans bg-gray-50 focus:outline-none focus:border-teal text-right"
          />
        </div>

        {/* Duration change */}
        <div>
          <label className="block text-xs font-bold text-gray-600 mb-1">
            تغيير المدة (شهر) <span className="text-gray-400 font-normal">— 0 = بدون تغيير</span>
          </label>
          <input
            type="number"
            value={durationChange}
            onChange={e => setDurationChange(e.target.value)}
            className="w-full px-3 py-2.5 border-[1.5px] border-gray-100 rounded-sm text-sm font-sans bg-gray-50 focus:outline-none focus:border-teal text-right"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs font-bold text-gray-600 mb-1">الوصف</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="تفاصيل التعديل وأسبابه..."
            rows={3}
            className="w-full px-3 py-2.5 border-[1.5px] border-gray-100 rounded-sm text-sm font-sans bg-gray-50 focus:outline-none focus:border-teal text-right resize-y"
          />
        </div>
      </form>
    </Modal>
  );
}
