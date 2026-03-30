'use client';

import { useState, useRef } from 'react';

interface InvoiceUploadProps {
  file: File | null;
  onFileSelect: (file: File | null) => void;
  hasError?: boolean;
}

export default function InvoiceUpload({ file, onFileSelect, hasError }: InvoiceUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    onFileSelect(f);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0] || null;
    if (f) onFileSelect(f);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div>
      <label className="block text-xs font-bold text-gray-600 mb-1.5">
        الفاتورة المعتمدة <span className="text-red">*</span>
        <span className="text-[0.65rem] text-gray-400 font-normal me-1">(مطلوبة للتقديم)</span>
      </label>

      {!file ? (
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`
            border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-all
            ${hasError
              ? 'border-red/40 bg-red/5'
              : dragOver
                ? 'border-teal bg-teal-ultra'
                : 'border-gray-200 bg-gray-50 hover:border-teal/40 hover:bg-teal-ultra/50'
            }
          `}
        >
          <div className="text-2xl mb-2">📎</div>
          <div className="text-[0.82rem] font-bold text-teal-dark mb-1">
            اسحب الفاتورة هنا أو اضغط للاختيار
          </div>
          <div className="text-[0.68rem] text-gray-400">
            PDF, JPG, PNG — حد أقصى 50 ميجابايت
          </div>
          {hasError && (
            <div className="text-[0.72rem] text-red font-bold mt-2">
              لا يمكن تقديم المطالبة بدون إرفاق الفاتورة المعتمدة
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-between p-3 bg-teal-ultra border border-teal/20 rounded-lg">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-lg flex-shrink-0">📄</span>
            <div className="min-w-0">
              <div className="text-[0.78rem] font-bold text-teal-dark truncate">{file.name}</div>
              <div className="text-[0.65rem] text-gray-400">{formatSize(file.size)}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => { onFileSelect(null); if (inputRef.current) inputRef.current.value = ''; }}
            className="text-red/60 hover:text-red text-sm cursor-pointer bg-transparent border-none px-2 py-1 font-sans"
          >
            حذف
          </button>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
        onChange={handleFileChange}
        className="hidden"
      />
    </div>
  );
}
