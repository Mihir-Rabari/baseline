import { sql } from 'drizzle-orm';
import type { DbExecutor } from './db-types.js';
import type { DashboardReport, ReportRange } from '@packages/validation';
import { DomainError } from '../lib/domain-error.js';
import { getClubHours } from './club-settings.js';
import {
  addDays,
  clubDateOf,
  clubParts,
  clubWallTimeToInstant,
  daysBetween,
  dayRange,
  monthRange,
  parseTimeOfDay,
  startOfClubDay,
  weekRange,
} from './time.js';

/**
 * Owner dashboard (M-14). Every rupee comes from the `payments` ledger, net of refunds (refunds
 * are negative rows, so a plain SUM is already net). Every day boundary is the club's midnight,
 * never UTC: range limits are computed with the time.ts helpers and bucket labels with
 * `AT TIME ZONE <club zone>` in SQL.
 */

export const REVENUE_SOURCES = ['COURT', 'SHOP', 'BAR', 'MEMBERSHIP', 'INVOICE'] as const;
export const PAYMENT_METHODS = ['CASH', 'CARD', 'UPI'] as const;
type Source = (typeof REVENUE_SOURCES)[number];
type Method = (typeof PAYMENT_METHODS)[number];

/** Longest custom range accepted (bounds the work done per request). */
export const MAX_RANGE_DAYS = 366;
/** Safety cap on the `payments` CSV export. */
export const MAX_EXPORT_ROWS = 50_000;
/** Memberships ending within this many days are "expiring" (PROJECT_OVERVIEW membership rules). */
export const EXPIRING_WITHIN_DAYS = 7;

export const DEFAULT_TAX_RATES_BP: Record<Source, number> = {
  COURT: 1800,
  SHOP: 1800,
  BAR: 500,
  MEMBERSHIP: 1800,
  INVOICE: 1800,
};

export interface ReportRangeInput {
  range?: ReportRange;
  from?: string;
  to?: string;
}

export interface ResolvedRange {
  label: ReportRange | 'custom';
  /** First and last club date included (inclusive). */
  from: string;
  to: string;
  start: Date;
  /** Exclusive end instant. */
  end: Date;
  previousStart: Date;
  previousEnd: Date;
}

export interface PaymentExportRow {
  paidAt: string;
  source: string;
  kind: string;
  method: string;
  amountPaise: number;
  memberName: string | null;
  reference: string | null;
  receivedBy: string | null;
}

function badRange(message: string): DomainError {
  return new DomainError('INVALID_RANGE', 400, message);
}

/** Resolves `range` / `from`+`to` against `now` in the club zone. Throws 400 on a bad range. */
export function resolveRange(input: ReportRangeInput, now: Date, timeZone: string): ResolvedRange {
  const today = clubDateOf(now, timeZone);

  if (input.from || input.to) {
    if (input.range) throw badRange('Use either range or from+to, not both');
    if (!input.from || !input.to) throw badRange('from and to must be provided together');
    const span = daysBetween(input.from, input.to) + 1;
    if (span < 1) throw badRange('to must not be before from');
    if (span > MAX_RANGE_DAYS) throw badRange(`Range may span at most ${MAX_RANGE_DAYS} days`);
    const start = startOfClubDay(input.from, timeZone);
    const end = startOfClubDay(addDays(input.to, 1), timeZone);
    return {
      label: 'custom',
      from: input.from,
      to: input.to,
      start,
      end,
      previousStart: startOfClubDay(addDays(input.from, -span), timeZone),
      previousEnd: start,
    };
  }

  const label = input.range ?? 'today';
  if (label === 'today') {
    const current = dayRange(today, timeZone);
    const previous = dayRange(addDays(today, -1), timeZone);
    return { label, from: today, to: today, start: current.start, end: current.end, previousStart: previous.start, previousEnd: previous.end };
  }
  if (label === 'week') {
    const current = weekRange(today, timeZone); // Monday to Sunday
    const previous = weekRange(addDays(current.startDate, -1), timeZone);
    return {
      label,
      from: current.startDate,
      to: addDays(current.endDateExclusive, -1),
      start: current.start,
      end: current.end,
      previousStart: previous.start,
      previousEnd: previous.end,
    };
  }
  const current = monthRange(today, timeZone);
  const previous = monthRange(addDays(current.startDate, -1), timeZone);
  return {
    label,
    from: current.startDate,
    to: addDays(current.endDateExclusive, -1),
    start: current.start,
    end: current.end,
    previousStart: previous.start,
    previousEnd: previous.end,
  };
}

