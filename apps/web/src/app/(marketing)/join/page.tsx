'use client';

import React, { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { PageSpinner } from '@/components/ui/spinner';
import { Field } from '@/components/club/form-dialog';
import { Money } from '@/components/club/money';
import { PageError } from '@/components/club/page-error';
import { SelectBox } from '@/components/club/ops-bits';
import { useAuth } from '@/hooks/use-auth';
import { usePlans } from '@/hooks/use-plans';
import { ApiError, api } from '@/lib/api-client';
import { ops } from '@/lib/ops';
import { MIN_PASSWORD_LENGTH, passwordProblem } from '@/lib/password-links';

const PHONE = /^\+?[0-9 ()-]{7,20}$/;

function JoinForm() {
  const params = useSearchParams();
  const { signup, user } = useAuth();
  const plans = usePlans();
  const [form, setForm] = useState({ name: '', phone: '', email: '', password: '', confirm: '', planCode: params.get('plan') ?? '' });
  const [error, setError] = useState<string | null>(null);
  const [exists, setExists] = useState(false);
  const [saving, setSaving] = useState(false);
  const [joined, setJoined] = useState<{ name: string; plan: string; saved: boolean } | null>(null);
  const list = plans.data ?? [];
  const plan = list.find((p) => p.code === form.planCode) ?? list[0];
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: event.target.value });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null); setExists(false);
    if (!form.name.trim()) return setError('Enter your name.');
    if (!PHONE.test(form.phone.trim())) return setError('Enter a phone number the club can reach you on.');
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) return setError('Enter a valid email address. It is what you will sign in with.');
    const problem = passwordProblem(form.password, form.confirm);
    if (problem) return setError(problem);
    if (!plan) return setError('Choose a plan.');
    setSaving(true);
    try {
      await signup({ email: form.email.trim(), password: form.password, name: form.name.trim() });
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'USER_ALREADY_EXISTS') { setExists(true); setError('An account with this email already exists.'); }
      else setError(caught instanceof Error ? caught.message : 'We could not create your account. Please try again.');
      setSaving(false);
      return;
    }
    // The account exists now. Saving the profile and telling the club are best effort: if either fails the
    // person still has a working login and the club can follow up from the lead.
    let saved = true;
    try {
      await ops.put('/me/member', { fullName: form.name.trim(), phone: form.phone.trim() });
      await api.public.createEnquiry({ name: form.name.trim(), phone: form.phone.trim(), email: form.email.trim(), message: `Online membership request: ${plan.name} plan. Account created on the website.`, interestedPlanId: plan.id });
    } catch { saved = false; }
    setJoined({ name: form.name.trim(), plan: plan.name, saved });
    setSaving(false);
  }

  if (joined) {
    return (
      <div className="max-w-xl animate-rise space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome, {joined.name.split(' ')[0]}</h1>
        <p className="text-muted-foreground">Your account is ready and you are signed in. We have emailed you a confirmation.</p>
        <p>{joined.saved ? `The club knows you want the ${joined.plan} plan. Visit the front desk to pay and activate it, and your member prices start straight away.` : `Your login works, but we could not pass your plan choice to the club. Visit the front desk or send an enquiry and mention the ${joined.plan} plan.`}</p>
        <div className="flex flex-wrap gap-3"><Link href="/dashboard" className={buttonVariants()}>Go to your dashboard</Link><Link href="/play" className={buttonVariants({ variant: 'outline' })}>See free court times</Link></div>
      </div>
    );
  }
  if (user) {
    return (
      <div className="max-w-xl space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">You already have an account</h1>
        <p className="text-muted-foreground">You are signed in as {user.email}. To change plan, ask at the front desk or send an enquiry.</p>
        <div className="flex gap-3"><Link href="/dashboard" className={buttonVariants()}>Go to your dashboard</Link><Link href="/contact" className={buttonVariants({ variant: 'outline' })}>Send an enquiry</Link></div>
      </div>
    );
  }
  return (
    <div className="grid max-w-4xl gap-10 md:grid-cols-[minmax(0,1fr)_280px]">
      <form onSubmit={(event) => { void submit(event); }} noValidate className="animate-rise space-y-5">
        <fieldset disabled={saving} className="space-y-5">
          {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}{exists && <> <Link href="/login" className="underline underline-offset-4">Sign in</Link> or <Link href="/forgot-password" className="underline underline-offset-4">reset your password</Link>.</>}</AlertDescription></Alert>}
          <Field id="join-name" placeholder="Your full name" required label="Full name" autoComplete="name" value={form.name} onChange={set('name')} />
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="join-phone" placeholder="98765 43210" required label="Phone" type="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} />
            <Field id="join-email" placeholder="you@club.com" required label="Email" type="email" autoComplete="email" value={form.email} onChange={set('email')} hint="You sign in with this." />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="join-password">Password</Label><PasswordInput id="join-password" autoComplete="new-password" value={form.password} onChange={set('password')} /><p className="text-xs text-muted-foreground">At least {MIN_PASSWORD_LENGTH} characters.</p></div>
            <div className="space-y-2"><Label htmlFor="join-confirm">Confirm password</Label><PasswordInput id="join-confirm" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} /></div>
          </div>
          <Button type="submit" size="lg" loading={saving}>{saving ? 'Creating your account…' : 'Create account'}</Button>
          <p className="text-sm text-muted-foreground">Already a member? <Link href="/login" className="text-foreground underline underline-offset-4">Sign in</Link></p>
        </fieldset>
      </form>
      <aside className="space-y-3 md:pt-1" aria-label="Your plan">
        {plans.isPending ? <PageSpinner label="Loading plans" /> : plans.error ? <PageError error={plans.error} onRetry={() => { void plans.refetch(); }} /> : (
          <>
            <SelectBox id="join-plan" label="Plan" value={plan?.code ?? ''} onChange={(value) => setForm({ ...form, planCode: value })} options={list.map((p) => ({ value: p.code, label: p.name }))} />
            {plan && (
              <dl className="divide-y rounded-lg border px-4 text-sm">
                <div className="flex justify-between py-2.5"><dt className="text-muted-foreground">Monthly</dt><dd className="font-medium"><Money paise={plan.monthlyFeePaise} /></dd></div>
                <div className="flex justify-between py-2.5"><dt className="text-muted-foreground">Courts</dt><dd>{plan.courtDiscountPct >= 100 ? 'Included' : `${plan.courtDiscountPct}% off`}</dd></div>
                <div className="flex justify-between py-2.5"><dt className="text-muted-foreground">Shop · bar</dt><dd>{plan.shopDiscountPct}% · {plan.barDiscountPct}% off</dd></div>
                <div className="flex justify-between py-2.5"><dt className="text-muted-foreground">Book ahead</dt><dd>{plan.bookingHorizonDays} days</dd></div>
              </dl>
            )}
            <p className="text-xs text-muted-foreground">Your membership starts when you pay at the club. Until then your account lets you book courts at the standard price.</p>
          </>
        )}
      </aside>
    </div>
  );
}

export default function JoinPage() {
  return (
    <section className="container space-y-8 py-12">
      <div className="space-y-2"><h1 className="text-2xl font-semibold tracking-tight">Join the club</h1><p className="text-muted-foreground">Create your account and choose a plan. It takes a minute.</p></div>
      <Suspense fallback={<PageSpinner label="Loading" />}><JoinForm /></Suspense>
    </section>
  );
}
