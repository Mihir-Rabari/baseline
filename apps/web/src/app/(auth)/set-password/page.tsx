'use client';

import React, { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { PageSpinner } from '@/components/ui/spinner';
import { MIN_PASSWORD_LENGTH, passwordLinks, passwordProblem } from '@/lib/password-links';

function SetPasswordForm() {
  const token = useSearchParams().get('token') ?? '';
  const check = useQuery({ queryKey: ['password-link', token], queryFn: () => passwordLinks.check(token), enabled: token.length >= 20, retry: false });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const problem = passwordProblem(password, confirm);
    if (problem) return setError(problem);
    setSaving(true);
    try { await passwordLinks.set(token, password); setDone(true); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'We could not set your password. Please try again.'); }
    finally { setSaving(false); }
  }

  if (token.length < 20 || check.data?.valid === false || check.error) {
    return (
      <Card className="w-full max-w-sm animate-rise">
        <CardHeader><CardTitle>This link has expired</CardTitle><CardDescription>Password links work once and stop after a few hours. Ask for a new one and we will email it.</CardDescription></CardHeader>
        <CardFooter><Link href="/forgot-password" className={buttonVariants()}>Email me a new link</Link></CardFooter>
      </Card>
    );
  }
  if (check.isPending) return <PageSpinner label="Checking your link" />;
  if (done) {
    return (
      <Card className="w-full max-w-sm animate-rise">
        <CardHeader><CardTitle>Your password is set</CardTitle><CardDescription>You can sign in with your email and the new password.</CardDescription></CardHeader>
        <CardFooter><Link href="/login" className={buttonVariants()}>Sign in</Link></CardFooter>
      </Card>
    );
  }
  return (
    <Card className="w-full max-w-sm animate-rise">
      <form onSubmit={(event) => { void submit(event); }} noValidate>
        <CardHeader><CardTitle>Choose a password</CardTitle><CardDescription>At least {MIN_PASSWORD_LENGTH} characters. You will use it with your email to sign in.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
          <div className="space-y-2"><Label htmlFor="new-password">New password</Label><PasswordInput id="new-password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="confirm-password">Confirm password</Label><PasswordInput id="confirm-password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
        </CardContent>
        <CardFooter><Button type="submit" loading={saving} className="w-full">{saving ? 'Saving…' : 'Set password'}</Button></CardFooter>
      </form>
    </Card>
  );
}

export default function SetPasswordPage() {
  return <Suspense fallback={<PageSpinner label="Loading" />}><SetPasswordForm /></Suspense>;
}
