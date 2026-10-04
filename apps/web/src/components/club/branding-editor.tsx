'use client';

import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HexColorSchema, type TenantBranding, type UpdateTenantBrandingRequest } from '@packages/validation';
import { brandingStyle } from '@/lib/branding';
import { mediaUrl } from '@/lib/upload-api';
import { ops } from '@/lib/ops';
import { errorText } from '@/components/club/form-dialog';
import { ImageUploader } from '@/components/club/image-uploader';
import { PageError } from '@/components/club/page-error';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';

const KEY = ['tenant', 'branding'];

type ColorField = 'primaryColor' | 'secondaryColor' | 'accentColor';
const COLORS: Array<{ field: ColorField; label: string; hint: string }> = [
  { field: 'primaryColor', label: 'Primary colour', hint: 'Buttons and links.' },
  { field: 'secondaryColor', label: 'Secondary colour', hint: 'Quiet surfaces and tags.' },
  { field: 'accentColor', label: 'Accent colour', hint: 'Highlights.' },
];

/** The fields that differ from what is saved; null clears a value. */
export function brandingPatch(saved: TenantBranding, draft: TenantBranding): UpdateTenantBrandingRequest {
  const patch: Record<string, string | null> = {};
  for (const key of ['logoUrl', 'primaryColor', 'secondaryColor', 'accentColor'] as const) {
    const a = (saved[key] ?? null)?.toLowerCase() ?? null;
    const b = (draft[key] ?? null)?.toLowerCase() ?? null;
    if (a !== b) patch[key] = draft[key] ?? null;
  }
  return patch as UpdateTenantBrandingRequest;
}

function BrandingFields({ saved }: { saved: TenantBranding }) {
  const client = useQueryClient();
  const [draft, setDraft] = useState<TenantBranding>(saved);
  const [typed, setTyped] = useState<Partial<Record<ColorField, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({ mutationFn: (patch: UpdateTenantBrandingRequest) => ops.put<TenantBranding>('/tenant/branding', patch) });

  const patch = brandingPatch(saved, draft);
  const dirty = Object.keys(patch).length > 0;
  const colorProblem = (field: ColorField) => {
    const value = typed[field] ?? draft[field] ?? '';
    return value === '' || HexColorSchema.safeParse(value).success ? null : 'Use a hex colour such as #1a73e8';
  };
  const hasProblem = COLORS.some((c) => colorProblem(c.field));

  function setColor(field: ColorField, value: string) {
    setTyped((t) => ({ ...t, [field]: value }));
    if (value === '') setDraft((d) => ({ ...d, [field]: null }));
    else if (HexColorSchema.safeParse(value).success) setDraft((d) => ({ ...d, [field]: value.toLowerCase() }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (hasProblem) return setError('Fix the highlighted colours first.');
    try {
      const result = await save.mutateAsync(patch);
      client.setQueryData(KEY, result);
      await client.invalidateQueries({ queryKey: ['tenant'] });
      setTyped({});
      toast.success('Branding saved');
    } catch (caught) {
      setError(errorText(caught, 'Could not save the branding.'));
    }
  }

  const preview = brandingStyle(draft) as React.CSSProperties;
  const logo = mediaUrl(draft.logoUrl);

  return (
    <form onSubmit={(event) => { void submit(event); }} noValidate className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-5">
        <ImageUploader kind="club" label="Logo" value={draft.logoUrl} onChange={(url) => setDraft((d) => ({ ...d, logoUrl: url }))} />
        {COLORS.map(({ field, label, hint }) => {
          const problem = colorProblem(field);
          const shown = typed[field] ?? draft[field] ?? '';
          return (
            <div key={field} className="space-y-1">
              <Label htmlFor={`${field}-hex`}>{label}</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label={`${label} picker`}
                  className="h-9 w-12 cursor-pointer rounded border bg-transparent p-1"
                  value={draft[field] ?? '#000000'}
                  onChange={(e) => setColor(field, e.target.value)}
                />
                <input
                  id={`${field}-hex`}
                  className="h-9 w-32 rounded-md border bg-transparent px-3 font-mono text-sm"
                  placeholder="#1a73e8"
                  value={shown}
                  aria-invalid={problem ? true : undefined}
                  aria-describedby={`${field}-hint`}
                  onChange={(e) => setColor(field, e.target.value.trim())}
                />
                {(draft[field] ?? typed[field]) && <Button type="button" variant="ghost" size="sm" onClick={() => { setTyped((t) => ({ ...t, [field]: '' })); setColor(field, ''); }}>{`Clear ${label.toLowerCase()}`}</Button>}
              </div>
              <p id={`${field}-hint`} className={`text-xs ${problem ? 'text-destructive' : 'text-muted-foreground'}`} role={problem ? 'alert' : undefined}>{problem ?? hint}</p>
            </div>
          );
        })}
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        <div className="flex gap-2">
          <Button type="submit" disabled={!dirty || hasProblem} loading={save.isPending}>{save.isPending ? 'Saving…' : 'Save branding'}</Button>
          <Button type="button" variant="ghost" disabled={!dirty || save.isPending} onClick={() => { setDraft(saved); setTyped({}); setError(null); }}>Discard changes</Button>
        </div>
      </div>

      <div aria-label="Live preview" role="group" className="space-y-3 rounded-lg border bg-background p-5" style={preview}>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Live preview</p>
        <div className="flex items-center gap-3">
          {logo ? <img src={logo} alt="Logo preview" className="h-12 w-12 rounded-lg border object-cover" /> : <div className="flex h-12 w-12 items-center justify-center rounded-lg border bg-muted text-xs text-muted-foreground">Logo</div>}
          <span className="text-lg font-semibold">Your club</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground" data-testid="preview-primary">Book a court</span>
          <span className="rounded-md bg-secondary px-3 py-1.5 text-sm text-secondary-foreground" data-testid="preview-secondary">View plans</span>
          <span className="rounded-md bg-accent px-3 py-1.5 text-sm text-accent-foreground" data-testid="preview-accent">New</span>
          <Badge>Member</Badge>
        </div>
      </div>
    </form>
  );
}

/** Logo and colour palette with a live preview of how the club site will look. */
export function BrandingEditor() {
  const branding = useQuery({ queryKey: KEY, queryFn: () => ops.get<TenantBranding>('/tenant/branding') });
  if (branding.error) return <PageError error={branding.error as Error} onRetry={() => { void branding.refetch(); }} />;
  if (branding.isPending) return <Skeleton className="h-48" aria-label="Loading branding" />;
  const saved = branding.data;
  return (
    <section className="space-y-4" aria-label="Branding">
      <div>
        <h2 className="text-lg font-semibold">Logo and colours</h2>
        <p className="text-sm text-muted-foreground">Shown on your club website. Check the preview before saving.</p>
      </div>
      <BrandingFields key={JSON.stringify(saved)} saved={saved} />
    </section>
  );
}
