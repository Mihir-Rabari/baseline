import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { OwnerOverviewSchema, ReportBreakdownSchema } from '@packages/validation';
import { buildApp } from './app.js';
import { isDatabaseAvailable } from './test-support/database.js';
import { MembersFixtures, type Actor } from './test-support/members-fixtures.js';
import { breakdownCsvRows, toCsv } from './services/report.service.js';

describe('Report breakdown (#63)', () => {
  let app: FastifyInstance;
  let hasDatabase = false;
  const fx = new MembersFixtures();
  let owner: Actor;
  let bar: Actor;
  let desk: Actor;
  let member: Actor;
  const get = (url: string, actor?: Actor) => app.inject({ method: 'GET', url, headers: actor ? { cookie: actor.cookie } : {} });

  beforeAll(async () => {
    app = buildApp();
    MembersFixtures.spreadClientIps(app);
    await app.ready();
    hasDatabase = await isDatabaseAvailable();
    if (!hasDatabase) return;
    owner = await fx.actor(app, 'OWNER');
    bar = await fx.actor(app, 'BAR_STAFF');
    desk = await fx.actor(app, 'FRONT_DESK');
    member = await fx.actor(app, 'MEMBER');
  });

  afterAll(async () => {
    if (hasDatabase) await fx.cleanup();
    await app.close();
  });

  it('401 without a session', async () => {
    expect((await get('/api/v1/reports/breakdown?range=month')).statusCode).toBe(401);
    expect((await get('/api/v1/reports/export.csv?type=breakdown')).statusCode).toBe(401);
  });

  it('403 for bar staff, front desk and members: only the owner reads reports', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    for (const actor of [bar, desk, member]) {
      expect((await get('/api/v1/reports/breakdown?range=month', actor)).statusCode).toBe(403);
      expect((await get('/api/v1/reports/export.csv?type=breakdown', actor)).statusCode).toBe(403);
    }
  });

  it('400 for a bad range', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    expect((await get('/api/v1/reports/breakdown?range=year', owner)).statusCode).toBe(400);
    expect((await get('/api/v1/reports/breakdown?from=2030-01-01', owner)).statusCode).toBe(400);
    expect((await get('/api/v1/reports/breakdown?from=2030-02-01&to=2030-01-01', owner)).statusCode).toBe(400);
    expect((await get('/api/v1/reports/breakdown?range=today&from=2030-01-01&to=2030-01-02', owner)).statusCode).toBe(400);
  });

  it('returns every section for a range, with consistent totals', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const res = await get(`/api/v1/reports/breakdown?from=${day(-300)}&to=${day(30)}`, owner);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const report = ReportBreakdownSchema.parse(res.json());
    expect(report.range).toBe('custom');
    expect(report.bookings.bySport.reduce((n, s) => n + s.count, 0)).toBe(report.bookings.total);
    expect(report.bookings.byChannel.reduce((n, c) => n + c.count, 0)).toBe(report.bookings.total);
    expect(report.orders.count).toBe(report.orders.byChannel.reduce((n, c) => n + c.count, 0));
    expect(report.members.byPlan.reduce((n, p) => n + p.active, 0)).toBe(report.members.activeMemberships);
    expect(report.payroll.byDepartment.reduce((n, d) => n + d.employees, 0)).toBe(report.payroll.activeEmployees);
    expect(report.inventory.lowStock.every((p) => p.stockQty <= p.reorderLevel)).toBe(true);
  });

  it('an empty range is all zeros, not an error', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const report = ReportBreakdownSchema.parse((await get('/api/v1/reports/breakdown?from=1999-01-01&to=1999-01-02', owner)).json());
    expect(report.bookings.total).toBe(0);
    expect(report.orders).toMatchObject({ count: 0, revenuePaise: 0, topProducts: [] });
    expect(report.bar).toMatchObject({ tabsSettled: 0, averageTabPaise: 0 });
  });

  it('overview: 401 without a session, 403 for everyone but the owner (#60)', async (ctx) => {
    expect((await get('/api/v1/reports/overview')).statusCode).toBe(401);
    if (!hasDatabase) return ctx.skip();
    for (const actor of [bar, desk, member]) expect((await get('/api/v1/reports/overview', actor)).statusCode).toBe(403);
  });

  it('overview: live snapshot with bounded, ordered lists (#60)', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const res = await get('/api/v1/reports/overview', owner);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const overview = OwnerOverviewSchema.parse(res.json());
    expect(overview.upcomingBookings.length).toBeLessThanOrEqual(6);
    expect(overview.recentPayments.length).toBeLessThanOrEqual(8);
    expect(overview.upcomingBookings.every((b) => Date.parse(b.endsAt) > Date.now() - 1000)).toBe(true);
    const starts = overview.upcomingBookings.map((x) => Date.parse(x.startsAt));
    expect(starts).toEqual([...starts].sort((x, y) => x - y));
    const paid = overview.recentPayments.map((x) => Date.parse(x.paidAt));
    expect(paid).toEqual([...paid].sort((x, y) => y - x));
  });

  it('exports the breakdown as a CSV attachment', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const res = await get('/api/v1/reports/export.csv?type=breakdown&range=month', owner);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(/baseline-breakdown-month-\d{4}-\d{2}\.csv/);
    expect(res.body.split('\r\n')[0]).toBe('Section,Label,Count,Amount (INR)');
  });
});