/** Tax included in a tax-inclusive amount (BR-22): round(amount x rate / (10000 + rate)). */
export function inclusiveTaxPaise(amountPaise: number, rateBp: number): number {
  return Math.round((amountPaise * rateBp) / (10_000 + rateBp));
}

/** Parses the `tax.rates` setting, falling back to the documented default per source. */
export function parseTaxRates(value: unknown): Record<Source, number> {
  const rates = { ...DEFAULT_TAX_RATES_BP };
  if (value && typeof value === 'object') {
    for (const source of REVENUE_SOURCES) {
      const rate = (value as Record<string, unknown>)[source];
      if (typeof rate === 'number' && Number.isFinite(rate) && rate >= 0) rates[source] = rate;
    }
  }
  return rates;
}

function emptyBySource(): Record<Source, number> {
  return { COURT: 0, SHOP: 0, BAR: 0, MEMBERSHIP: 0, INVOICE: 0 };
}

/** The raw `sql` driver cannot bind a Date, so instants are sent as ISO text cast to timestamptz. */
const ts = (instant: Date) => sql`${instant.toISOString()}::timestamptz`;

/** `db.execute` returns the row array itself with postgres-js and `{ rows }` with node-postgres. */
function rowsOf(result: unknown): unknown[] {
  return Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function num(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value);
}

export class ReportService {
  constructor(
    private readonly db: DbExecutor,
    private readonly timeZone: string,
    private readonly now: () => Date = () => new Date()
  ) {}

