'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';
import type { CourtType } from '@packages/validation';
import { useOpsMutation } from '@/hooks/use-ops';
import { Money } from '@/components/club/money';
import { Field, FormDialog, errorText, fromPaise, toPaise } from '@/components/club/form-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const KEYS = ['courts', 'availability'];
const codeFromName = (name: string) =>
  name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^[^A-Z]+|_+$/g, '').slice(0, 32);

function SportDialog({ sport, open, onClose }: { sport: CourtType | null; open: boolean; onClose: () => void }) {
  const [name, setName] = useState(sport?.name ?? '');
  const [code, setCode] = useState(sport?.code ?? '');
  const [codeTouched, setCodeTouched] = useState(false);
  const [rate, setRate] = useState(sport ? fromPaise(sport.baseRatePaise) : '');
  const [social, setSocial] = useState(sport ? fromPaise(sport.socialFeePaise) : '0');
  const [trial, setTrial] = useState(sport ? fromPaise(sport.trialFeePaise) : '0');
  const [capacity, setCapacity] = useState(String(sport?.socialCapacity ?? 8));
  const [error, setError] = useState<string | null>(null);
  const create = useOpsMutation<CourtType, object>('post', KEYS, () => '/court-types');
  const update = useOpsMutation<CourtType, { id: string; [key: string]: unknown }>('put', KEYS, (v) => `/court-types/${v.id}`);
  async function submit() {
    setError(null);
    const baseRatePaise = toPaise(rate);
    const socialFeePaise = toPaise(social);
    const trialFeePaise = toPaise(trial);
    const socialCapacity = Number(capacity);
    if (!name.trim()) return setError('Enter the sport name.');
    if (!sport && !/^[A-Z][A-Z0-9_]{1,31}$/.test(code)) return setError('The code needs 2 to 32 capital letters, digits or underscores, starting with a letter.');
    if (!Number.isFinite(baseRatePaise) || baseRatePaise <= 0) return setError('Enter an hourly rate above zero, in rupees.');
    if (!Number.isFinite(socialFeePaise) || socialFeePaise < 0) return setError('Enter the social play fee in rupees (0 for none).');
    if (!Number.isFinite(trialFeePaise) || trialFeePaise < 0) return setError('Enter the trial fee in rupees (0 for none).');
    if (!Number.isInteger(socialCapacity) || socialCapacity < 0 || socialCapacity > 200) return setError('Social capacity must be a whole number from 0 to 200.');
    try {
      const body = { name: name.trim(), baseRatePaise, socialFeePaise, trialFeePaise, socialCapacity };
      if (sport) await update.mutateAsync({ id: sport.id, ...body });
      else await create.mutateAsync({ code, ...body });
      toast.success(sport ? `${name.trim()} updated` : `${name.trim()} added`);
      onClose();
    } catch (caught) { setError(errorText(caught, 'Could not save the sport.')); }
  }
  return (
    <FormDialog open={open} onClose={onClose} title={sport ? `Edit ${sport.name}` : 'New sport'} description="Courts are priced by sport. Add a sport here, then assign courts to it." onSubmit={submit} submitLabel={sport ? 'Save changes' : 'Add sport'} pending={create.isPending || update.isPending} error={error}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="sport-name" label="Name" value={name} maxLength={64} autoComplete="off" onChange={(e) => { setName(e.target.value); if (!sport && !codeTouched) setCode(codeFromName(e.target.value)); }} />
        <Field id="sport-code" label="Code" value={code} maxLength={32} disabled={Boolean(sport)} autoComplete="off" onChange={(e) => { setCodeTouched(true); setCode(e.target.value.toUpperCase()); }} hint={sport ? 'Fixed once created.' : 'Capital letters, digits and underscores.'} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="sport-rate" label="Hourly rate (₹)" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
        <Field id="sport-social" label="Social fee (₹)" inputMode="decimal" value={social} onChange={(e) => setSocial(e.target.value)} hint="Per head." />
        <Field id="sport-trial" label="Trial fee (₹)" inputMode="decimal" value={trial} onChange={(e) => setTrial(e.target.value)} />
      </div>
      <Field id="sport-capacity" label="Social capacity" inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value)} hint="Players per court at social play." />
    </FormDialog>
  );
}

/** The sports courts can be assigned to: add, edit prices, switch off. Owner only (courts:update). */
export function SportsManager({ sports }: { sports: CourtType[] }) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CourtType | null>(null);
  const toggle = useOpsMutation<CourtType, { id: string; isActive: boolean }>('put', KEYS, (v) => `/court-types/${v.id}`);
  return (
    <section className="space-y-4" aria-label="Sports">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Sports</h2>
          <p className="text-sm text-muted-foreground">Each court belongs to a sport, which sets its price. A sport with active courts cannot be switched off.</p>
        </div>
        <Button variant="outline" onClick={() => setCreating(true)}>New sport</Button>
      </div>
      <Table>
        <TableHeader><TableRow><TableHead>Sport</TableHead><TableHead>Code</TableHead><TableHead className="text-right">Hourly rate</TableHead><TableHead className="text-right">Social fee</TableHead><TableHead>Active</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
        <TableBody>
          {sports.map((sport) => (
            <TableRow key={sport.id}>
              <TableCell className="font-medium">{sport.name}{!sport.isActive && <Badge variant="outline" className="ml-2">Off</Badge>}</TableCell>
              <TableCell className="font-mono text-xs">{sport.code}</TableCell>
              <TableCell className="text-right"><Money paise={sport.baseRatePaise} /></TableCell>
              <TableCell className="text-right"><Money paise={sport.socialFeePaise ?? 0} /></TableCell>
              <TableCell><Switch checked={sport.isActive} aria-label={`${sport.name} sport active`} disabled={toggle.isPending} onCheckedChange={(isActive) => { void toggle.mutateAsync({ id: sport.id, isActive }).then(() => toast.success(`${sport.name} ${isActive ? 'switched on' : 'switched off'}`)).catch((e: Error) => toast.error(e.message)); }} /></TableCell>
              <TableCell className="text-right"><Button size="sm" variant="outline" aria-label={`Edit sport ${sport.name}`} onClick={() => setEditing(sport)}>Edit</Button></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <SportDialog key={`n-${creating}`} sport={null} open={creating} onClose={() => setCreating(false)} />
      <SportDialog key={`e-${editing?.id ?? 'none'}`} sport={editing} open={Boolean(editing)} onClose={() => setEditing(null)} />
    </section>
  );
}