describe('breakdownCsvRows (unit)', () => {
  it('writes amounts in rupees and neutralises spreadsheet formulas in names', () => {
    const csv = toCsv(
      breakdownCsvRows({
        range: 'month', from: '2030-03-01', to: '2030-03-31', generatedAt: new Date().toISOString(),
        bookings: { total: 2, cancelled: 1, bookedValuePaise: 150050, bySport: [{ sport: 'Padel', count: 2, amountPaise: 150050 }], byChannel: [], byCourt: [] },
        orders: { count: 0, revenuePaise: 0, byChannel: [], topProducts: [{ name: '=HYPERLINK("x")', qty: 1, amountPaise: 100 }] },
        bar: { tabsSettled: 0, revenuePaise: 0, averageTabPaise: 0, topItems: [] },
        inventory: { stockValuePaise: 0, unitsSold: 0, lowStock: [] },
        members: { newMembers: 0, activeMemberships: 0, expiringSoon: 0, byPlan: [] },
        payroll: { activeEmployees: 0, monthlyPayrollPaise: 0, pendingLeave: 0, byDepartment: [] },
      })
    );
    expect(csv).toContain('Bookings,Total,2,1500.5');
    expect(csv).toContain('Top products,"\'=HYPERLINK(""x"")",1,1');
  });
});

