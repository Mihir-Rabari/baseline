import React from 'react';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

export default function ClubNotFound() {
  return (
    <main className="container flex min-h-screen flex-col items-start justify-center gap-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">We could not find that club</h1>
      <p className="max-w-md text-muted-foreground">The address may be misspelled, or the club is not available right now. Check the link you were given and try again.</p>
      <Link href="/" className={buttonVariants({ variant: 'outline' })}>Back to home</Link>
    </main>
  );
}
