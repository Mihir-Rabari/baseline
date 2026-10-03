import React from 'react';
import { SiteHeader } from '@/components/marketing/site-header';
import { Footer } from '@/components/footer';

/** Public, signed-out-first pages. */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
