import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Nav } from '@/components/Nav';
import { repo } from '@/lib/server';
import { SEED_AS_OF } from '@/lib/seed';
import { formatDate } from '@/lib/time';

export const metadata: Metadata = { title: 'CSR Partnership Radar', description: 'Weekly CSR intelligence for corporate partnerships' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const demo = repo().demo;
  return (
    <html lang="en">
      <body>
        {demo && (
          <div className="proto-banner" role="note">
            Demo mode: no database is connected. Showing real headlines seeded as of {formatDate(SEED_AS_OF)}. Changes are not saved.
          </div>
        )}
        <header className="top">
          <span className="brand"><i className="logo" aria-hidden="true" />CSR Partnership Radar</span>
          <Nav />
        </header>
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
