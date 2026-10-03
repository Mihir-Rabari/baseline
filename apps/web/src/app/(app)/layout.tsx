'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Sidebar } from '@/components/app-shell/sidebar';
import { Topbar } from '@/components/app-shell/topbar';
import { cn } from '@/lib/utils';

/**
 * Shell for every signed-in screen: fixed sidebar, sticky header, one content
 * column.
 *
 * The signed-out check lives here rather than in each page, so a new screen
 * cannot forget it. Pages below this render their content only — no navigation,
 * no auth branching, no container of their own.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="flex min-h-screen">
        <div className="hidden w-64 shrink-0 border-r p-4 lg:block">
          <Skeleton className="h-8 w-32" />
        </div>
        <div className="flex-1 space-y-6 p-6">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-64 rounded-lg" />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-md space-y-4 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in to continue</h1>
          <p className="text-sm text-muted-foreground">
            This area is only available to signed-in accounts.
          </p>
          <div className="flex justify-center gap-2">
            <Link href="/login">
              <Button>Sign in</Button>
            </Link>
            <Link href="/">
              <Button variant="outline">Back to home</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 max-h-screen w-64 shrink-0 overflow-y-auto border-r bg-background p-4 transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0',
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <Link href="/" className="mb-6 flex h-8 items-center px-3 font-semibold tracking-tight">
          <span>Baseline</span>
        </Link>
        <Sidebar onNavigate={() => setMobileNavOpen(false)} />
      </aside>

      {mobileNavOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-40 bg-foreground/20 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          mobileNavOpen={mobileNavOpen}
          onToggleMobileNav={() => setMobileNavOpen((open) => !open)}
        />
        <main className="flex-1 px-4 py-8 lg:px-8">
          <div className="mx-auto w-full max-w-5xl space-y-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
