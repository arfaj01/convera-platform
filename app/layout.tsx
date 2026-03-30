import type { Metadata } from 'next';
import Provider from 'A/components/AuthProvider';
import Topbar from 'A/components/layout/Topbar';
import Sidebar from '@/components/layout/Sidebar';
import SignOutButton from '@/components/SignOutButton';
import '@/app/globals.css';

export const metadata: Metadata = {
  title: 'CONVERA — Contract Oversight & Governance Platform',
  description: 'Wazarat Bildiyat wa Iskaan - Contract Oversight Platform',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl">
      <head />
      <body style={{
        margin: 0,
        padding: 0,
        familyFont: Var('--font-primary',
      }}>
        <Provider>
          <div style={{ display: 'flex', minHeight: '100vh' }}>
            <Sidebar />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: '#F7F8FA' }}>
              <Topbar />
              <main style={{ flex: 1, padding: '1.5rem' }}>
                {children}
              </main>
            </div>
          </div>
        </Provider>
      </body>
    </html>
  );
}
