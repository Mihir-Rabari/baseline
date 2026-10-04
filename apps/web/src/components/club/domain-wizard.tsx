'use client';

import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Globe } from 'lucide-react';
import { toast } from 'sonner';
import { DomainNameSchema, type DnsRecord, type TenantDomainDetail } from '@packages/validation';
import { ApiError } from '@/lib/api-client';
import { ops } from '@/lib/ops';
import { ConfirmRemoveDialog } from '@/components/club/confirm-remove-dialog';
import { Field, errorText } from '@/components/club/form-dialog';
import { PageError } from '@/components/club/page-error';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

const KEY = ['tenant', 'domains'];

export type WizardStep = 'domain' | 'dns' | 'verify' | 'live';

const STEPS: Array<{ id: WizardStep; label: string }> = [
  { id: 'domain', label: 'Domain' },
  { id: 'dns', label: 'DNS records' },
  { id: 'verify', label: 'Verify' },
  { id: 'live', label: 'Live' },
];

/**
 * Where a domain is in the wizard. A domain that has never been checked is at the DNS step; once a check has
 * run (it failed) it is at the verify step so the reason and the retry are in front of the owner.
 */
export function stepOf(domain: Pick<TenantDomainDetail, 'status' | 'lastCheckedAt'> | null): WizardStep {
  if (!domain) return 'domain';
  if (domain.status === 'VERIFIED') return 'live';
  return domain.lastCheckedAt ? 'verify' : 'dns';
}

/** A readable message for the ways adding or checking a domain can fail. */
export function domainErrorText(caught: unknown, fallback: string): string {
  if (caught instanceof ApiError) {
    if (caught.statusCode === 429) return 'Too many checks. Wait a minute, then try again.';
    if (caught.statusCode === 409) return 'That domain is already connected to a club.';
  }
  return errorText(caught, fallback);
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={`Copy ${label}`}
      onClick={() => {
        void (async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            toast.error('Could not copy. Select the text and copy it by hand.');
          }
        })();
      }}
    >
      {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
    </Button>
  );
}

function Stepper({ current }: { current: WizardStep }) {
  const index = STEPS.findIndex((s) => s.id === current);
  return (
    <ol className="flex flex-wrap gap-2 text-sm" aria-label="Domain setup steps">
      {STEPS.map((step, i) => (
        <li
          key={step.id}
          aria-current={step.id === current ? 'step' : undefined}
          className={`flex items-center gap-2 rounded-full border px-3 py-1 ${step.id === current ? 'border-primary bg-primary/10 font-medium' : i < index ? 'text-muted-foreground' : 'text-muted-foreground/70'}`}
        >
          <span className="text-xs">{i < index ? '✓' : i + 1}</span>
          {step.label}
        </li>
      ))}
    </ol>
  );
}