describe('Owner overview, exact counts and bounded previews (#87)', () => {
  it('counts every clocked-in shift beyond 500 historical rows, overnight included, and lists only live upcoming bookings', async (ctx) => {
    const { employees, staffShifts, bookings, courts, courtTypes } = await import('@packages/db');
    const { inArray, eq } = await import('drizzle-orm');
    if (!(await isDatabaseAvailable())) return ctx.skip();
    const app = buildApp();
    MembersFixtures.spreadClientIps(app);
    await app.ready();
    const fx = new MembersFixtures();
    const db = fx.db;
    const empIds: string[] = [];
    const bookingIds: string[] = [];
    let courtId: string | undefined;
    let typeId: string | undefined;
    try {
      const owner = await fx.actor(app, 'OWNER');
      const read = async () => OwnerOverviewSchema.parse((await app.inject({ method: 'GET', url: '/api/v1/reports/overview', headers: { cookie: owner.cookie } })).json());
      const before = await read();

      const [e] = await db.insert(employees).values({ fullName: 'Overview Night Owl', position: 'Bar', department: 'BAR', hiredOn: '2020-01-01' }).returning({ id: employees.id });
      empIds.push(e.id);
      const now = Date.now();
      // 520 closed historical shifts, one per day, far older than the roster cap would ever show.
      const history = Array.from({ length: 520 }, (_, i) => {
        const start = new Date(now - (30 + i) * 86_400_000);
        return { employeeId: e.id, roleLabel: 'BAR' as const, startsAt: start, endsAt: new Date(start.getTime() + 8 * 3_600_000), clockInAt: start, clockOutAt: new Date(start.getTime() + 8 * 3_600_000) };
      });
      for (let i = 0; i < history.length; i += 100) await db.insert(staffShifts).values(history.slice(i, i + 100));
      // One overnight shift that began yesterday evening and is still running.
      await db.insert(staffShifts).values({ employeeId: e.id, roleLabel: 'BAR', startsAt: new Date(now - 14 * 3_600_000), endsAt: new Date(now + 4 * 3_600_000), clockInAt: new Date(now - 14 * 3_600_000) });
      const after = await read();
      expect(after.staffOnShiftCount).toBe(before.staffOnShiftCount + 1);
      expect(after.staffOnShift.length).toBeLessThanOrEqual(12);

      // Bookings: a past one, a cancelled future one and a live future one; only the last may be previewed.
      const [type] = await db.insert(courtTypes).values({ code: `OV${Date.now()}`.slice(0, 30), name: 'Overview sport', baseRatePaise: 100, socialFeePaise: 0, trialFeePaise: 0 }).returning({ id: courtTypes.id });
      typeId = type.id;
      const [court] = await db.insert(courts).values({ courtTypeId: type.id, name: `Overview court ${Date.now()}` }).returning({ id: courts.id });
      courtId = court.id;
      const mk = async (offsetHours: number, status: 'CONFIRMED' | 'CANCELLED', who: string) => {
        const startsAt = new Date(now + offsetHours * 3_600_000);
        const [b] = await db.insert(bookings).values({ courtId: court.id, guestName: who, startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000), bookingDate: startsAt.toISOString().slice(0, 10), status, basePricePaise: 100, pricePaise: 100 }).returning({ id: bookings.id });
        bookingIds.push(b.id);
      };
      await mk(-5, 'CONFIRMED', 'Past Pat');
      await mk(3, 'CANCELLED', 'Cancelled Cal');
      await mk(6, 'CONFIRMED', 'Live Lee');
      const names = (await read()).upcomingBookings.map((b) => b.who);
      expect(names).toContain('Live Lee');
      expect(names).not.toContain('Past Pat');
      expect(names).not.toContain('Cancelled Cal');
      expect((await read()).upcomingBookings.length).toBeLessThanOrEqual(6);
    } finally {
      if (bookingIds.length) await db.delete(bookings).where(inArray(bookings.id, bookingIds));
      if (courtId) await db.delete(courts).where(eq(courts.id, courtId));
      if (typeId) await db.delete(courtTypes).where(eq(courtTypes.id, typeId));
      if (empIds.length) {
        await db.delete(staffShifts).where(inArray(staffShifts.employeeId, empIds));
        await db.delete(employees).where(inArray(employees.id, empIds));
      }
      await fx.cleanup();
      await app.close();
    }
  }, 120_000);
});

