import React from 'react';
import Link from 'next/link';
import { ClubBrand } from '@/components/brand/club-brand';

export function Footer() {
  return (
    <footer className="border-t bg-muted/20 py-8 text-xs text-muted-foreground">
      <div className="container flex flex-col items-center justify-between gap-4 sm:flex-row">
        <div className="flex items-center gap-2">
          <ClubBrand name="Baseline" size="sm" subtitle={false} className="text-foreground" />
          <span>&middot;</span>
          <span>Software for running a sports club</span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/login" className="transition-colors hover:text-foreground">Sign in</Link>
          <Link href="/signup" className="transition-colors hover:text-foreground">Create account</Link>
        </div>
      </div>
    </footer>
  );
}
