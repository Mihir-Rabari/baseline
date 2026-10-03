'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { passwordLinks } from '@/lib/password-links';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Enter the email address you signed up with.');
    setSending(true);
    try { await passwordLinks.forgot(email.trim()); setSent(true); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'We could not send the email. Please try again.'); }
    finally { setSending(false); }
  }

  if (sent) {
    return (
      <Card className="w-full max-w-sm animate-rise">
        <CardHeader><CardTitle>Check your email</CardTitle><CardDescription>If {email.trim()} has an account, a link to choose a new password is on its way. It works once and expires in an hour.</CardDescription></CardHeader>
        <CardFooter><Link href="/login" className="text-sm underline underline-offset-4">Back to sign in</Link></CardFooter>
      </Card>
    );
  }
  return (
    <Card className="w-full max-w-sm animate-rise">
      <form onSubmit={(event) => { void submit(event); }} noValidate>
        <CardHeader><CardTitle>Forgot your password?</CardTitle><CardDescription>Enter your email and we will send you a link to choose a new one.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
          <div className="space-y-2"><Label htmlFor="forgot-email">Email</Label><Input id="forgot-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        </CardContent>
        <CardFooter className="flex flex-col items-stretch gap-3">
          <Button type="submit" loading={sending}>{sending ? 'Sending…' : 'Send reset link'}</Button>
          <Link href="/login" className="text-center text-sm text-muted-foreground underline underline-offset-4">Back to sign in</Link>
        </CardFooter>
      </form>
    </Card>
  );
}
