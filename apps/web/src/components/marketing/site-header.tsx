'use client';

import React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { useAuth } from '@/hooks/use-auth';

/** Public header. Marketing links only — app navigation lives in the app shell. */
export function SiteHeader() {
  const { isAuthenticated, isLoading } = useAuth();

  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="container flex h-16 items-center gap-8">
        <Link href="/" className="font-semibold tracking-tight">
          <span>Baseline</span>
        </Link>

        <nav aria-label="Club website" className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
          <Link href="/play" className="transition-colors hover:text-foreground">Play</Link>
          <Link href="/plans" className="transition-colors hover:text-foreground">Membership</Link>
          <Link href="/shop" className="transition-colors hover:text-foreground">Shop</Link>
          <Link href="/contact" className="transition-colors hover:text-foreground">Contact</Link>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          {isLoading ? (
            <div className="h-8 w-32 animate-pulse rounded-md bg-muted" />
          ) : isAuthenticated ? (
            <Button asChild size="sm"><Link href="/dashboard">Open app</Link></Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm"><Link href="/login">Sign in</Link></Button>
              <Button asChild size="sm"><Link href="/signup">Join the club</Link></Button>
            </>
          )}
        </div>
      </div>
      <nav aria-label="Club website on mobile" className="container flex flex-wrap gap-x-5 gap-y-2 pb-3 text-sm text-muted-foreground md:hidden">
        <Link href="/play">Play</Link><Link href="/plans">Membership</Link><Link href="/shop">Shop</Link><Link href="/contact">Contact</Link>
      </nav>
    </header>
  );
}
