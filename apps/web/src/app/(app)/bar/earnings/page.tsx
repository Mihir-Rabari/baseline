'use client';

import React, { useState } from 'react';
import type { BarEarnings } from '@packages/validation';
import { useAuth } from '@/hooks/use-auth';
import { useOpsQuery } from '@/hooks/use-ops';
import { qs } from '@/lib/ops';
import { calendarDate, dateAfter } from '@/lib/booking-calendar';
import { formatDateTime } from '@/lib/format';
import { PageHeader } from '@/components/app-shell/page-header';
import { DateField } from '@/components/club/date-field';
import { Money } from '@/components/club/money';
import { BarList, NoAccess, QueryState, Stat, humanize } from '@/components/club/ops-bits';

export default function BarEarningsPage() {
  const { user, hasPermission } = useAuth();
  const allowed = hasPermission('bar:read');
  const owner = hasPermission('bar:manage') && hasPermission('reports:read');
  const today = calendarDate();
  const [date, setDate] = useState(today);
  const earnings = useOpsQuery<BarEarnings>(['bar', 'earnings', date], `/bar/earnings${qs({ date })}`, { enabled: allowed, refetchMs: 30000 });
  if (!user) return null;
  if (!allowed) return <NoAccess what="bar earnings" />;
  const data = earnings.data;
  return (
    <div className="space-y-6">
      <PageHeader title="Bar earnings" description={owner ? 'Settled tabs for any day. Bar staff can only see today.' : 'Settled tabs for today.'} />
      {owner && <DateField value={date} min={dateAfter(today, -90)} max={today} onChange={setDate} />}
      <QueryState query={earnings}>
        {data && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <Stat label="Total taken" value={<Money paise={data.totalPaise} />} />
              <Stat label="Tabs settled" value={data.tabsSettled} />
              <Stat label="Average tab" value={<Money paise={data.averageTabPaise} />} />
            </div>
            <div className="grid gap-6 md:grid-cols-2">
              <section className="space-y-3 rounded-lg border p-5"><h2 className="text-lg font-semibold">By payment method</h2>{data.byMethod.length ? <BarList rows={data.byMethod.map((m) => ({ label: humanize(m.method), value: m.amountPaise }))} /> : <p className="text-sm text-muted-foreground">No payments yet.</p>}</section>
              <section className="space-y-3 rounded-lg border p-5"><h2 className="text-lg font-semibold">Top items</h2>{data.topItems.length ? <BarList rows={data.topItems.map((i) => ({ label: `${i.name} (${i.qty})`, value: i.amountPaise }))} /> : <p className="text-sm text-muted-foreground">Nothing sold yet.</p>}</section>
            </div>
            <section className="space-y-3 rounded-lg border p-5">
              <h2 className="text-lg font-semibold">By shift</h2>
              {data.byShift.length === 0 ? <p className="text-sm text-muted-foreground">No payments were taken during a clocked-in shift.</p> : (
                <ul className="divide-y text-sm">{data.byShift.map((s) => <li key={s.shiftId} className="flex justify-between py-2"><span>{s.employeeName} <span className="text-muted-foreground">{formatDateTime(s.startsAt)}</span></span><Money paise={s.amountPaise} /></li>)}</ul>
              )}
            </section>
          </div>
        )}
      </QueryState>
    </div>
  );
}
