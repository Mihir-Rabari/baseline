'use client';
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { UpdatePlanRequestSchema, type Plan, type UpdatePlanRequest } from '@packages/validation';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api-client';
import { clubSettingsApi } from '@/lib/club-settings-api';
import { PageHeader } from '@/components/app-shell/page-header';
import { EmptyState } from '@/components/app-shell/empty-state';
import { PageError } from '@/components/club/page-error';
import { Money } from '@/components/club/money';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Table, TableHeader, TableHead, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { SocialWindowEditor } from '@/components/club/social-window-editor';
import { BarMenuSettings } from '@/components/club/bar-menu-settings';
export default function ClubSettingsPage() {
  const { user, hasPermission } = useAuth(); const allowed = hasPermission('admin:access'); const client = useQueryClient(); const [editing, setEditing] = useState<Plan | null>(null);
  const plans = useQuery({ queryKey: ['plans'], queryFn: api.plans.list, enabled: allowed }); const windows = useQuery({ queryKey: ['social-windows'], queryFn: clubSettingsApi.windows, enabled: allowed });
  const form = useForm<UpdatePlanRequest>({ resolver: zodResolver(UpdatePlanRequestSchema) });
  const save = useMutation({ mutationFn: (data: UpdatePlanRequest) => clubSettingsApi.updatePlan(editing!.id, data), onSuccess: () => { void client.invalidateQueries({ queryKey: ['plans'] }); void client.invalidateQueries({ queryKey: ['public', 'plans'] }); setEditing(null); toast.success('Plan updated'); } });
  if (!user) return null;
  return <div className="space-y-8"><PageHeader title="Club settings" description="Membership plans, social play and menu availability." />{!allowed ? <EmptyState title="Club settings are unavailable" description="Ask the owner for access." /> : <Tabs defaultValue="plans"><TabsList><TabsTrigger value="plans">Plans</TabsTrigger><TabsTrigger value="social">Social windows</TabsTrigger><TabsTrigger value="menu">Bar menu</TabsTrigger></TabsList><TabsContent value="plans" className="space-y-4">{plans.error ? <PageError error={plans.error} onRetry={() => { void plans.refetch(); }} /> : plans.isPending ? <Skeleton className="h-48" /> : plans.data?.length === 0 ? <EmptyState title="No membership plans" /> : <Table><TableHeader><TableRow><TableHead>Plan</TableHead><TableHead>Monthly fee</TableHead><TableHead>Status</TableHead><TableHead>Action</TableHead></TableRow></TableHeader><TableBody>{plans.data?.map(plan => <TableRow key={plan.id}><TableCell>{plan.name}</TableCell><TableCell><Money paise={plan.monthlyFeePaise} /></TableCell><TableCell>{plan.isActive ? 'Active' : 'Inactive'}</TableCell><TableCell>{hasPermission('plans:update') && <Button variant="outline" onClick={() => { save.reset(); form.reset({ name: plan.name, monthlyFeePaise: plan.monthlyFeePaise, courtDiscountPct: plan.courtDiscountPct, shopDiscountPct: plan.shopDiscountPct, barDiscountPct: plan.barDiscountPct, maxBookingsPerDay: plan.maxBookingsPerDay, bookingHorizonDays: plan.bookingHorizonDays, isActive: plan.isActive }); setEditing(plan); }}>Edit {plan.name}</Button>}</TableCell></TableRow>)}</TableBody></Table>}</TabsContent><TabsContent value="social">{windows.error ? <PageError error={windows.error} onRetry={() => { void windows.refetch(); }} /> : windows.isPending ? <Skeleton className="h-40" /> : <div className="space-y-4">{windows.data?.map(window => <SocialWindowEditor key={window.id} window={window} editable={hasPermission('courts:update')} />)}{windows.data?.length === 0 && <EmptyState title="No social windows configured" />}</div>}</TabsContent><TabsContent value="menu"><BarMenuSettings /></TabsContent></Tabs>}
    <Dialog open={Boolean(editing)} onOpenChange={open => { if (!open) setEditing(null); }}><DialogContent><DialogHeader><DialogTitle>Edit {editing?.name}</DialogTitle><DialogDescription>Changes apply to future pricing and member benefits.</DialogDescription></DialogHeader>{save.error && <PageError error={save.error} />}<form className="space-y-4" onSubmit={form.handleSubmit(data => save.mutate(data))}><fieldset disabled={save.isPending} className="space-y-3"><Label htmlFor="plan-name">Name</Label><Input id="plan-name" placeholder="e.g. Gold" aria-required="true" {...form.register('name')} />{(['monthlyFeePaise', 'courtDiscountPct', 'shopDiscountPct', 'barDiscountPct', 'maxBookingsPerDay', 'bookingHorizonDays'] as const).map(field => <div key={field}><Label htmlFor={field}>{({ monthlyFeePaise: 'Monthly fee (paise)', courtDiscountPct: 'Court discount (%)', shopDiscountPct: 'Shop discount (%)', barDiscountPct: 'Bar discount (%)', maxBookingsPerDay: 'Daily booking limit', bookingHorizonDays: 'Booking horizon (days)' })[field]}</Label><Input id={field} type="number" placeholder="0" aria-required="true" {...form.register(field, { valueAsNumber: true })} />{form.formState.errors[field] && <p role="alert" className="text-sm text-destructive">{form.formState.errors[field]?.message}</p>}</div>)}{form.formState.errors.name && <p role="alert" className="text-sm text-destructive">{form.formState.errors.name.message}</p>}<div className="flex items-center gap-2"><input id="plan-active" type="checkbox" {...form.register('isActive')} /><Label htmlFor="plan-active">Active</Label></div><Button disabled={save.isPending} type="submit">{save.isPending ? 'Saving…' : 'Save plan'}</Button></fieldset></form></DialogContent></Dialog>
  </div>;
}

