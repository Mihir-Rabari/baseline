import React from 'react';
import Link from 'next/link';

/**
 * Sign-in and sign-up.
 *
 * Deliberately bare: no navigation, nothing to click but the form and the way
 * back. Every element competing with the form costs completions.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 items-center px-6">
        <Link href="/" className="font-semibold tracking-tight">
          <span>Baseline</span>
        </Link>
      </header>

      <main className="flex flex-1 items-center justify-center px-6 pb-20">{children}</main>
    </div>
  );
}
