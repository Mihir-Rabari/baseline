'use client';

import React, { Suspense, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { CreateEnquiryRequest } from '@packages/validation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { PageError } from '@/components/club/page-error';
import { usePlans } from '@/hooks/use-plans';
import { useEnquiry } from '@/hooks/use-enquiry';
import { EnquiryFormSchema, type EnquiryFormValues } from '@/lib/enquiry-form';

function ContactForm() {
  const params = useSearchParams();
  const plans = usePlans();
  const enquiry = useEnquiry();
  const planCode = params.get('plan');
  const presetPlan = plans.data?.find((item) => item.code === planCode);
  const appliedPreset = useRef<string | null>(presetPlan ? planCode : null);
  const { register, control, handleSubmit, setValue, formState: { errors } } = useForm<EnquiryFormValues, unknown, CreateEnquiryRequest>({
    resolver: zodResolver(EnquiryFormSchema),
    defaultValues: { name: '', phone: '', email: '', message: '', interestedPlanId: plans.data?.find((item) => item.code === planCode)?.id || '' },
  });
  useEffect(() => {
    if (appliedPreset.current === planCode) return;
    const plan = plans.data?.find((item) => item.code === planCode);
    if (plan) {
      setValue('interestedPlanId', plan.id);
      appliedPreset.current = planCode;
    }
  }, [planCode, plans.data, setValue]);

  if (enquiry.isSuccess) return <p role="status">Thanks, we&apos;ll be in touch within one working day.</p>;

  return (
    <form noValidate onSubmit={handleSubmit(async (data) => {
      try { await enquiry.mutateAsync(data); }
      catch (error) { toast.error(error instanceof Error ? error.message : 'Could not send your enquiry. Please try again.'); }
    })} className="max-w-xl space-y-5">
      <fieldset disabled={enquiry.isPending} className="space-y-5">
        {(['name', 'phone', 'email'] as const).map((field) => (
          <div className="space-y-2" key={field}>
            <Label htmlFor={field}>{field === 'name' ? 'Name' : field === 'phone' ? 'Phone' : 'Email'}</Label>
            <Input id={field} type={field === 'email' ? 'email' : field === 'phone' ? 'tel' : 'text'} autoComplete={field === 'phone' ? 'tel' : field} aria-invalid={Boolean(errors[field])} aria-describedby={errors[field] ? `${field}-error` : undefined} {...register(field)} />
            {errors[field] && <p id={`${field}-error`} role="alert" className="text-sm text-destructive">{errors[field].message}</p>}
          </div>
        ))}
        <p className="text-sm text-muted-foreground">Add a phone number or an email so we can reply.</p>
        <div className="space-y-2">
          <Label htmlFor="interested-plan">Interested plan</Label>
          <Controller name="interestedPlanId" control={control} render={({ field }) => (
            <Select value={field.value || 'none'} onValueChange={(value) => field.onChange(value === 'none' ? '' : value)} disabled={plans.isPending || enquiry.isPending}>
              <SelectTrigger id="interested-plan" onBlur={field.onBlur} ref={field.ref}><SelectValue placeholder="Choose a plan" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Help me choose</SelectItem>
                {plans.data?.map((plan) => <SelectItem key={plan.id} value={plan.id}>{plan.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )} />
          {plans.isPending && <div role="status" aria-label="Loading plans"><Skeleton className="h-4 w-48" /></div>}
          {plans.error && <PageError error={plans.error} onRetry={() => { void plans.refetch(); }} />}
          {plans.data?.length === 0 && <p className="text-sm text-muted-foreground">Plans are being updated. Ask us for details below.</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="message">Message</Label>
          <textarea id="message" rows={5} className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50" aria-invalid={Boolean(errors.message)} aria-describedby={errors.message ? 'message-error' : undefined} {...register('message')} />
          {errors.message && <p id="message-error" role="alert" className="text-sm text-destructive">{errors.message.message}</p>}
        </div>
        <Button type="submit" disabled={enquiry.isPending}>{enquiry.isPending ? 'Sending enquiry…' : 'Send enquiry'}</Button>
      </fieldset>
    </form>
  );
}

export default function ContactPage() {
  return <section className="container space-y-8 py-12">
    <div className="space-y-2"><h1 className="text-2xl font-semibold tracking-tight">Contact the club</h1><p className="text-muted-foreground">Ask about membership, court play or visiting the club.</p></div>
    <Suspense fallback={<Skeleton className="h-80 max-w-xl" />}><ContactForm /></Suspense>
  </section>;
}