function RecordsTable({ records }: { records: DnsRecord[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left">
          <tr><th className="p-2">Type</th><th className="p-2">Name / host</th><th className="p-2">Value</th><th className="p-2">Why</th></tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={`${record.type}-${record.name}`} className="border-t align-top">
              <td className="p-2 font-mono">{record.type}</td>
              <td className="p-2"><span className="break-all font-mono">{record.name}</span><CopyButton value={record.name} label={`${record.type} record name`} /></td>
              <td className="p-2"><span className="break-all font-mono">{record.value}</span><CopyButton value={record.value} label={`${record.type} record value`} /></td>
              <td className="p-2 text-muted-foreground">{record.purpose === 'ownership' ? 'Proves you own the domain' : 'Sends visitors to your club site'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ domain }: { domain: TenantDomainDetail }) {
  if (domain.status === 'VERIFIED') return <Badge variant="success">Live</Badge>;
  if (domain.status === 'FAILED') return <Badge variant="error">Not verified</Badge>;
  return <Badge variant="warning">Waiting for DNS</Badge>;
}

/** Enter a domain, add the DNS records, verify, go live. */
export function DomainWizard() {
  const client = useQueryClient();
  const domains = useQuery({ queryKey: KEY, queryFn: () => ops.get<TenantDomainDetail[]>('/tenant/domains') });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<TenantDomainDetail | null>(null);

  const refresh = () => client.invalidateQueries({ queryKey: KEY });
  const add = useMutation({ mutationFn: (domain: string) => ops.post<TenantDomainDetail>('/tenant/domains', { domain }) });
  const verify = useMutation({ mutationFn: (id: string) => ops.post<TenantDomainDetail>(`/tenant/domains/${id}/verify`) });

  const custom = (domains.data ?? []).filter((d) => d.kind === 'CUSTOM');
  const platform = (domains.data ?? []).filter((d) => d.kind === 'PLATFORM');
  const selected = custom.find((d) => d.id === selectedId) ?? null;
  const step: WizardStep = adding ? 'domain' : stepOf(selected);

  async function submitDomain(event: React.FormEvent) {
    event.preventDefault();
    setActionError(null);
    const parsed = DomainNameSchema.safeParse(name);
    if (!parsed.success) return setFieldError(parsed.error.issues[0]?.message ?? 'Enter a domain such as courts.example.com');
    setFieldError(null);
    try {
      const created = await add.mutateAsync(parsed.data);
      await refresh();
      setSelectedId(created.id);
      setAdding(false);
      setName('');
    } catch (caught) {
      setActionError(domainErrorText(caught, 'Could not add the domain.'));
    }
  }

  async function check(domain: TenantDomainDetail) {
    setActionError(null);
    try {
      const result = await verify.mutateAsync(domain.id);
      await refresh();
      if (result.status === 'VERIFIED') toast.success(`${result.domain} is live`);
    } catch (caught) {
      setActionError(domainErrorText(caught, 'Could not check the domain.'));
    }
  }

  async function remove(domain: TenantDomainDetail) {
    await ops.delete(`/tenant/domains/${domain.id}`);
    if (selectedId === domain.id) setSelectedId(null);
    await refresh();
    toast.success('Domain removed');
  }

  if (domains.error) return <PageError error={domains.error as Error} onRetry={() => { void domains.refetch(); }} />;
  if (domains.isPending) return <Skeleton className="h-48" aria-label="Loading domains" />;

  return (
    <section className="space-y-5" aria-label="Domain setup">
      <div>
        <h2 className="text-lg font-semibold">Your website address</h2>
        <p className="text-sm text-muted-foreground">Use your own domain for the club website. We give you the DNS records to add, check them, and switch the domain on.</p>
      </div>

      {platform.map((d) => (
        <div key={d.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <span className="flex items-center gap-2"><Globe className="h-4 w-4" aria-hidden />{d.domain}</span>
          <Badge variant="success">Live</Badge>
        </div>
      ))}

      {custom.length > 0 && (
        <ul className="space-y-2" aria-label="Custom domains">
          {custom.map((d) => (
            <li key={d.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 ${d.id === selected?.id && !adding ? 'border-primary' : ''}`}>
              <span className="font-medium">{d.domain}</span>
              <span className="flex items-center gap-2">
                <StatusBadge domain={d} />
                <Button type="button" variant="outline" size="sm" onClick={() => { setSelectedId(d.id); setAdding(false); setActionError(null); }}>{d.status === 'VERIFIED' ? `View ${d.domain}` : `Set up ${d.domain}`}</Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setRemoving(d)}>{`Remove ${d.domain}`}</Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {custom.length === 0 && !adding && <p className="text-sm text-muted-foreground">No custom domain yet.</p>}
      {!adding && <Button type="button" variant="outline" onClick={() => { setAdding(true); setActionError(null); setFieldError(null); }}>Connect a domain</Button>}

      {(adding || selected) && (
        <div className="space-y-4 rounded-lg border p-5">
          <Stepper current={step} />
          {actionError && <Alert variant="destructive" role="alert"><AlertDescription>{actionError}</AlertDescription></Alert>}

          {step === 'domain' && (
            <form onSubmit={(event) => { void submitDomain(event); }} noValidate className="space-y-3">
              <Field id="domain-name" label="Domain" placeholder="courts.example.com" value={name} onChange={(e) => setName(e.target.value)} hint="A domain or subdomain you control. No https:// and no path." autoComplete="off" />
              {fieldError && <p role="alert" className="text-sm text-destructive">{fieldError}</p>}
              <div className="flex gap-2">
                <Button type="submit" loading={add.isPending}>{add.isPending ? 'Adding…' : 'Continue'}</Button>
                <Button type="button" variant="ghost" onClick={() => { setAdding(false); setName(''); setFieldError(null); setActionError(null); }}>Cancel</Button>
              </div>
            </form>
          )}

          {selected && !adding && step === 'dns' && (
            <div className="space-y-3">
              <p className="text-sm">Add these records at your DNS provider for <strong>{selected.domain}</strong>. DNS changes can take a while to spread.</p>
              <RecordsTable records={selected.dnsRecords} />
              <Button type="button" onClick={() => { void check(selected); }} loading={verify.isPending}>{verify.isPending ? 'Checking…' : 'I added the records, check now'}</Button>
            </div>
          )}

          {selected && !adding && step === 'verify' && (
            <div className="space-y-3">
              <Alert variant="destructive" role="alert">
                <AlertDescription>{selected.lastError ?? 'The records were not found yet.'}</AlertDescription>
              </Alert>
              <RecordsTable records={selected.dnsRecords} />
              <div className="flex items-center gap-3">
                <Button type="button" onClick={() => { void check(selected); }} loading={verify.isPending}>{verify.isPending ? 'Checking…' : 'Try again'}</Button>
                {selected.lastCheckedAt && <span className="text-xs text-muted-foreground">Last checked {new Date(selected.lastCheckedAt).toLocaleString()}</span>}
              </div>
            </div>
          )}

          {selected && !adding && step === 'live' && (
            <div className="space-y-2">
              <p className="flex items-center gap-2 font-medium"><Check className="h-4 w-4 text-success" aria-hidden />{selected.domain} is live.</p>
              <a className="text-sm underline-offset-4 hover:underline" href={`https://${selected.domain}`} target="_blank" rel="noreferrer">{`Open https://${selected.domain}`}</a>
            </div>
          )}
        </div>
      )}

      <ConfirmRemoveDialog
        open={Boolean(removing)}
        title={`Remove ${removing?.domain ?? 'domain'}?`}
        description="Visitors to this address will no longer reach your club site."
        onConfirm={async () => { if (removing) await remove(removing); }}
        onClose={() => setRemoving(null)}
      />
    </section>
  );
}
