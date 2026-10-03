import React from 'react';
import Link from 'next/link';

export function Footer() {
  return (
    <footer className="border-t bg-muted/20 py-8 text-xs text-muted-foreground">
      <div className="container flex flex-col items-center justify-between gap-4 sm:flex-row">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-foreground">CourtOS</span>
          <span>&middot;</span>
          <span>The Sports Club Operating System</span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/site/baseline-sports-club" className="transition-colors hover:text-foreground">Club site</Link>
          <Link href="/login" className="transition-colors hover:text-foreground">Sign in</Link>
          <Link href="/signup" className="transition-colors hover:text-foreground">Join</Link>
        </div>
      </div>
    </footer>
  );
}
