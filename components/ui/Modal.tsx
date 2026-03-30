'use client';

import { useEffect, useRef } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export default function Modal({ open, onClose, title, children, footer }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 bg-black/[.38] z-[500] flex items-center justify-center backdrop-blur-sm"
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="bg-white rounded w-[90%] max-w-[530px] max-h-[90vh] overflow-y-auto shadow-cardHover">
        <div className="px-5 py-[15px] border-b border-gray-100 flex justify-between items-center">
          <h3 className="text-base font-bold text-teal-dark">{title}</h3>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-sm bg-gray-100 border-none cursor-pointer text-sm flex items-center justify-center hover:bg-gray-200"
          >
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
        {footer && (
          <div className="px-5 py-[13px] border-t border-gray-100 flex gap-2 justify-end">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
