import { sql } from 'drizzle-orm';
import type { DbExecutor } from './db-types.js';
import type { DashboardReport, OwnerOverview, ReportBreakdown, ReportRange } from '@packages/validation';
import { DomainError } from '../lib/domain-error.js';
import { renderPdf, type PdfLine } from '../lib/simple-pdf.js';
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


  /** Per-domain figures for the same range handling as the dashboard (net of cancellations). */
  async breakdown(input: ReportRangeInput): Promise<ReportBreakdown> {
    const now = this.now();
    const range = resolveRange(input, now, this.timeZone);
    const today = clubDateOf(now, this.timeZone);
    const q = async (query: ReturnType<typeof sql>) => rowsOf(await this.db.execute(query)) as Array<Record<string, unknown>>;
    const [bSport, bChannel, bCourt, bTotals, oChannel, oTop, tabTotals, tabTop, inv, lowStock, sold, memberTotals, byPlan, payTotals, byDept] = await Promise.all([
      q(sql`SELECT ct.name AS sport, COUNT(*)::int AS count, COALESCE(SUM(b.price_paise), 0)::bigint AS amount
              FROM bookings b JOIN courts c ON c.id = b.court_id JOIN court_types ct ON ct.id = c.court_type_id
             WHERE b.booking_date BETWEEN ${range.from}::date AND ${range.to}::date AND b.status <> 'CANCELLED'
             GROUP BY ct.name ORDER BY count DESC, ct.name`),
      q(sql`SELECT channel, COUNT(*)::int AS count FROM bookings
             WHERE booking_date BETWEEN ${range.from}::date AND ${range.to}::date AND status <> 'CANCELLED'
             GROUP BY channel ORDER BY count DESC, channel`),
      q(sql`SELECT c.name AS court, COUNT(*)::int AS count FROM bookings b JOIN courts c ON c.id = b.court_id
             WHERE b.booking_date BETWEEN ${range.from}::date AND ${range.to}::date AND b.status <> 'CANCELLED'
             GROUP BY c.name ORDER BY count DESC, c.name LIMIT 10`),
      q(sql`SELECT COUNT(*) FILTER (WHERE status <> 'CANCELLED')::int AS total, COUNT(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled,
                   COALESCE(SUM(price_paise) FILTER (WHERE status <> 'CANCELLED'), 0)::bigint AS value
              FROM bookings WHERE booking_date BETWEEN ${range.from}::date AND ${range.to}::date`),
      q(sql`SELECT channel, COUNT(*)::int AS count, COALESCE(SUM(total_paise), 0)::bigint AS amount FROM orders
             WHERE created_at >= ${ts(range.start)} AND created_at < ${ts(range.end)} AND status <> 'CANCELLED'
             GROUP BY channel ORDER BY channel`),
      q(sql`SELECT oi.name_snapshot AS name, SUM(oi.qty)::int AS qty, SUM(oi.line_total_paise)::bigint AS amount
              FROM order_items oi JOIN orders o ON o.id = oi.order_id
             WHERE o.created_at >= ${ts(range.start)} AND o.created_at < ${ts(range.end)} AND o.status <> 'CANCELLED'
             GROUP BY oi.name_snapshot ORDER BY amount DESC, name LIMIT 5`),
      q(sql`SELECT COUNT(*)::int AS tabs, COALESCE(SUM(total_paise), 0)::bigint AS total FROM tabs
             WHERE status = 'SETTLED' AND settled_at >= ${ts(range.start)} AND settled_at < ${ts(range.end)}`),
      q(sql`SELECT ti.name_snapshot AS name, SUM(ti.qty)::int AS qty, SUM(ti.line_total_paise)::bigint AS amount
              FROM tab_items ti JOIN tabs t ON t.id = ti.tab_id
             WHERE t.status = 'SETTLED' AND t.settled_at >= ${ts(range.start)} AND t.settled_at < ${ts(range.end)} AND ti.status <> 'VOID'
             GROUP BY ti.name_snapshot ORDER BY amount DESC, name LIMIT 5`),
      q(sql`SELECT COALESCE(SUM(stock_qty::bigint * price_paise), 0)::bigint AS value FROM products WHERE is_active`),
      q(sql`SELECT name, sku, stock_qty, reorder_level FROM products WHERE is_active AND stock_qty <= reorder_level
             ORDER BY stock_qty ASC, name LIMIT 10`),
      q(sql`SELECT COALESCE(-SUM(qty_delta), 0)::int AS units FROM stock_movements
             WHERE reason IN ('SALE_COUNTER', 'SALE_ONLINE', 'CANCEL_RETURN')
               AND created_at >= ${ts(range.start)} AND created_at < ${ts(range.end)}`),
      q(sql`SELECT (SELECT COUNT(*) FROM members WHERE created_at >= ${ts(range.start)} AND created_at < ${ts(range.end)})::int AS new_members,
                   (SELECT COUNT(*) FROM memberships WHERE status = 'ACTIVE')::int AS active,
                   (SELECT COUNT(*) FROM memberships WHERE status = 'ACTIVE'
                      AND ends_on BETWEEN ${today}::date AND ${addDays(today, EXPIRING_WITHIN_DAYS)}::date)::int AS expiring`),
      q(sql`SELECT p.name AS plan, COUNT(*)::int AS active FROM memberships m JOIN plans p ON p.id = m.plan_id
             WHERE m.status = 'ACTIVE' GROUP BY p.name ORDER BY active DESC, p.name`),
      q(sql`SELECT (SELECT COUNT(*) FROM employees WHERE status = 'ACTIVE')::int AS employees,
                   (SELECT COALESCE(SUM(monthly_salary_paise), 0) FROM employees WHERE status = 'ACTIVE')::bigint AS payroll,
                   (SELECT COUNT(*) FROM leave_requests WHERE status = 'PENDING')::int AS pending_leave`),
      q(sql`SELECT department, COUNT(*)::int AS employees, COALESCE(SUM(monthly_salary_paise), 0)::bigint AS monthly
              FROM employees WHERE status = 'ACTIVE' GROUP BY department ORDER BY monthly DESC, department`),
    ]);
    const bt = bTotals[0] ?? {};
    const tt = tabTotals[0] ?? {};
    const mt = memberTotals[0] ?? {};
    const pt = payTotals[0] ?? {};
    const tabs = num(tt.tabs);
    const barRevenue = num(tt.total);
    const orderRows = oChannel.map((r) => ({ channel: String(r.channel), count: num(r.count), amountPaise: num(r.amount) }));
    return {
      range: range.label,
      from: range.from,
      to: range.to,
      generatedAt: now.toISOString(),
      bookings: {
        total: num(bt.total),
        cancelled: num(bt.cancelled),
        bookedValuePaise: num(bt.value),
        bySport: bSport.map((r) => ({ sport: String(r.sport), count: num(r.count), amountPaise: num(r.amount) })),
        byChannel: bChannel.map((r) => ({ channel: String(r.channel), count: num(r.count) })),
        byCourt: bCourt.map((r) => ({ court: String(r.court), count: num(r.count) })),
      },
      orders: {
        count: orderRows.reduce((n, r) => n + r.count, 0),
        revenuePaise: orderRows.reduce((n, r) => n + r.amountPaise, 0),
        byChannel: orderRows,
        topProducts: oTop.map((r) => ({ name: String(r.name), qty: num(r.qty), amountPaise: num(r.amount) })),
      },
      bar: {
        tabsSettled: tabs,
        revenuePaise: barRevenue,
        averageTabPaise: tabs > 0 ? Math.round(barRevenue / tabs) : 0,
        topItems: tabTop.map((r) => ({ name: String(r.name), qty: num(r.qty), amountPaise: num(r.amount) })),
      },
      inventory: {
        stockValuePaise: num(inv[0]?.value),
        unitsSold: num(sold[0]?.units),
        lowStock: lowStock.map((r) => ({ name: String(r.name), sku: String(r.sku), stockQty: num(r.stock_qty), reorderLevel: num(r.reorder_level) })),
      },
      members: {
        newMembers: num(mt.new_members),
        activeMemberships: num(mt.active),
        expiringSoon: num(mt.expiring),
        byPlan: byPlan.map((r) => ({ plan: String(r.plan), active: num(r.active) })),
      },
      payroll: {
        activeEmployees: num(pt.employees),
        monthlyPayrollPaise: num(pt.payroll),
        pendingLeave: num(pt.pending_leave),
        byDepartment: byDept.map((r) => ({ department: String(r.department), employees: num(r.employees), monthlyPaise: num(r.monthly) })),
      },
    };
  }


  /** A live snapshot for the owner dashboard: next bookings, who is on shift, open work, latest money in. */
  async overview(): Promise<OwnerOverview> {
    const now = this.now();
    const q = async (query: ReturnType<typeof sql>) => rowsOf(await this.db.execute(query)) as Array<Record<string, unknown>>;
    const [upcoming, shifts, counts, payments] = await Promise.all([
      q(sql`SELECT b.id, c.name AS court, ct.name AS sport, b.starts_at, b.ends_at,
                   COALESCE(m.full_name, b.guest_name, 'Guest') AS who
              FROM bookings b JOIN courts c ON c.id = b.court_id JOIN court_types ct ON ct.id = c.court_type_id
              LEFT JOIN members m ON m.id = b.member_id
             WHERE b.status <> 'CANCELLED' AND b.ends_at > ${ts(now)}
             ORDER BY b.starts_at ASC LIMIT 6`),
      q(sql`SELECT e.full_name AS name, s.role_label AS role, s.clock_in_at AS since
              FROM staff_shifts s JOIN employees e ON e.id = s.employee_id
             WHERE s.clock_in_at IS NOT NULL AND s.clock_out_at IS NULL
             ORDER BY s.clock_in_at ASC LIMIT 12`),
      q(sql`SELECT (SELECT COUNT(*) FROM orders WHERE status IN ('PLACED', 'READY', 'OUT_FOR_DELIVERY'))::int AS pending_orders,
                   (SELECT COUNT(*) FROM tabs WHERE status = 'OPEN')::int AS open_tabs,
                   (SELECT COUNT(*) FROM staff_shifts WHERE clock_in_at IS NOT NULL AND clock_out_at IS NULL)::int AS on_shift`),
      q(sql`SELECT p.paid_at, p.source, p.kind, p.method, p.amount_paise, m.full_name AS who
              FROM payments p LEFT JOIN members m ON m.id = p.member_id
             ORDER BY p.paid_at DESC LIMIT 8`),
    ]);
    const iso = (v: unknown) => new Date(v as string | Date).toISOString();
    const c = counts[0] ?? {};
    return {
      generatedAt: now.toISOString(),
      pendingOrders: num(c.pending_orders),
      openTabs: num(c.open_tabs),
      staffOnShiftCount: num(c.on_shift),
      upcomingBookings: upcoming.map((r) => ({
        id: String(r.id), court: String(r.court), sport: String(r.sport), startsAt: iso(r.starts_at), endsAt: iso(r.ends_at), who: String(r.who),
      })),
      staffOnShift: shifts.map((r) => ({ name: String(r.name), role: String(r.role), since: iso(r.since) })),
      recentPayments: payments.map((r) => ({
        paidAt: iso(r.paid_at), source: r.source as Source, kind: r.kind as 'PAYMENT' | 'REFUND', method: r.method as Method,
        amountPaise: num(r.amount_paise), who: r.who ? String(r.who) : null,
      })),
    };
  }


  /** Row-level detail for one area over the range, for CSV export. Capped, with `truncated` set when cut. */
  async detailRows(
    type: 'bookings' | 'orders' | 'bar' | 'inventory' | 'members' | 'payroll',
    input: ReportRangeInput
  ): Promise<{ range: ResolvedRange; header: string[]; rows: Array<Array<string | number | null>>; truncated: boolean }> {
    const range = resolveRange(input, this.now(), this.timeZone);
    const tz = this.timeZone;
    const limit = MAX_EXPORT_ROWS + 1;
    const local = (col: string) => sql.raw(`to_char(${col} AT TIME ZONE '${tz.replace(/[^A-Za-z0-9_/+-]/g, '')}', 'YYYY-MM-DD HH24:MI')`);
    const q = async (query: ReturnType<typeof sql>) => rowsOf(await this.db.execute(query)) as Array<Record<string, unknown>>;
    let header: string[];
    let raw: Array<Array<unknown>>;
    if (type === 'bookings') {
      header = ['Date', 'Starts', 'Ends', 'Court', 'Sport', 'Booked by', 'Status', 'Channel', 'Payment', 'Price (INR)'];
      const rows = await q(sql`SELECT b.booking_date AS d, ${local('b.starts_at')} AS s, ${local('b.ends_at')} AS e, c.name AS court, ct.name AS sport,
          COALESCE(m.full_name, b.guest_name, 'Guest') AS who, b.status, b.channel, b.payment_status, b.price_paise
        FROM bookings b JOIN courts c ON c.id = b.court_id JOIN court_types ct ON ct.id = c.court_type_id LEFT JOIN members m ON m.id = b.member_id
        WHERE b.booking_date BETWEEN ${range.from}::date AND ${range.to}::date ORDER BY b.starts_at, c.name LIMIT ${limit}`);
      raw = rows.map((r) => [r.d, r.s, r.e, r.court, r.sport, r.who, r.status, r.channel, r.payment_status, rupeesOf(r.price_paise)]);
    } else if (type === 'orders') {
      header = ['Placed (club time)', 'Order', 'Channel', 'Status', 'Payment', 'Customer', 'Total (INR)'];
      const rows = await q(sql`SELECT ${local('o.created_at')} AS t, o.order_number, o.channel, o.status, o.payment_status,
          COALESCE(m.full_name, o.customer_name, 'Walk-in') AS who, o.total_paise
        FROM orders o LEFT JOIN members m ON m.id = o.member_id
        WHERE o.created_at >= ${ts(range.start)} AND o.created_at < ${ts(range.end)} ORDER BY o.created_at LIMIT ${limit}`);
      raw = rows.map((r) => [r.t, r.order_number, r.channel, r.status, r.payment_status, r.who, rupeesOf(r.total_paise)]);
    } else if (type === 'bar') {
      header = ['Settled (club time)', 'Tab', 'Table', 'Guest', 'Subtotal (INR)', 'Discount (INR)', 'Total (INR)'];
      const rows = await q(sql`SELECT ${local('t.settled_at')} AS s, t.tab_number, bt.name AS tbl, COALESCE(m.full_name, t.guest_name, 'Guest') AS who,
          t.subtotal_paise, t.discount_paise, t.total_paise
        FROM tabs t LEFT JOIN bar_tables bt ON bt.id = t.table_id LEFT JOIN members m ON m.id = t.member_id
        WHERE t.status = 'SETTLED' AND t.settled_at >= ${ts(range.start)} AND t.settled_at < ${ts(range.end)} ORDER BY t.settled_at LIMIT ${limit}`);
      raw = rows.map((r) => [r.s, r.tab_number, r.tbl, r.who, rupeesOf(r.subtotal_paise), rupeesOf(r.discount_paise), rupeesOf(r.total_paise)]);
    } else if (type === 'inventory') {
      header = ['When (club time)', 'SKU', 'Product', 'Reason', 'Change', 'Balance after', 'Note'];
      const rows = await q(sql`SELECT ${local('sm.created_at')} AS t, p.sku, p.name, sm.reason, sm.qty_delta, sm.balance_after, sm.note
        FROM stock_movements sm JOIN products p ON p.id = sm.product_id
        WHERE sm.created_at >= ${ts(range.start)} AND sm.created_at < ${ts(range.end)} ORDER BY sm.created_at LIMIT ${limit}`);
      raw = rows.map((r) => [r.t, r.sku, r.name, r.reason, num(r.qty_delta), num(r.balance_after), r.note]);
    } else if (type === 'members') {
      header = ['Member code', 'Name', 'Joined (club time)', 'Current plan', 'Membership status', 'Ends on'];
      const rows = await q(sql`SELECT m.member_code, m.full_name, ${local('m.created_at')} AS joined, p.name AS plan, ms.status, ms.ends_on
        FROM members m
        LEFT JOIN LATERAL (SELECT * FROM memberships x WHERE x.member_id = m.id ORDER BY x.ends_on DESC LIMIT 1) ms ON TRUE
        LEFT JOIN plans p ON p.id = ms.plan_id
        WHERE m.created_at >= ${ts(range.start)} AND m.created_at < ${ts(range.end)} ORDER BY m.created_at LIMIT ${limit}`);
      raw = rows.map((r) => [r.member_code, r.full_name, r.joined, r.plan, r.status, r.ends_on]);
    } else {
      // Actual payroll runs whose month falls inside the range, not the current salary roll.
      header = ['Month', 'Run status', 'Employee', 'Department', 'Base (INR)', 'Unpaid leave (INR)', 'Bonus (INR)', 'Other deductions (INR)', 'Net (INR)'];
      const rows = await q(sql`SELECT r.month, r.status, s.employee_name, s.department, s.base_paise, s.leave_deduction_paise, s.bonus_paise, s.other_deduction_paise, s.net_paise
        FROM payslips s JOIN payroll_runs r ON r.id = s.run_id
        WHERE r.month BETWEEN ${range.from.slice(0, 7)} AND ${range.to.slice(0, 7)} ORDER BY r.month, s.employee_name LIMIT ${limit}`);
      raw = rows.map((r) => [r.month, r.status, r.employee_name, r.department, rupeesOf(r.base_paise), rupeesOf(r.leave_deduction_paise), rupeesOf(r.bonus_paise), rupeesOf(r.other_deduction_paise), rupeesOf(r.net_paise)]);
    }
    const truncated = raw.length > MAX_EXPORT_ROWS;
    const rows = (truncated ? raw.slice(0, MAX_EXPORT_ROWS) : raw).map((r) => r.map((c) => (c === null || c === undefined ? null : typeof c === 'number' ? c : String(c))));
    return { range, header, rows, truncated };
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


const rupeesOf = (paise: unknown) => (paise === null || paise === undefined ? null : Number((Number(paise) / 100).toFixed(2)));

/** One-page PDF of the dashboard summary. */
export function summaryPdf(report: DashboardReport): Buffer {
  const rupee = (p: number) => `Rs. ${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const lines: PdfLine[] = [
    { text: 'Club report', size: 18, bold: true },
    { text: `${report.range}: ${report.from} to ${report.to}`, gap: 2 },
    { text: 'Key figures', bold: true, size: 12, gap: 16 },
    { text: 'Revenue', right: rupee(report.kpis.revenuePaise) },
    { text: 'Previous period', right: rupee(report.kpis.previousRevenuePaise) },
    { text: 'Change', right: `${report.kpis.changePct}%` },
    { text: 'Bookings', right: String(report.kpis.bookingsCount) },
    { text: 'Court utilisation', right: `${report.kpis.utilisationPct}%` },
    { text: 'New members', right: String(report.kpis.newMembers) },
    { text: 'Shop orders', right: String(report.kpis.shopOrdersCount) },
    { text: 'Bar tabs settled', right: String(report.kpis.barTabsCount) },
    { text: 'Revenue by source', bold: true, size: 12, gap: 14 },
    ...report.bySource.map((s) => ({ text: s.source, right: rupee(s.amountPaise) })),
    { text: 'Revenue by payment method', bold: true, size: 12, gap: 14 },
    ...report.byMethod.map((m) => ({ text: m.method, right: rupee(m.amountPaise) })),
    { text: 'Current position (snapshot at generation time, not for the range)', bold: true, size: 12, gap: 14 },
    { text: 'Tax payable on this range', right: rupee(report.owed.taxPayablePaise) },
    { text: 'Monthly salaries of active staff', right: rupee(report.owed.payrollDuePaise) },
    { text: 'Unpaid invoices', right: rupee(report.owed.unpaidInvoicesPaise) },
    { text: `Generated ${report.generatedAt}`, size: 9, gap: 24 },
  ];
  return renderPdf(lines, `Club report ${report.from} to ${report.to}`);
}

/** One-page PDF of the per-area breakdown. */
export function breakdownPdf(r: ReportBreakdown): Buffer {
  const rupee = (p: number) => `Rs. ${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const top = <T,>(items: T[], f: (x: T) => PdfLine) => items.slice(0, 3).map(f);
  const lines: PdfLine[] = [
    { text: 'Club report by area', size: 18, bold: true },
    { text: `${r.range}: ${r.from} to ${r.to}`, gap: 2 },
    { text: 'Court bookings', bold: true, size: 12, gap: 14 },
    { text: `${r.bookings.total} booked, ${r.bookings.cancelled} cancelled`, right: rupee(r.bookings.bookedValuePaise) },
    ...top(r.bookings.bySport, (s) => ({ text: `  ${s.sport}: ${s.count}`, right: rupee(s.amountPaise) })),
    { text: 'Shop and counter sales', bold: true, size: 12, gap: 12 },
    { text: `${r.orders.count} orders`, right: rupee(r.orders.revenuePaise) },
    ...top(r.orders.topProducts, (p) => ({ text: `  ${p.name} x${p.qty}`, right: rupee(p.amountPaise) })),
    { text: 'Bar', bold: true, size: 12, gap: 12 },
    { text: `${r.bar.tabsSettled} tabs settled, average ${rupee(r.bar.averageTabPaise)}`, right: rupee(r.bar.revenuePaise) },
    ...top(r.bar.topItems, (p) => ({ text: `  ${p.name} x${p.qty}`, right: rupee(p.amountPaise) })),
    { text: 'Inventory', bold: true, size: 12, gap: 12 },
    { text: `${r.inventory.unitsSold} units sold, stock value`, right: rupee(r.inventory.stockValuePaise) },
    { text: `${r.inventory.lowStock.length} products at or below reorder level` },
    { text: 'Members', bold: true, size: 12, gap: 12 },
    { text: `${r.members.newMembers} joined, ${r.members.activeMemberships} active, ${r.members.expiringSoon} expiring within 7 days` },
    { text: 'Payroll (current staff)', bold: true, size: 12, gap: 12 },
    { text: `${r.payroll.activeEmployees} staff, ${r.payroll.pendingLeave} leave requests pending`, right: rupee(r.payroll.monthlyPayrollPaise) },
    { text: `Generated ${r.generatedAt}`, size: 9, gap: 24 },
  ];
  return renderPdf(lines, `Club report by area ${r.from} to ${r.to}`);
}

/** Rows of the `breakdown` CSV: one flat table, amounts in rupees. */
export function breakdownCsvRows(r: ReportBreakdown): Array<Array<string | number>> {
  const rows: Array<Array<string | number>> = [['Section', 'Label', 'Count', 'Amount (INR)']];
  rows.push(['Period', `${r.range} ${r.from} to ${r.to}`, '', '']);
  rows.push(['Bookings', 'Total', r.bookings.total, rupees(r.bookings.bookedValuePaise)], ['Bookings', 'Cancelled', r.bookings.cancelled, '']);
  for (const x of r.bookings.bySport) rows.push(['Bookings by sport', x.sport, x.count, rupees(x.amountPaise)]);
  for (const x of r.bookings.byChannel) rows.push(['Bookings by channel', x.channel, x.count, '']);
  for (const x of r.bookings.byCourt) rows.push(['Bookings by court', x.court, x.count, '']);
  rows.push(['Shop orders', 'Total', r.orders.count, rupees(r.orders.revenuePaise)]);
  for (const x of r.orders.byChannel) rows.push(['Shop orders by channel', x.channel, x.count, rupees(x.amountPaise)]);
  for (const x of r.orders.topProducts) rows.push(['Top products', x.name, x.qty, rupees(x.amountPaise)]);
  rows.push(['Bar', 'Tabs settled', r.bar.tabsSettled, rupees(r.bar.revenuePaise)], ['Bar', 'Average tab', '', rupees(r.bar.averageTabPaise)]);
  for (const x of r.bar.topItems) rows.push(['Top bar items', x.name, x.qty, rupees(x.amountPaise)]);
  rows.push(['Inventory', 'Stock value', '', rupees(r.inventory.stockValuePaise)], ['Inventory', 'Units sold', r.inventory.unitsSold, '']);
  for (const x of r.inventory.lowStock) rows.push(['Low stock', `${x.name} (${x.sku}, reorder at ${x.reorderLevel})`, x.stockQty, '']);
  rows.push(['Members', 'New members', r.members.newMembers, ''], ['Members', 'Active memberships', r.members.activeMemberships, ''], ['Members', 'Expiring within 7 days', r.members.expiringSoon, '']);
  for (const x of r.members.byPlan) rows.push(['Members by plan', x.plan, x.active, '']);
  rows.push(['Payroll', 'Active employees', r.payroll.activeEmployees, rupees(r.payroll.monthlyPayrollPaise)], ['Payroll', 'Pending leave requests', r.payroll.pendingLeave, '']);
  for (const x of r.payroll.byDepartment) rows.push(['Payroll by department', x.department, x.employees, rupees(x.monthlyPaise)]);
  return rows;
}

export function paymentsCsvRows(rows: readonly PaymentExportRow[]): Array<Array<string | number | null>> {
  return [
    ['Paid at (club time)', 'Source', 'Kind', 'Method', 'Amount (INR)', 'Member', 'Reference', 'Received by'],
    ...rows.map((r) => [r.paidAt, r.source, r.kind, r.method, rupees(r.amountPaise), r.memberName, r.reference, r.receivedBy]),
  ];
}

/** `courtos-month-2026-10.csv`, `courtos-week-2026-10-05.csv`, `courtos-today-2026-10-09.csv`. */
export function exportFilename(range: Pick<ResolvedRange, 'label' | 'from' | 'to'>,type: string): string {
  const stamp =
    range.label === 'month'
      ? range.from.slice(0, 7)
      : range.label === 'custom'
        ? `${range.from}_to_${range.to}`
        : range.from;
  const prefix = type === 'summary' ? 'courtos' : `courtos-${type}`;
  return `${prefix}-${range.label === 'custom' ? '' : `${range.label}-`}${stamp}.csv`;
}
