'use client';

import React, { useId, useState } from 'react';
import type { MemberLookupItem } from '@packages/validation';
import { useDebounce } from '@/hooks/use-debounce';
import { useMemberLookup } from '@/hooks/use-availability';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PageError } from './page-error';

export function MemberSearch({ value, onChange, disabled }: {
  value: MemberLookupItem | null; onChange: (member: MemberLookupItem | null) => void; disabled?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const q = useDebounce(text.trim(), 250);
  const result = useMemberLookup(q, !value && !disabled);
  return <div className="space-y-2"><Label htmlFor={id}>Member</Label>
    {value ? <div className="flex items-center justify-between gap-3 rounded-md border p-3">
      <div><p className="text-sm font-medium">{value.fullName}</p><p className="text-xs text-muted-foreground">{value.memberCode} · {value.planCode ?? 'No active plan'}</p></div>
      <Button variant="ghost" disabled={disabled} onClick={() => { setText(''); onChange(null); }}>Change member</Button>
    </div> : <>
      <Input id={id} value={text} disabled={disabled} autoComplete="off" placeholder="Name, phone or member code"
        onChange={(event) => setText(event.target.value)} aria-describedby={`${id}-help`} />
      <p id={`${id}-help`} className="text-xs text-muted-foreground">Enter at least 2 characters to find a member.</p>
      {q.length >= 2 && !disabled && (result.error ? <PageError error={result.error} onRetry={() => { void result.refetch(); }} />
        : result.isPending ? <Skeleton className="h-12 w-full" />
        : result.data?.length === 0 ? <p role="status" className="text-sm text-muted-foreground">No members match.</p>
        : <ul aria-label="Matching members" className="divide-y rounded-md border">{result.data?.map((member) => <li key={member.id}>
          <button type="button" className="w-full p-3 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onChange(member)}>{member.fullName}<span className="ml-2 text-xs text-muted-foreground">{member.memberCode} · {member.planCode ?? 'No active plan'}</span></button>
        </li>)}</ul>)}
    </>}
  </div>;
}
