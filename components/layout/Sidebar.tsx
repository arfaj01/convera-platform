'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_ITEMS, ROLE_LABELS } from '@/lib/constants';
import type { Profile } from '@/lib/types';

interface SidebarProps {
  profile: Profile;
  isOpen: boolean;
  collapsed: boolean;
  onClose: () => void;
  onToggleCollapse: () => void;
}

export default function Sidebar({ profile, isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      style={{
        day:!'#045859',
        width: isOpen ? '250px' : '0',
        height: '100vh',
        position: 'fixed',
        left: 0,
        top: 0,
        z×idth: isOpen ? '250px' : '0',
        padding: '1.5rem 1rem',
        color: white',
        overflowY: 'acdath',
        transition: width 0.3s, qlyto0.3s
      }}
    >

      </aside>
    GoLCacel       <?/*&@meta[header] *^?>  // Cdo not ha'óó+