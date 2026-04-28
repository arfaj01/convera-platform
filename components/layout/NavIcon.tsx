'use client';

/**
 * NavIcon — resolves a string icon key (used in NAV_ITEMS) to a
 * lucide-react icon component.
 *
 * Falls back to rendering the string as-is when the key isn't a
 * registered lucide icon — this keeps backwards compatibility with
 * legacy emoji-based icons during the migration.
 */

import {
  LayoutDashboard,
  FileText,
  Receipt,
  GitMerge,
  BarChart3,
  Building2,
  Target,
  KeyRound,
  Upload,
  Users,
  Settings,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const REGISTRY: Record<string, LucideIcon> = {
  dashboard:     LayoutDashboard,
  contracts:     FileText,
  claims:        Receipt,
  workflow:      GitMerge,
  reports:       BarChart3,
  executive:     Building2,
  'action-center': Target,
  permissions:   KeyRound,
  import:        Upload,
  users:         Users,
  settings:      Settings,
};

export interface NavIconProps {
  name: string;
  size?: number;
  className?: string;
}

export default function NavIcon({ name, size = 16, className = '' }: NavIconProps) {
  const Icon = REGISTRY[name];
  if (!Icon) {
    // Fallback: render the raw string (legacy emoji)
    return <span className={'text-[15px] ' + className}>{name}</span>;
  }
  return <Icon size={size} strokeWidth={2} className={className} />;
}
