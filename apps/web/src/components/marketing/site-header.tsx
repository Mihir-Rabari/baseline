'use client';

import React from 'react';
import Link from 'next/link';
import { ClubBrand } from '@/components/brand/club-brand';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { useAuth } from '@/hooks/use-auth';

/** Public header. Marketing links only — app navigation lives in the app shell. */
export function SiteHeader() {
  const { isAuthenticated, isLoading } = useAuth();

  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="container flex h-16 items-center gap-8">
        <Link href="/" aria-label="Home" className="flex items-center"><ClubBrand name="Baseline" subtitle={false} /></Link>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          {isLoading ? (
            <div className="h-8 w-32 animate-pulse rounded-md bg-muted" />
          ) : isAuthenticated ? (
            <Button asChild size="sm"><Link href="/dashboard">Open app</Link></Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm"><Link href="/login">Sign in</Link></Button>
              <Button asChild size="sm"><Link href="/signup">Create account</Link></Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