describe('Report detail exports and PDF (#91)', () => {
  it('serves row-level CSVs per area and a server PDF, with the same guards and limits as the dashboard', async (ctx) => {
    if (!(await isDatabaseAvailable())) return ctx.skip();
    const app = buildApp();
    MembersFixtures.spreadClientIps(app);
    await app.ready();
    const fx = new MembersFixtures();
    try {
      const owner = await fx.actor(app, 'OWNER');
      const desk = await fx.actor(app, 'FRONT_DESK');
      const bar = await fx.actor(app, 'BAR_STAFF');
      const member = await fx.actor(app, 'MEMBER');
      const get = (url: string, actor?: Actor) => app.inject({ method: 'GET', url, headers: actor ? { cookie: actor.cookie } : {} });
      const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
      const window = `from=${day(-30)}&to=${day(1)}`;
      const types = ['bookings', 'orders', 'bar', 'inventory', 'members', 'payroll'] as const;

      // Auth: 401 anonymous, 403 for every non-owner role, on CSV and PDF alike.
      for (const url of [...types.map((t) => `/api/v1/reports/export.csv?type=${t}&${window}`), `/api/v1/reports/export.pdf?${window}`, `/api/v1/reports/export.pdf?type=breakdown&${window}`]) {
        expect((await get(url)).statusCode, url).toBe(401);
        for (const actor of [desk, bar, member]) expect((await get(url, actor)).statusCode, url).toBe(403);
      }

      const headers: Record<string, string> = {
        bookings: 'Date,Starts,Ends,Court,Sport,Booked by,Status,Channel,Payment,Price (INR)',
        orders: 'Placed (club time),Order,Channel,Status,Payment,Customer,Total (INR)',
        bar: 'Settled (club time),Tab,Table,Guest,Subtotal (INR),Discount (INR),Total (INR)',
        inventory: 'When (club time),SKU,Product,Reason,Change,Balance after,Note',
        members: 'Member code,Name,Joined (club time),Current plan,Membership status,Ends on',
        payroll: 'Month,Run status,Employee,Department,Base (INR),Unpaid leave (INR),Bonus (INR),Other deductions (INR),Net (INR)',
      };
      for (const t of types) {
        const res = await get(`/api/v1/reports/export.csv?type=${t}&${window}`, owner);
        expect(res.statusCode, t).toBe(200);
        expect(res.headers['content-type']).toContain('text/csv');
        expect(res.headers['content-disposition']).toContain(`baseline-${t}-`);
        expect(res.body.split('\r\n')[0]).toBe(headers[t]);
      }

      // Validation: bad dates, reversed and over-long ranges, mixed range params, injection-looking input.
      for (const q of ['from=2030-02-30&to=2030-03-01', 'from=2030-03-02&to=2030-03-01', `from=${day(-400)}&to=${day(0)}`, 'range=today&from=2030-01-01&to=2030-01-02', "from=2030-01-01'; DROP TABLE payments;--&to=2030-01-02", 'type=bookings&range=year']) {
        const csv = await get(`/api/v1/reports/export.csv?type=bookings&${q}`, owner);
        expect(csv.statusCode, q).toBe(400);
        expect(csv.json().requestId).toBeTruthy();
        expect((await get(`/api/v1/reports/export.pdf?${q}`, owner)).statusCode, q).toBe(400);
      }
      expect((await get('/api/v1/reports/export.pdf?type=payments&range=today', owner)).statusCode).toBe(400);

      // Boundary: a one-day range works, and an empty period is a header-only file.
      expect((await get(`/api/v1/reports/export.csv?type=orders&from=${day(0)}&to=${day(0)}`, owner)).statusCode).toBe(200);
      const empty = await get('/api/v1/reports/export.csv?type=bookings&from=1999-01-01&to=1999-01-02', owner);
      expect(empty.body.trimEnd().split('\r\n')).toHaveLength(1);

      // PDF: real PDF bytes, attachment, stable content for the same data.
      for (const type of ['summary', 'breakdown']) {
        const pdf = await get(`/api/v1/reports/export.pdf?type=${type}&${window}`, owner);
        expect(pdf.statusCode, type).toBe(200);
        expect(pdf.headers['content-type']).toBe('application/pdf');
        expect(pdf.headers['content-disposition']).toMatch(/attachment; filename="baseline-.*\.pdf"/);
        expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
        expect(pdf.rawPayload.toString('latin1').trimEnd().endsWith('%%EOF')).toBe(true);
      }
      const a = (await get('/api/v1/reports/export.pdf?type=breakdown&from=1999-01-01&to=1999-01-02', owner)).rawPayload.toString('latin1').replace(/Generated [^)]*/, '');
      const b = (await get('/api/v1/reports/export.pdf?type=breakdown&from=1999-01-01&to=1999-01-02', owner)).rawPayload.toString('latin1').replace(/Generated [^)]*/, '');
      expect(a.replace(/\/Length \d+/, '')).toBe(b.replace(/\/Length \d+/, ''));
    } finally {
      await fx.cleanup();
      await app.close();
    }
  }, 120_000);
});
