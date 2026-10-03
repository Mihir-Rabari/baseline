'use client';
import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { SocialWindowSchema, type SocialWindow } from '@packages/validation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clubSettingsApi } from '@/lib/club-settings-api';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { PageError } from './page-error';
import { toast } from 'sonner';
const schema = SocialWindowSchema.refine(value => value.endsTime > value.startsTime, { message: 'End time must be after start time', path: ['endsTime'] });
export function SocialWindowEditor({ window, editable }: { window: SocialWindow; editable: boolean }) {
  const client = useQueryClient(); const id = React.useId();
  const form = useForm<SocialWindow>({ resolver: zodResolver(schema), defaultValues: window });
  const save = useMutation({ mutationFn: ({ id: windowId, ...data }: SocialWindow) => clubSettingsApi.updateWindow(windowId, data), onSuccess: () => { void client.invalidateQueries({ queryKey: ['social-windows'] }); void client.invalidateQueries({ queryKey: ['availability'] }); toast.success('Social window updated'); } });
  if (!editable) return <p>{['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][window.weekday]} · {window.startsTime}–{window.endsTime} · {window.isActive ? 'Active' : 'Inactive'}</p>;
  return <form className="space-y-3 border-b py-4" onSubmit={form.handleSubmit(data => save.mutate(data))}><fieldset disabled={save.isPending} className="flex flex-wrap items-end gap-4"><div><Label htmlFor={`${id}-day`}>Weekday</Label><select id={`${id}-day`} className="block h-9 rounded-md border bg-background px-3" {...form.register('weekday', { valueAsNumber: true })}>{['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((day, i) => <option value={i} key={day}>{day}</option>)}</select></div><div><Label htmlFor={`${id}-start`}>Starts at</Label><Input id={`${id}-start`} type="time" {...form.register('startsTime')} /></div><div><Label htmlFor={`${id}-end`}>Ends at</Label><Input id={`${id}-end`} type="time" {...form.register('endsTime')} /></div><div className="flex h-9 items-center gap-2"><input type="checkbox" id={`${id}-active`} {...form.register('isActive')} /><Label htmlFor={`${id}-active`}>Active</Label></div><Button variant="outline" type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save window'}</Button></fieldset>{Object.values(form.formState.errors).map((error, i) => <p role="alert" className="text-sm text-destructive" key={i}>{error.message}</p>)}{save.error && <PageError error={save.error} />}</form>;
}
