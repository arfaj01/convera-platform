'use client';

import { useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { friendlyError } from '@/lib/errors';
import PageHeader from '@/components/ui/PageHeader';
import Card, { CardHeader, CardBody } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { updateProfile } from '@/services/users';
import { ROLE_LABELS } from '@/lib/constants';

export default function SettingsPage() {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [saving, setSaving] = useState(false);
  const [phone, setPhone] = useState(profile?.phone || '');
  const [org, setOrg] = useState(profile?.organization || '');

  if (!profile) return null;

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateProfile(profile.id, {
        phone: phone || null,
        organization: org || null,
      });
      showToast('تم حفظ التغييرات', 'ok');
    } catch (e) {
      showToast(friendlyError(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader title="الإعدادات" subtitle="إدارة الملف الشخصي" />

      <div className="max-w-2xl">
        <Card>
          <CardHeader title="الملف الشخصي" />
          <CardBody>
            <div className="flex items-center gap-4 mb-6 pb-6 border-b border-gray-100">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold text-white"
                style={{ background: '#026D69' }}
              >
                {(profile.full_name_ar || profile.full_name || '').charAt(0)}
              </div>
              <div>
                <div className="text-base font-bold text-teal-dark">
                  {profile.full_name_ar || profile.full_name}
                </div>
                <div className="text-xs text-gray-400">
                  {ROLE_LABELS[profile.role] || profile.role}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">البريد الإلكتروني</label>
                <input
                  type="email"
                  value={profile.email}
                  readOnly
                  className="w-full px-2.5 py-2 border-[1.5px] border-gray-100 rounded-sm text-sm font-sans bg-gray-50 text-gray-400 text-right"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">الاسم</label>
                <input
                  type="text"
                  value={profile.full_name_ar || profile.full_name || ''}
                  readOnly
                  className="w-full px-2.5 py-2 border-[1.5px] border-gray-100 rounded-sm text-sm font-sans bg-gray-50 text-gray-400 text-right"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">الجوال</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="05xxxxxxxx"
                  className="w-full px-2.5 py-2 border-[1.5px] border-gray-100 rounded-sm text-sm font-sans bg-gray-50 text-right focus:border-teal focus:bg-white focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">الجهة</label>
                <input
                  type="text"
                  value={org}
                  onChange={e => setOrg(e.target.value)}
                  placeholder="اسم الجهة"
                  className="w-full px-2.5 py-2 border-[1.5px] border-gray-100 rounded-sm text-sm font-sans bg-gray-50 text-right focus:border-teal focus:bg-white focus:outline-none"
                />
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-gray-100">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? '⏳ جاري الحفظ...' : '💾 حفظ التغييرات'}
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
