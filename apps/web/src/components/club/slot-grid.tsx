'use client';

import React from 'react';
import type { Availability, AvailabilitySlot, SlotStatus } from '@packages/validation';
import { canSelectSlot, slotTime, type SlotSelection } from '@/lib/booking-calendar';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

const styles: Record<SlotStatus, string> = {
  FREE: 'border bg-background hover:border-primary hover:bg-primary/5',
  BOOKED: 'border border-transparent bg-muted text-muted-foreground',
  BLOCKED: 'border border-transparent bg-muted text-muted-foreground line-through',
  SOCIAL_OPEN: 'border border-success/25 bg-success/10 text-success',
  SOCIAL_FULL: 'border border-warning/25 bg-warning/10 text-warning',
  PAST: 'border border-transparent bg-muted text-muted-foreground opacity-40',
};
export function slotLabel(slot: AvailabilitySlot) {
  if (slot.status === 'FREE') return formatMoney(slot.pricePaise);
  if (slot.status === 'SOCIAL_OPEN') return `${slot.spotsLeft} of ${slot.capacity} left`;
  return { BOOKED: 'Booked', BLOCKED: 'Blocked', SOCIAL_FULL: 'Full', PAST: 'Past' }[slot.status];
}

export function SlotGrid({ data, selected, onSelect, disabled = false }: {
  data: Availability; selected: SlotSelection | null;
  onSelect: (courtId: string, slot: AvailabilitySlot) => void; disabled?: boolean;
}) {
  const starts = [...new Set(data.courts.flatMap((court) => court.slots.map((slot) => slot.startsAt)))].sort();
  const chosen = data.courts.find((court) => court.courtId === selected?.courtId)?.slots.find((slot) => slot.startsAt === selected?.startsAt);
  return <div className="overflow-x-auto rounded-lg border" role="region" aria-label="Court availability" tabIndex={0}>
    <div role="table" aria-label="Court time slots" className="grid gap-px bg-border"
      style={{ gridTemplateColumns: `80px repeat(${data.courts.length}, minmax(150px, 1fr))`, minWidth: 80 + data.courts.length * 150 }}>
      <div role="row" className="contents"><div role="columnheader" className="sticky left-0 z-10 bg-background px-3 py-4 text-xs text-muted-foreground">Time</div>
        {data.courts.map((court) => <div role="columnheader" key={court.courtId} className="bg-background px-3 py-4 text-sm font-medium">{court.name}</div>)}
      </div>
      {starts.map((start) => <div role="row" key={start} className="contents">
        <div role="rowheader" className="sticky left-0 z-10 bg-background px-2 py-4 text-xs tabular text-muted-foreground">{slotTime(start, data.timezone)}</div>
        {data.courts.map((court) => {
          const slot = court.slots.find((item) => item.startsAt === start);
          if (!slot) return <div role="cell" key={court.courtId} className="bg-background" aria-label={`${court.name}, no session at ${slotTime(start, data.timezone)}`} />;
          const active = selected?.courtId === court.courtId && selected.startsAt === start;
          const overlap = !active && chosen && selected?.courtId === court.courtId && Date.parse(start) < Date.parse(chosen.endsAt) && Date.parse(slot.endsAt) > Date.parse(chosen.startsAt);
          const label = slotLabel(slot);
          return <div role="cell" key={court.courtId} className="bg-background p-1">
            <button type="button" aria-pressed={active} aria-label={`${court.name}, ${slotTime(start, data.timezone)}, ${label}`}
              disabled={disabled || !canSelectSlot(slot) || Boolean(overlap)} title={slot.reason ?? slot.holder}
              onClick={() => onSelect(court.courtId, slot)}
              className={cn('min-h-12 w-full rounded-md px-2 py-2 text-sm tabular transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed', styles[slot.status],
                overlap && 'opacity-40', active && 'border-primary bg-primary text-primary-foreground hover:bg-primary')}>
              {label}{slot.holder && <span className="block truncate text-xs">{slot.holder}</span>}
            </button>
          </div>;
        })}
      </div>)}
    </div>
  </div>;
}
