'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { CreateMemberRequest } from '@packages/validation';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';
import { useCreateMember } from '@/hooks/use-create-member';
import { memberFormSchema, clubToday, type MemberFormValues } from '@/lib/member-form';
import { PlanPicker } from '@/components/club/plan-picker';
import { PageError } from '@/components/club/page-error';
import { PageHeader } from '@/components/app-shell/page-header';
import { EmptyState } from '@/components/app-shell/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function NewMemberPage() {
  const { user, hasPermission } = useAuth();
  const router = useRouter();
  const plans = useQuery({ queryKey: ['plans'], queryFn: api.plans.list, staleTime: 60000 });
  const create = useCreateMember();
  const { register, control, handleSubmit, formState: { errors } } = useForm<MemberFormValues, unknown, CreateMemberRequest>({
    resolver: zodResolver(memberFormSchema(plans.data || [])),
    defaultValues: { fullName: '', phone: '', email: '', dateOfBirth: '', planId: '', paymentMethod: 'CASH' },
  });
  if (!user) return null;
  return <div className="space-y-6">
    <PageHeader title="New member" description="Register a member and collect their membership payment." />
    {!(hasPermission('members:create') && hasPermission('memberships:create')) ? <EmptyState title="Registration is unavailable" description="Ask the front desk to register this member." /> : <>
      {plans.isPending ? <Skeleton className="h-80" /> : plans.error ? <PageError error={plans.error} onRetry={() => { void plans.refetch(); }} /> : !plans.data?.some((plan) => plan.isActive) ? <EmptyState title="No membership plans available" description="Ask the owner to add a plan before registering members." /> :
        <form noValidate className="max-w-2xl space-y-5" onSubmit={handleSubmit(async (data) => {
          try { const result = await create.mutateAsync(data); toast.success(`Member ${result.member.memberCode} registered`); router.push(`/members/${result.member.id}`); }
          catch (error) { toast.error(error instanceof Error ? error.message : 'Could not register this member. Please try again.'); }
        })}>
          <fieldset disabled={create.isPending} className="space-y-5">
            {(['fullName', 'phone', 'email', 'dateOfBirth'] as const).map((field) => <div className="space-y-2" key={field}>
              <Label htmlFor={field}>{({ fullName: 'Name', phone: 'Phone', email: 'Email', dateOfBirth: 'Date of birth' })[field]}</Label>
              <Input id={field} placeholder={({ fullName: 'Member full name', phone: '98765 43210', email: 'member@example.com (optional)', dateOfBirth: '' })[field]} aria-required={field === 'fullName' || field === 'phone'} type={field === 'dateOfBirth' ? 'date' : field === 'email' ? 'email' : field === 'phone' ? 'tel' : 'text'} max={field === 'dateOfBirth' ? clubToday() : undefined} autoComplete={field === 'fullName' ? 'name' : field === 'dateOfBirth' ? 'bday' : field === 'phone' ? 'tel' : 'email'} aria-invalid={Boolean(errors[field])} aria-describedby={errors[field] ? `${field}-error` : undefined} {...register(field)} />
              {errors[field] && <p id={`${field}-error`} role="alert" className="text-sm text-destructive">{errors[field].message}</p>}
            </div>)}
            <div className="space-y-2"><p className="text-sm font-medium">Membership plan</p><Controller name="planId" control={control} render={({ field }) => <PlanPicker plans={plans.data || []} value={field.value} onChange={field.onChange} disabled={create.isPending} />} />{errors.planId && <p role="alert" className="text-sm text-destructive">{errors.planId.message}</p>}</div>
            <div className="space-y-2"><Label htmlFor="payment-method">Payment method</Label><Controller name="paymentMethod" control={control} render={({ field }) => <Select value={field.value} onValueChange={field.onChange} disabled={create.isPending}><SelectTrigger id="payment-method" onBlur={field.onBlur} ref={field.ref}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="CASH">Cash</SelectItem><SelectItem value="CARD">Card</SelectItem><SelectItem value="UPI">UPI</SelectItem></SelectContent></Select>} /></div>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Registering member…' : 'Register member'}</Button>
          </fieldset>
        </form>}
    </>}
  </div>;
}
