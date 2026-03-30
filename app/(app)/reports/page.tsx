'use client';

/**
 * CONVERA — Reports Hub
 * /reports
 *
 * Central landing for all 5 report modules.
 * Accessible to: Director + Reviewer
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import PageHeader from '@/components/ui/PageHeader';

interface ReportCard {
  title: string;
  description: string;
  href: string;
  icon: string;
  tags: string[];
  accent: string;
  bg: string;
}

const REPORTS: ReportCard[] = [
  {
    title: 'تقرير المطالبات المالية',
    description: 'عرض شامل لجميع المطالبات: الإجمالي، الاستقطاع، الضريبة، الصافي، الحالة، وإجماليات كل مرحلة.',
    href: '/reports/financial-claims',
    icon: '💰',
    tags: ['مُعتمدة', 'قيد المراجعة', 'مُرجَّعة', 'التدفق المالي'],
    accent: '#045859',
    bg: '#E8F4F4',
  },
  {
    title: 'تقرير العقود',
    description: 'ملخص عقود المحفظة: القيمة الإجمالية، المصروف، المتبقي، ونسبة الاستهلاك من السقف التعاقدي.',
    href: '/reports/contracts',
    icon: '📋',
    tags: ['السقف المالي', 'الاستهلاك', 'نشط / مكتمل'],
    accent: '#502C7C',
    bg: '#F3E5FF',
  },
  {
    title: 'تقرير أوامر التغيير',
    description: 'متابعة جميع أوامر التغيير: التراكمي، نسبة الحد الأقصى (10%)، والحالة لكل عقد.',
    href: '/reports/change-orders',
    icon: '🔄',
    tags: ['حد 10%', 'مُعتمدة', 'قيد المراجعة', 'تراكمي'],
    accent: '#C05728',
    bg: '#FAEEE8',
  },
  {
    title: 'تقرير التأخير والزمن',
    description: 'المطالبات المتوقفة حسب المرحلة، عدد الأيام، وخروقات SLA جهة الإشراف.',
    href: '/reports/delay-time',
    icon: '⏱',
    tags: ['SLA', 'تجاوز المدة', 'المرحلة الحالية', 'تصعيد'],
    accent: '#FFC845',
    bg: '#FFF8E0',
  },
  {
    title: 'تقرير المرفقات والمستندات',
    description: 'فحص مستندات المطالبات: الفاتورة، التقرير التقني، شهادة الإنجاز، واستمارة المراجعة.',
    href: '/reports/documents',
    icon: '📎',
    tags: ['ناقص وثائق', 'مكتمل', 'استمارة المراجعة'],
    accent: '#00A79D',
    bg: '#E0F4F3',
  },
];

export default function ReportsHubPage() {
  const { profile, loading: authLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && profile && !['director', 'reviewer'].includes(profile.role)) {
      router.replace('/dashboard');
    }
  }, [authLoading, profile, router]);

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <p className="text-sm text-gray-400 animate-pulse">جاري التحميل...</p>
      </div>
    );
  }
  if (!profile) return null;

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title="التقارير"
        subtitle="تقارير تحليلية ومتابعة لجميع العقود والمطالبات وأوامر التغيير"
      />

      {/* Summary note */}
      <div
        className="flex items-start gap-3 p-4 rounded-lg border text-sm"
        style={{ background: '#E8F4F4', borderColor: '#04585940' }}
      >
        <span className="text-xl">📊</span>
        <div>
          <p className="font-bold text-[#045859]">مركز التقارير التنفيذية</p>
          <p className="text-gray-600 mt-0.5 text-xs leading-relaxed">
            جميع التقارير تُحسب استناداً إلى الأساس المالي المعتمد (الإجمالي − الاستقطاع + الضريبة). يمكن تصفية كل تقرير وتصديره بصيغة CSV أو طباعته مباشرة.
          </p>
        </div>
      </div>

      {/* Report cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {REPORTS.map(r => (
          <Link
            key={r.href}
            href={r.href}
            className="block rounded-xl border bg-white p-5 hover:shadow-md transition-all group no-underline"
            style={{ borderColor: `${r.accent}25` }}
          >
            {/* Header */}
            <div className="flex items-start gap-3 mb-3">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center text-xl flex-shrink-0"
                style={{ background: r.bg }}
              >
                {r.icon}
              </div>
              <div className="flex-1 min-w-0">
                <h3
                  className="font-black text-sm leading-snug group-hover:underline"
                  style={{ color: r.accent }}
                >
                  {r.title}
                </h3>
              </div>
              <span className="text-gray-300 group-hover:text-gray-500 transition-colors text-lg">←</span>
            </div>

            {/* Description */}
            <p className="text-xs text-gray-500 leading-relaxed mb-3">{r.description}</p>

            {/* Tags */}
            <div className="flex flex-wrap gap-1">
              {r.tags.map(tag => (
                <span
                  key={tag}
                  className="inline-flex items-center px-2 py-0.5 rounded-full text-[0.65rem] font-bold"
                  style={{ background: r.bg, color: r.accent }}
                >
                  {tag}
                </span>
              ))}
            </div>
          </Link>
        ))}
      </div>

      {/* Footer note for print */}
      <p className="text-[0.65rem] text-gray-400 text-center print:hidden">
        التقارير تعكس البيانات الحية — آخر تحديث عند فتح كل تقرير
      </p>
    </div>
  );
}
