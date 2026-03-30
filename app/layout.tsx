import type { Metadata } from 'next';
import { Tajawal } from 'next/font/google';
import AuthProvider from '@/components/AuthProvider';
import { ToastProvider } from '@/components/ui/Toast';
import './globals.css';

// Tajawal is the web-safe Arabic fallback when MasmakBHD is not yet loaded
const tajawal = Tajawal({
  subsets: ['arabic', 'latin'],
  weight: ['400', '500', '700', '800', '900'],
  variable: '--font-tajawal',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'CONVERA | وزارة البلديات والإسكان',
  description: 'نظام إدارة المطالبات المالية — إدارة التطوير والتأهيل',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl" className={tajawal.variable}>
      <body className="min-h-screen">
        <AuthProvider>
          <ToastProvider>
            {children}
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
