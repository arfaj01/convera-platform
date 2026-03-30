'use client';

import { ButtonHTMLAttributes } from 'react';

type Variant = 'teal' | 'lime' | 'outline' | 'red' | 'green' | 'ghost';
type Size = 'sm' | 'md';

const VARIANT_STYLES: Record<Variant, string> = {
  teal:    'bg-teal text-white border-teal hover:bg-teal-dark',
  lime:    'bg-lime text-white border-lime hover:bg-lime-dark',
  outline: 'bg-white border-gray-200 text-gray-600 hover:border-teal hover:text-teal',
  red:     'bg-[#C0392B] text-white border-[#C0392B] hover:opacity-90',
  green:   'bg-[#1B7A45] text-white border-[#1B7A45] hover:opacity-90',
  ghost:   'bg-transparent border-transparent text-gray-600 hover:bg-gray-100',
};

const SIZE_STYLES: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: string;
}

export default function Button({
  variant = 'teal',
  size = 'md',
  icon,
  children,
  className = '',
  ...props
}: ButtonProps) {
  return (
    <button
      className={`
        inline-flex items-center gap-1.5 rounded-sm font-bold border-[1.5px]
        cursor-pointer transition-all duration-150
        disabled:opacity-50 disabled:cursor-not-allowed
        ${VARIANT_STYLES[variant]}
        ${SIZE_STYLES[size]}
        ${className}
      `}
      {...props}
    >
      {icon && <span>{icon}</span>}
      {children}
    </button>
  );
}