  async dashboard(input: ReportRangeInput): Promise<DashboardReport> {
    const now = this.now();
    const range = resolveRange(input, now, this.timeZone);
    const today = clubDateOf(now, this.timeZone);
    const hourly = range.from === range.to;
    const tz = this.timeZone;

    const [grouped, previous, counts, owedAndAlerts, utilisationPct, hours, taxSetting] = await Promise.all([
      this.db.execute(sql`
        SELECT to_char(
                 date_trunc(${hourly ? 'hour' : 'day'}, paid_at AT TIME ZONE ${tz}),
                 ${hourly ? 'YYYY-MM-DD"T"HH24:MI' : 'YYYY-MM-DD'}
               ) AS bucket,
               source, method, SUM(amount_paise)::bigint AS total
          FROM payments
         WHERE paid_at >= ${ts(range.start)} AND paid_at < ${ts(range.end)}
         GROUP BY 1, 2, 3`),
      this.db.execute(sql`
        SELECT COALESCE(SUM(amount_paise), 0)::bigint AS total
          FROM payments
         WHERE paid_at >= ${ts(range.previousStart)} AND paid_at < ${ts(range.previousEnd)}`),
      this.db.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM bookings
            WHERE booking_date BETWEEN ${range.from}::date AND ${range.to}::date
              AND status <> 'CANCELLED')::int AS bookings,
          (SELECT COUNT(*) FROM members
            WHERE created_at >= ${ts(range.start)} AND created_at < ${ts(range.end)})::int AS new_members,
          (SELECT COUNT(*) FROM orders
            WHERE created_at >= ${ts(range.start)} AND created_at < ${ts(range.end)}
              AND status <> 'CANCELLED')::int AS shop_orders,
          (SELECT COUNT(*) FROM tabs
            WHERE status = 'SETTLED'
              AND settled_at >= ${ts(range.start)} AND settled_at < ${ts(range.end)})::int AS bar_tabs`),
      this.db.execute(sql`
        SELECT
          (SELECT COALESCE(SUM(monthly_salary_paise), 0) FROM employees WHERE status = 'ACTIVE')::bigint AS payroll,
          (SELECT COALESCE(SUM(total_paise), 0) FROM invoices WHERE status = 'SENT')::bigint AS unpaid,
          (SELECT COUNT(*) FROM invoices WHERE status = 'SENT' AND due_date < ${today}::date)::int AS overdue,
          (SELECT COUNT(*) FROM products WHERE is_active AND stock_qty <= reorder_level)::int AS low_stock,
          (SELECT COUNT(*) FROM memberships
            WHERE status = 'ACTIVE'
              AND ends_on BETWEEN ${today}::date AND ${addDays(today, EXPIRING_WITHIN_DAYS)}::date)::int AS expiring,
          (SELECT COUNT(*) FROM leads WHERE status = 'NEW')::int AS new_leads,
          (SELECT COUNT(*) FROM leave_requests WHERE status = 'PENDING')::int AS pending_leave`),
      this.utilisation(range, now),
      getClubHours(this.db),
      this.db.execute(sql`SELECT value FROM system_settings WHERE key = 'tax.rates'`),
    ]);

    // ---- revenue breakdowns (net of refunds) ----
    const bySource = emptyBySource();
    const byMethod: Record<Method, number> = { CASH: 0, CARD: 0, UPI: 0 };
    const buckets = new Map<string, { totalPaise: number; bySource: Record<Source, number> }>();
    for (const row of rowsOf(grouped) as Array<{ bucket: string; source: Source; method: Method; total: string }>) {
      const amount = num(row.total);
      bySource[row.source] += amount;
      byMethod[row.method] += amount;
      const bucket = buckets.get(row.bucket) ?? { totalPaise: 0, bySource: emptyBySource() };
      bucket.totalPaise += amount;
      bucket.bySource[row.source] += amount;
      buckets.set(row.bucket, bucket);
    }
    const revenuePaise = REVENUE_SOURCES.reduce((sum, s) => sum + bySource[s], 0);
    const previousRevenuePaise = num((rowsOf(previous)[0] as { total?: string } | undefined)?.total);
    const changePct =
      previousRevenuePaise !== 0
        ? Math.round(((revenuePaise - previousRevenuePaise) / Math.abs(previousRevenuePaise)) * 100)
        : revenuePaise === 0
          ? 0
          : 100;

    const trend = this.fillTrend(buckets, range, hourly, today, now, parseTimeOfDay(hours.open), parseTimeOfDay(hours.close));

    // ---- tax payable: per-source inclusive tax on the net amount ----
    const rates = parseTaxRates((rowsOf(taxSetting)[0] as { value?: unknown } | undefined)?.value);
    const taxPayablePaise = REVENUE_SOURCES.reduce((sum, s) => sum + inclusiveTaxPaise(bySource[s], rates[s]), 0);

    const c = rowsOf(counts)[0] as Record<string, number>;
    const o = rowsOf(owedAndAlerts)[0] as Record<string, string | number>;

    return {
      range: range.label,
      from: range.from,
      to: range.to,
      generatedAt: now.toISOString(),
      kpis: {
        revenuePaise,
        previousRevenuePaise,
        changePct,
        bookingsCount: num(c.bookings),
        utilisationPct,
        newMembers: num(c.new_members),
        shopOrdersCount: num(c.shop_orders),
        barTabsCount: num(c.bar_tabs),
      },
      bySource: REVENUE_SOURCES.map((source) => ({ source, amountPaise: bySource[source] })),
      byMethod: PAYMENT_METHODS.map((method) => ({ method, amountPaise: byMethod[method] })),
      trend,
      owed: {
        taxPayablePaise,
        payrollDuePaise: num(o.payroll),
        unpaidInvoicesPaise: num(o.unpaid),
        overdueInvoicesCount: num(o.overdue),
      },
      alerts: {
        lowStockCount: num(o.low_stock),
        expiringMembershipsCount: num(o.expiring),
        newLeadsCount: num(o.new_leads),
        pendingLeaveCount: num(o.pending_leave),
      },
    };
  }

  /**
   * Trend points with gaps filled by zeros so charts have a continuous axis: days from the start
   * of the range up to today (or the range end), hours from opening time to the current hour.
   */
  private fillTrend(
    buckets: Map<string, { totalPaise: number; bySource: Record<Source, number> }>,
    range: ResolvedRange,
    hourly: boolean,
    today: string,
    now: Date,
    openMinutes: number,
    closeMinutes: number
  ): DashboardReport['trend'] {
    const keys = new Set(buckets.keys());
    if (hourly) {
      const day = range.from;
      const nowParts = clubParts(now, this.timeZone);
      const isToday = day === today;
      const firstHour = Math.min(Math.floor(openMinutes / 60), ...[...keys].map((k) => Number(k.slice(11, 13))));
      const lastHour = Math.max(
        isToday ? nowParts.hour : Math.ceil(closeMinutes / 60) - 1,
        ...[...keys].map((k) => Number(k.slice(11, 13)))
      );
      for (let h = firstHour; h <= Math.min(lastHour, 23); h += 1) keys.add(`${day}T${pad2(h)}:00`);
    } else {
      const last = range.to < today ? range.to : today;
      for (let d = range.from; d <= last; d = addDays(d, 1)) keys.add(d);
    }
    return [...keys].sort().map((bucket) => {
      const b = buckets.get(bucket);
      return { bucket, totalPaise: b?.totalPaise ?? 0, bySource: b?.bySource ?? emptyBySource() };
    });
  }

  /**
   * Booked court-hours over open court-hours, both clipped to "now" so a half-elapsed day is not
   * penalised. Booked = BOOKING occupancies of non-cancelled bookings plus SOCIAL occupancies
   * (maintenance blocks are not bookings); open = active courts x club opening hours elapsed.
   */
  private async utilisation(range: ResolvedRange, now: Date): Promise<number> {
    const hours = await getClubHours(this.db);
    const openMin = parseTimeOfDay(hours.open);
    const closeMin = parseTimeOfDay(hours.close);
    const cap = Math.min(now.getTime(), range.end.getTime());

    let openMs = 0;
    for (let d = range.from; d <= range.to; d = addDays(d, 1)) {
      const dayOpen = clubWallTimeToInstant(d, openMin, this.timeZone).getTime();
      const dayClose = clubWallTimeToInstant(d, closeMin, this.timeZone).getTime();
      if (dayOpen >= cap) break;
      openMs += Math.max(0, Math.min(dayClose, cap) - dayOpen);
    }
    if (openMs <= 0) return 0;

    const capDate = new Date(cap);
    const result = await this.db.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM courts WHERE is_active)::int AS courts,
        COALESCE((
          SELECT SUM(EXTRACT(EPOCH FROM (LEAST(o.ends_at, ${ts(capDate)}) - GREATEST(o.starts_at, ${ts(range.start)}))))
            FROM court_occupancies o
            LEFT JOIN bookings b ON b.id = o.booking_id
           WHERE o.starts_at < ${ts(capDate)} AND o.ends_at > ${ts(range.start)}
             AND (o.kind = 'SOCIAL' OR (o.kind = 'BOOKING' AND b.status <> 'CANCELLED'))
        ), 0)::float AS booked_seconds`);
    const row = rowsOf(result)[0] as { courts: number; booked_seconds: number };
    const courts = num(row.courts);
    if (courts === 0) return 0;
    const pct = (num(row.booked_seconds) * 1000) / (openMs * courts) * 100;
    return Math.max(0, Math.min(100, Math.round(pct)));
  }

