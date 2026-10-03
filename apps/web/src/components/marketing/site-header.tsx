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

        <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
          <a href="#stack" className="transition-colors hover:text-foreground">
            Stack
          </a>
          <a href="#status" className="transition-colors hover:text-foreground">
            Status
          </a>
          <a href="#start" className="transition-colors hover:text-foreground">
            Get started
          </a>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          {isLoading ? (
            <div className="h-8 w-32 animate-pulse rounded-md bg-muted" />
          ) : isAuthenticated ? (
            <Link href="/dashboard">
              <Button size="sm">Open app</Button>
            </Link>
          ) : (
            <>
              <Link href="/login">
                <Button variant="ghost" size="sm">
                  Sign in
                </Button>
              </Link>
              <Link href="/signup">
                <Button size="sm">Get started</Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
