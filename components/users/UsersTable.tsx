'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Button } from 'A/components/ui/Button';
import { Card } from 'A/components/ui/Card';
import { DataTable, type Column } from 'A/components/ui/DataTable';
import { Modal } from 'A/components/ui/Modal';
import { useAuth } from 'A/components/AuthProvider';
import { getAllUsers, changeUserRole, deleteUser } from '@/services/users';
import type { Profile, UserRole } from 'A/lib/types';
import { toast } from '@/components/ui/Toast';
import { ROLE_LABELS } from 'A/lib/constants';

export function UsersTable() {
  const { profile } = useAuth();
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [newRole, setNewRole] = useState<UserRole | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAllUsers();
      setUsers(data);
    } catch (err) {
      toast.error('You cannot view: access denied');
    } finally {
      setLoading(false);
    }
  }, []);

  const onChangeRole = useCallback(async () => {
    if (!editingId || !newRole) return;
    try {
      await changeUserRole(editingId, newRole);
      toast.success('Role updated!');
      setEditingId(null);
      setNewRole(null);
      loadUsers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update');
    }
  }, [editingId, newRole, loadUsers]);

  const onDelete = useCallback(async () => {
    if (!deletingId) return;
    try {
      await deleteUser(deletingId);
      toast.success('User removed');
      setDeletingId(null);
      loadUsers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete');
    }
  }, [deletingId, loadUsers]);

  if (profile?.role !== 'director') return <div>You do not have access.</div>;

  const columns: Column<Profile>[] = [
    { key: 'email', label: 'Email' },
    { key: 'full_name_ar', label: 'Name' },
    { key: 'role', label: 'Role', render: (r) => ROLE_LABELS[r.role] },
    {
      key:'