  /** Individual ledger rows for the range, newest first, with club-local timestamps. */
  async paymentRows(input: ReportRangeInput): Promise<{ range: ResolvedRange; rows: PaymentExportRow[]; truncated: boolean }> {
    const range = resolveRange(input, this.now(), this.timeZone);
    const result = await this.db.execute(sql`
      SELECT to_char(p.paid_at AT TIME ZONE ${this.timeZone}, 'YYYY-MM-DD HH24:MI:SS') AS paid_at,
             p.source, p.kind, p.method, p.amount_paise::bigint AS amount_paise,
             m.full_name AS member_name, p.reference, u.name AS received_by
        FROM payments p
        LEFT JOIN members m ON m.id = p.member_id
        LEFT JOIN users u ON u.id = p.received_by
       WHERE p.paid_at >= ${ts(range.start)} AND p.paid_at < ${ts(range.end)}
       ORDER BY p.paid_at DESC, p.id
       LIMIT ${MAX_EXPORT_ROWS + 1}`);
    const all = (rowsOf(result) as Array<Record<string, unknown>>).map((r) => ({
      paidAt: String(r.paid_at),
      source: String(r.source),
      kind: String(r.kind),
      method: String(r.method),
      amountPaise: num(r.amount_paise),
      memberName: (r.member_name as string | null) ?? null,
      reference: (r.reference as string | null) ?? null,
      receivedBy: (r.received_by as string | null) ?? null,
    }));
    return { range, rows: all.slice(0, MAX_EXPORT_ROWS), truncated: all.length > MAX_EXPORT_ROWS };
  }
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * One CSV cell. Strings may be attacker controlled (member names, payment references), so any
 * that start with `=`, `+`, `-`, `@`, tab or CR get a leading apostrophe and spreadsheets treat
 * them as text, not a formula. Numbers come from our own arithmetic and are written raw so
 * negative refunds stay numeric. Fields with commas, quotes or line breaks are quoted.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  return `${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

const rupees = (paise: number) => Number((paise / 100).toFixed(2));

/** Rows of the `summary` CSV: one flat table, amounts in rupees. */
export function summaryCsvRows(report: DashboardReport): Array<Array<string | number>> {
  const rows: Array<Array<string | number>> = [['Section', 'Label', 'Value']];
  rows.push(['Period', 'Range', report.range], ['Period', 'From', report.from], ['Period', 'To', report.to]);
  const k = report.kpis;
  rows.push(
    ['KPI', 'Revenue (INR)', rupees(k.revenuePaise)],
    ['KPI', 'Previous period revenue (INR)', rupees(k.previousRevenuePaise)],
    ['KPI', 'Change vs previous (%)', k.changePct],
    ['KPI', 'Bookings', k.bookingsCount],
    ['KPI', 'Court utilisation (%)', k.utilisationPct],
    ['KPI', 'New members', k.newMembers],
    ['KPI', 'Shop orders', k.shopOrdersCount],
    ['KPI', 'Bar tabs settled', k.barTabsCount]
  );
  for (const s of report.bySource) rows.push(['Revenue by source (INR)', s.source, rupees(s.amountPaise)]);
  for (const m of report.byMethod) rows.push(['Revenue by payment method (INR)', m.method, rupees(m.amountPaise)]);
  for (const t of report.trend) rows.push(['Trend (INR)', t.bucket, rupees(t.totalPaise)]);
  rows.push(
    ['Owed (INR)', 'Tax payable', rupees(report.owed.taxPayablePaise)],
    ['Owed (INR)', 'Payroll due (monthly)', rupees(report.owed.payrollDuePaise)],
    ['Owed (INR)', 'Unpaid invoices', rupees(report.owed.unpaidInvoicesPaise)],
    ['Owed', 'Overdue invoices', report.owed.overdueInvoicesCount]
  );
  return rows;
}

export function paymentsCsvRows(rows: readonly PaymentExportRow[]): Array<Array<string | number | null>> {
  return [
    ['Paid at (club time)', 'Source', 'Kind', 'Method', 'Amount (INR)', 'Member', 'Reference', 'Received by'],
    ...rows.map((r) => [r.paidAt, r.source, r.kind, r.method, rupees(r.amountPaise), r.memberName, r.reference, r.receivedBy]),
  ];
}

/** `baseline-month-2026-10.csv`, `baseline-week-2026-10-05.csv`, `baseline-today-2026-10-09.csv`. */
export function exportFilename(range: Pick<ResolvedRange, 'label' | 'from' | 'to'>,type: 'summary' | 'payments'): string {
  const stamp =
    range.label === 'month'
      ? range.from.slice(0, 7)
      : range.label === 'custom'
        ? `${range.from}_to_${range.to}`
        : range.from;
  const prefix = type === 'payments' ? 'baseline-payments' : 'baseline';
  return `${prefix}-${range.label === 'custom' ? '' : `${range.label}-`}${stamp}.csv`;
}
