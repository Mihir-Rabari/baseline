import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { employees, leaveRequests, notifications, payrollRuns, payslips, shiftSwaps, staffShifts } from '@packages/db';
import {
  ColleagueListSchema,
  EmployeeListSchema,
  EmployeeSchema,
  LeaveRequestSchema,
  ShiftListSchema,
  MyLeavePageSchema,
  PayrollRunDetailSchema,
  ShiftSwapListSchema,
  ShiftSwapSchema,
} from '@packages/validation';
import { buildApp } from '../../../apps/api/src/app.js';
import { isDatabaseAvailable } from '../../../apps/api/src/test-support/database.js';
import { MembersFixtures, type Actor } from '../../../apps/api/src/test-support/members-fixtures.js';
import { clipDays } from '../../../apps/api/src/services/hr.service.js';
import { clubDateOf } from '../../../apps/api/src/services/time.js';

const NO_SUCH_UUID = '00000000-0000-4000-8000-0000000000fa';
const HOUR = 3_600_000;

describe('clipDays (unit)', () => {
  it('counts only the days of a range that fall inside a window', () => {
    expect(clipDays('2031-12-30', '2032-01-02', '2031-01-01', '2031-12-31')).toBe(2);
    expect(clipDays('2031-12-30', '2032-01-02', '2032-01-01', '2032-12-31')).toBe(2);
    expect(clipDays('2031-05-01', '2031-05-10', '2031-05-01', '2031-05-31')).toBe(10);
    expect(clipDays('2031-04-01', '2031-04-10', '2031-05-01', '2031-05-31')).toBe(0);
    expect(clipDays('2031-06-01', '2031-06-10', '2031-05-01', '2031-05-31')).toBe(0);
  });
});

describe('Shift swaps, leave balances, payroll suggestions and the staff directory (#66)', () => {
  let app: FastifyInstance;
  let hasDatabase = false;
  const fx = new MembersFixtures();
  let tz = 'Asia/Kolkata';
  let owner: Actor;
  let desk: Actor; // front desk, linked to empB
  let ann: Actor; // bar staff, linked to empA
  let cat: Actor; // bar staff, linked to empC (a bystander)
  let member: Actor;
  let empA: { id: string };
  let empB: { id: string };
  let empC: { id: string };
  const empIds: string[] = [];
  const runIds: string[] = [];
  let slotCounter = 0;

  const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, actor?: Actor, payload?: object) =>
    app.inject({ method, url: `/api/v1${url}`, headers: actor ? { cookie: actor.cookie } : {}, ...(payload ? { payload } : {}) });

  async function employee(name: string, extra: Partial<typeof employees.$inferInsert> = {}) {
    const [row] = await fx.db
      .insert(employees)
      .values({ fullName: `${name} ${randomUUID().slice(0, 4)}`, position: 'Tester', department: 'BAR', monthlySalaryPaise: 3_000_000, hiredOn: '1980-01-01', ...extra })
      .returning();
    empIds.push(row.id);
    return row;
  }

  /** A shift two hours long in its own 5-hour slot, so shifts made by different tests never overlap by accident. */
  async function shift(employeeId: string, opts: { slot?: number; offsetMin?: number; startsAt?: Date } = {}) {
    const slot = opts.slot ?? ++slotCounter;
    const startsAt = opts.startsAt ?? new Date(Date.now() + 3 * HOUR + slot * 5 * HOUR + (opts.offsetMin ?? 0) * 60_000);
    const [row] = await fx.db
      .insert(staffShifts)
      .values({ employeeId, roleLabel: 'BAR', startsAt, endsAt: new Date(startsAt.getTime() + 2 * HOUR) })
      .returning();
    return row;
  }

  const propose = (actor: Actor | undefined, body: object) => call('POST', '/me/shift-swaps', actor, body);
  const respond = (actor: Actor | undefined, id: string, response: 'ACCEPT' | 'DECLINE') => call('POST', `/me/shift-swaps/${id}/respond`, actor, { response });
  const decide = (actor: Actor | undefined, id: string, decision: 'APPROVED' | 'REJECTED', note?: string) => call('POST', `/shift-swaps/${id}/decision`, actor, { decision, ...(note ? { note } : {}) });
  const owner_of = async (shiftId: string) => (await fx.db.select({ e: staffShifts.employeeId }).from(staffShifts).where(eq(staffShifts.id, shiftId)))[0]?.e;
  const swapStatus = async (id: string) => (await fx.db.select({ s: shiftSwaps.status }).from(shiftSwaps).where(eq(shiftSwaps.id, id)))[0]?.s;
  const told = async (userId: string, type = 'SHIFT_SWAP') => fx.db.select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.type, type as never)));

  /** A swap that the colleague has accepted and that now waits for the owner. */
  async function acceptedSwap(body: (a: { id: string }, b: { id: string }) => Promise<object> | object) {
    const mine = await shift(empA.id);
    const theirs = await shift(empB.id);
    const created = await propose(ann, await body(mine, theirs));
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().id as string;
    expect((await respond(desk, id, 'ACCEPT')).statusCode).toBe(200);
    return { id, mine, theirs };
  }

  beforeAll(async () => {
    app = buildApp();
    MembersFixtures.spreadClientIps(app);
    await app.ready();
    hasDatabase = await isDatabaseAvailable();
    if (!hasDatabase) return;
    tz = app.env.CLUB_TIMEZONE;
    owner = await fx.actor(app, 'OWNER');
    desk = await fx.actor(app, 'FRONT_DESK');
    ann = await fx.actor(app, 'BAR_STAFF');
    cat = await fx.actor(app, 'BAR_STAFF');
    member = await fx.actor(app, 'MEMBER');
    empA = await employee('Swap Ann', { userId: ann.id });
    empB = await employee('Swap Bob', { userId: desk.id, department: 'FRONT_DESK' });
    empC = await employee('Swap Cat', { userId: cat.id });
  });

  afterAll(async () => {
    if (hasDatabase) {
      if (runIds.length) await fx.db.delete(payrollRuns).where(inArray(payrollRuns.id, runIds));
      if (empIds.length) {
        await fx.db.delete(payslips).where(inArray(payslips.employeeId, empIds));
        await fx.db.delete(employees).where(inArray(employees.id, empIds)); // shifts, swaps and leave cascade
      }
      await fx.cleanup();
    }
    await app.close();
  });

  // ============================================================== shift swaps
  describe('shift swaps: authentication, authorization and validation', () => {
    it('401 without a session on every swap route', async () => {
      const valid = { shiftId: NO_SUCH_UUID, targetEmployeeId: NO_SUCH_UUID };
      expect((await call('GET', '/me/shift-swaps')).statusCode).toBe(401);
      expect((await propose(undefined, valid)).statusCode).toBe(401);
      expect((await respond(undefined, NO_SUCH_UUID, 'ACCEPT')).statusCode).toBe(401);
      expect((await call('POST', `/me/shift-swaps/${NO_SUCH_UUID}/cancel`)).statusCode).toBe(401);
      expect((await call('GET', '/shift-swaps')).statusCode).toBe(401);
      expect((await decide(undefined, NO_SUCH_UUID, 'APPROVED')).statusCode).toBe(401);
    });

    it('403: members cannot take part; staff cannot list all swaps or decide (privilege escalation)', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const { id } = await acceptedSwap((a, b) => ({ shiftId: a.id, targetEmployeeId: empB.id, requestedShiftId: b.id }));
      expect((await call('GET', '/me/shift-swaps', member)).statusCode).toBe(403);
      expect((await propose(member, { shiftId: NO_SUCH_UUID, targetEmployeeId: empB.id })).statusCode).toBe(403);
      expect((await respond(member, id, 'ACCEPT')).statusCode).toBe(403);
      for (const actor of [ann, desk, cat, member]) {
        expect((await call('GET', '/shift-swaps', actor)).statusCode).toBe(403);
        expect((await decide(actor, id, 'APPROVED')).statusCode).toBe(403);
        expect((await decide(actor, id, 'REJECTED')).statusCode).toBe(403);
      }
      expect(await swapStatus(id)).toBe('ACCEPTED');
    });

    it('400 for malformed bodies, ids and filters', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      expect((await propose(ann, {})).statusCode).toBe(400);
      expect((await propose(ann, { shiftId: 'nope', targetEmployeeId: empB.id })).statusCode).toBe(400);
      expect((await propose(ann, { shiftId: NO_SUCH_UUID, targetEmployeeId: empB.id, note: 'x'.repeat(501) })).statusCode).toBe(400);
      expect((await respond(desk, NO_SUCH_UUID, 'MAYBE' as never)).statusCode).toBe(400);
      expect((await call('POST', '/me/shift-swaps/not-a-uuid/respond', desk, { response: 'ACCEPT' })).statusCode).toBe(400);
      expect((await call('POST', '/shift-swaps/not-a-uuid/decision', owner, { decision: 'APPROVED' })).statusCode).toBe(400);
      expect((await decide(owner, NO_SUCH_UUID, 'MAYBE' as never)).statusCode).toBe(400);
      expect((await call('GET', '/shift-swaps?status=BOGUS', owner)).statusCode).toBe(400);
    });

    it('404 for unknown swaps, shifts and colleagues', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      expect((await respond(desk, NO_SUCH_UUID, 'ACCEPT')).statusCode).toBe(404);
      expect((await call('POST', `/me/shift-swaps/${NO_SUCH_UUID}/cancel`, ann)).statusCode).toBe(404);
      expect((await decide(owner, NO_SUCH_UUID, 'APPROVED')).statusCode).toBe(404);
      const mine = await shift(empA.id);
      expect((await propose(ann, { shiftId: NO_SUCH_UUID, targetEmployeeId: empB.id })).statusCode).toBe(404);
      expect((await propose(ann, { shiftId: mine.id, targetEmployeeId: NO_SUCH_UUID })).statusCode).toBe(404);
      expect((await propose(ann, { shiftId: mine.id, targetEmployeeId: empB.id, requestedShiftId: NO_SUCH_UUID })).statusCode).toBe(404);
    });
  });

  describe('shift swaps: the proposal rules', () => {
    it('offers a shift, notifies the colleague and lists the swap for both people only', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const mine = await shift(empA.id);
      const res = await propose(ann, { shiftId: mine.id, targetEmployeeId: empB.id, note: 'Dentist' });
      expect(res.statusCode, res.body).toBe(201);
      const swap = ShiftSwapSchema.parse(res.json());
      expect(swap).toMatchObject({ status: 'PENDING', requestedShift: null, note: 'Dentist', shift: { id: mine.id }, proposer: { id: empA.id }, target: { id: empB.id } });
      expect((await told(desk.id)).some((n) => (n.data as { swapId?: string })?.swapId === swap.id)).toBe(true);

      for (const [actor, side] of [[ann, 'PROPOSER'], [desk, 'TARGET']] as const) {
        const list = ShiftSwapListSchema.parse((await call('GET', '/me/shift-swaps', actor)).json());
        expect(list.map((s) => s.id)).toContain(swap.id);
        expect(list.find((s) => s.id === swap.id)?.role).toBe(side);
      }
      // A bystander does not see it, and cannot answer or withdraw it.
      expect((await call('GET', '/me/shift-swaps', cat)).json().map((s: { id: string }) => s.id)).not.toContain(swap.id);
      expect((await respond(cat, swap.id, 'ACCEPT')).statusCode).toBe(403);
      expect((await call('POST', `/me/shift-swaps/${swap.id}/cancel`, cat)).statusCode).toBe(403);
      expect((await call('POST', `/me/shift-swaps/${swap.id}/cancel`, desk)).statusCode).toBe(403);
      expect(await swapStatus(swap.id)).toBe('PENDING');
    });

    it("cannot offer someone else's shift (403), offer to yourself, or ask for a shift that is not theirs (422)", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const mine = await shift(empA.id);
      const bobs = await shift(empB.id);
      const cats = await shift(empC.id);
      expect((await propose(ann, { shiftId: bobs.id, targetEmployeeId: empC.id })).statusCode).toBe(403);
      expect((await propose(desk, { shiftId: mine.id, targetEmployeeId: empA.id })).statusCode).toBe(403);
      expect((await propose(ann, { shiftId: mine.id, targetEmployeeId: empA.id })).statusCode).toBe(422);
      expect((await propose(ann, { shiftId: mine.id, targetEmployeeId: empB.id, requestedShiftId: cats.id })).statusCode).toBe(422);
      expect((await fx.db.select().from(shiftSwaps).where(eq(shiftSwaps.shiftId, mine.id))).length).toBe(0);
    });

    it('409 for a shift that has started or been clocked into, and for an employee with no login linked', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const past = await shift(empA.id, { startsAt: new Date(Date.now() - HOUR) });
      expect((await propose(ann, { shiftId: past.id, targetEmployeeId: empB.id })).json().code).toBe('SHIFT_STARTED');
      const clocked = await shift(empA.id);
      await fx.db.update(staffShifts).set({ clockInAt: new Date() }).where(eq(staffShifts.id, clocked.id));
      expect((await propose(ann, { shiftId: clocked.id, targetEmployeeId: empB.id })).statusCode).toBe(409);
      // The owner has no employee record, so they have no shifts to offer.
      expect((await propose(owner, { shiftId: clocked.id, targetEmployeeId: empB.id })).statusCode).toBeGreaterThanOrEqual(403);
    });

    it('409 SWAP_PENDING for a second open request on the same shift, even when two arrive together', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const mine = await shift(empA.id);
      const results = await Promise.all([
        propose(ann, { shiftId: mine.id, targetEmployeeId: empB.id }),
        propose(ann, { shiftId: mine.id, targetEmployeeId: empC.id }),
      ]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
      expect((await fx.db.select().from(shiftSwaps).where(eq(shiftSwaps.shiftId, mine.id))).length).toBe(1);
      expect((await propose(ann, { shiftId: mine.id, targetEmployeeId: empB.id })).json().code).toBe('SWAP_PENDING');
      // The colleague's shift is also locked into the open request.
      const bobs = await shift(empB.id);
      const first = await propose(ann, { shiftId: (await shift(empA.id)).id, targetEmployeeId: empB.id, requestedShiftId: bobs.id });
      expect(first.statusCode).toBe(201);
      expect((await propose(cat, { shiftId: (await shift(empC.id)).id, targetEmployeeId: empB.id, requestedShiftId: bobs.id })).json().code).toBe('SWAP_PENDING');
    });

    it('409 SHIFT_OVERLAP when the colleague already works then, or when the two swapped shifts overlap each other', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const mine = await shift(empA.id);
      await shift(empB.id, { startsAt: new Date(mine.startsAt.getTime() + 30 * 60_000) });
      const res = await propose(ann, { shiftId: mine.id, targetEmployeeId: empB.id });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('SHIFT_OVERLAP');

      const a2 = await shift(empA.id);
      const b2 = await shift(empB.id, { startsAt: new Date(a2.startsAt.getTime() + 60 * 60_000) }); // overlaps a2 by an hour
      expect((await propose(ann, { shiftId: a2.id, targetEmployeeId: empB.id, requestedShiftId: b2.id })).json().code).toBe('SHIFT_OVERLAP');
    });

    it('409 ON_LEAVE when the colleague is on approved leave that day, and EMPLOYEE_INACTIVE for a deactivated colleague', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const away = await employee('Swap Away', { userId: null });
      const mine = await shift(empA.id);
      const day = clubDateOf(mine.startsAt, tz);
      await fx.db.insert(leaveRequests).values({ employeeId: away.id, leaveType: 'CASUAL', fromDate: day, toDate: day, status: 'APPROVED' });
      expect((await propose(ann, { shiftId: mine.id, targetEmployeeId: away.id })).json().code).toBe('ON_LEAVE');

      const gone = await employee('Swap Gone', { status: 'INACTIVE' });
      expect((await propose(ann, { shiftId: mine.id, targetEmployeeId: gone.id })).json().code).toBe('EMPLOYEE_INACTIVE');
    });
  });

  describe('shift swaps: answering, approving and overriding', () => {
    it('the colleague declines: closed, the proposer is told, the shift stays put, and it cannot be answered again', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const mine = await shift(empA.id);
      const id = (await propose(ann, { shiftId: mine.id, targetEmployeeId: empB.id })).json().id as string;
      const res = await respond(desk, id, 'DECLINE');
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toMatchObject({ status: 'DECLINED' });
      expect(res.json().respondedAt).not.toBeNull();
      expect((await told(ann.id)).some((n) => n.title === 'Swap declined')).toBe(true);
      expect(await owner_of(mine.id)).toBe(empA.id);
      expect((await respond(desk, id, 'ACCEPT')).json().code).toBe('SWAP_NOT_PENDING');
      expect((await decide(owner, id, 'APPROVED')).json().code).toBe('SWAP_NOT_OPEN');
      // The shift is free to be offered again.
      expect((await propose(ann, { shiftId: mine.id, targetEmployeeId: empC.id })).statusCode).toBe(201);
    });

    it('the proposer cannot answer their own request (403), and the owner cannot approve before the colleague accepts', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const mine = await shift(empA.id);
      const id = (await propose(ann, { shiftId: mine.id, targetEmployeeId: empB.id })).json().id as string;
      expect((await respond(ann, id, 'ACCEPT')).statusCode).toBe(403);
      const early = await decide(owner, id, 'APPROVED');
      expect(early.statusCode).toBe(409);
      expect(early.json().code).toBe('SWAP_NOT_ACCEPTED');
      expect(await owner_of(mine.id)).toBe(empA.id);
    });

    it('a handover: after the colleague accepts, the owner approves and the shift moves; both people and the owner are told', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const mine = await shift(empA.id);
      const id = (await propose(ann, { shiftId: mine.id, targetEmployeeId: empB.id })).json().id as string;
      const accepted = await respond(desk, id, 'ACCEPT');
      expect(accepted.json().status).toBe('ACCEPTED');
      expect((await told(owner.id)).some((n) => n.title === 'Shift swap needs approval')).toBe(true);
      expect(await owner_of(mine.id)).toBe(empA.id); // nothing moves before the owner decides

      const approved = await decide(owner, id, 'APPROVED', 'Fine by me');
      expect(approved.statusCode, approved.body).toBe(200);
      expect(approved.json()).toMatchObject({ status: 'APPROVED', decisionNote: 'Fine by me' });
      expect(await owner_of(mine.id)).toBe(empB.id);
      expect((await told(ann.id)).some((n) => n.title === 'Swap approved')).toBe(true);
      expect((await told(desk.id)).some((n) => n.title === 'Swap approved')).toBe(true);

      // Approving again, or overriding after the fact, is a 409 and changes nothing.
      expect((await decide(owner, id, 'APPROVED')).json().code).toBe('SWAP_NOT_OPEN');
      expect((await decide(owner, id, 'REJECTED')).json().code).toBe('SWAP_NOT_OPEN');
      expect(await owner_of(mine.id)).toBe(empB.id);
      // The new owner of the shift can roster-view it.
      const roster = (await call('GET', '/shifts', desk)).json() as Array<{ id: string; employee: { id: string } }>;
      expect(roster.find((s) => s.id === mine.id)?.employee.id).toBe(empB.id);
    });

    it('a true exchange moves both shifts at once', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const { id, mine, theirs } = await acceptedSwap((a, b) => ({ shiftId: a.id, targetEmployeeId: empB.id, requestedShiftId: b.id }));
      const res = await decide(owner, id, 'APPROVED');
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().requestedShift.id).toBe(theirs.id);
      expect(await owner_of(mine.id)).toBe(empB.id);
      expect(await owner_of(theirs.id)).toBe(empA.id);
    });

    it('is atomic: if the second move would double-book someone, neither shift moves and the swap stays open', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const { id, mine, theirs } = await acceptedSwap((a, b) => ({ shiftId: a.id, targetEmployeeId: empB.id, requestedShiftId: b.id }));
      // After the request was accepted, Ann is rostered on a shift that overlaps the one she would take.
      const clash = await shift(empA.id, { startsAt: new Date(theirs.startsAt.getTime() + 30 * 60_000) });
      const res = await decide(owner, id, 'APPROVED');
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('SHIFT_OVERLAP');
      expect(await owner_of(mine.id)).toBe(empA.id);
      expect(await owner_of(theirs.id)).toBe(empB.id);
      expect(await owner_of(clash.id)).toBe(empA.id);
      expect(await swapStatus(id)).toBe('ACCEPTED');
      expect((await told(ann.id)).some((n) => n.title === 'Swap approved' && (n.data as { swapId?: string })?.swapId === id)).toBe(false);
    });

    it('409 SWAP_STALE or SHIFT_STARTED when a shift changed after the swap was agreed', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const reassigned = await acceptedSwap((a) => ({ shiftId: a.id, targetEmployeeId: empB.id }));
      await fx.db.update(staffShifts).set({ employeeId: empC.id }).where(eq(staffShifts.id, reassigned.mine.id));
      expect((await decide(owner, reassigned.id, 'APPROVED')).json().code).toBe('SWAP_STALE');
      expect(await owner_of(reassigned.mine.id)).toBe(empC.id);

      const started = await acceptedSwap((a) => ({ shiftId: a.id, targetEmployeeId: empB.id }));
      await fx.db.update(staffShifts).set({ clockInAt: new Date() }).where(eq(staffShifts.id, started.mine.id));
      expect((await decide(owner, started.id, 'APPROVED')).json().code).toBe('SHIFT_STARTED');
      expect(await owner_of(started.mine.id)).toBe(empA.id);
    });

    it('409 EMPLOYEE_INACTIVE when someone is deactivated before approval, and approval works again once reactivated', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const { id, mine } = await acceptedSwap((a) => ({ shiftId: a.id, targetEmployeeId: empB.id }));
      expect((await call('PUT', `/hr/employees/${empB.id}`, owner, { status: 'INACTIVE' })).statusCode).toBe(200);
      expect((await decide(owner, id, 'APPROVED')).json().code).toBe('EMPLOYEE_INACTIVE');
      expect(await owner_of(mine.id)).toBe(empA.id);
      expect((await call('PUT', `/hr/employees/${empB.id}`, owner, { status: 'ACTIVE' })).statusCode).toBe(200);
      expect((await decide(owner, id, 'APPROVED')).statusCode).toBe(200);
      expect(await owner_of(mine.id)).toBe(empB.id);
    });

    it('the owner can override: reject an accepted or a still-pending swap, and the colleague and proposer are told', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const { id, mine } = await acceptedSwap((a) => ({ shiftId: a.id, targetEmployeeId: empB.id }));
      const rejected = await decide(owner, id, 'REJECTED', 'Short staffed that night');
      expect(rejected.statusCode, rejected.body).toBe(200);
      expect(rejected.json()).toMatchObject({ status: 'REJECTED', decisionNote: 'Short staffed that night' });
      expect(await owner_of(mine.id)).toBe(empA.id);
      expect((await told(desk.id)).some((n) => n.title === 'Swap not approved')).toBe(true);

      const pendingShift = await shift(empA.id);
      const pending = (await propose(ann, { shiftId: pendingShift.id, targetEmployeeId: empB.id })).json().id as string;
      expect((await decide(owner, pending, 'REJECTED')).json().status).toBe('REJECTED');
      expect((await respond(desk, pending, 'ACCEPT')).json().code).toBe('SWAP_NOT_PENDING');
    });

    it('the proposer can withdraw an open swap, once', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const mine = await shift(empA.id);
      const id = (await propose(ann, { shiftId: mine.id, targetEmployeeId: empB.id })).json().id as string;
      const res = await call('POST', `/me/shift-swaps/${id}/cancel`, ann);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().status).toBe('CANCELLED');
      expect((await told(desk.id)).some((n) => n.title === 'Swap withdrawn')).toBe(true);
      expect((await call('POST', `/me/shift-swaps/${id}/cancel`, ann)).json().code).toBe('SWAP_NOT_OPEN');
      expect((await respond(desk, id, 'ACCEPT')).json().code).toBe('SWAP_NOT_PENDING');
    });

    it('the owner can list swaps and filter by status', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const { id } = await acceptedSwap((a) => ({ shiftId: a.id, targetEmployeeId: empB.id }));
      const all = ShiftSwapListSchema.parse((await call('GET', '/shift-swaps', owner)).json());
      expect(all.map((s) => s.id)).toContain(id);
      const accepted = ShiftSwapListSchema.parse((await call('GET', '/shift-swaps?status=ACCEPTED', owner)).json());
      expect(accepted.every((s) => s.status === 'ACCEPTED')).toBe(true);
      expect(accepted.map((s) => s.id)).toContain(id);
      expect((await call('GET', '/shift-swaps?status=DECLINED', owner)).json().map((s: { id: string }) => s.id)).not.toContain(id);
    });
  });

  describe('swap helpers: colleagues and upcoming shifts', () => {
    it('401 without a session and 403 for members', async () => {
      for (const url of ['/me/colleagues', '/me/shifts/upcoming']) expect((await call('GET', url)).statusCode, url).toBe(401);
      if (!hasDatabase) return;
      for (const url of ['/me/colleagues', '/me/shifts/upcoming']) expect((await call('GET', url, member)).statusCode, url).toBe(403);
    });

    it('lists active colleagues other than yourself', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const gone = await employee('Swap Retired', { status: 'INACTIVE' });
      const res = await call('GET', '/me/colleagues', ann);
      expect(res.statusCode, res.body).toBe(200);
      const list = ColleagueListSchema.parse(res.json());
      expect(list.map((c) => c.id)).toEqual(expect.arrayContaining([empB.id, empC.id]));
      expect(list.map((c) => c.id)).not.toContain(empA.id);
      expect(list.map((c) => c.id)).not.toContain(gone.id);
      expect(JSON.stringify(res.json())).not.toContain('monthlySalaryPaise');
      // An account without an employee record has no colleagues to offer shifts to.
      expect((await call('GET', '/me/colleagues', owner)).json()).toEqual([]);
    });

    it('lists only your own shifts that can still be offered', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const free = await shift(empA.id);
      const started = await shift(empA.id);
      await fx.db.update(staffShifts).set({ clockInAt: new Date() }).where(eq(staffShifts.id, started.id));
      const past = await shift(empA.id, { startsAt: new Date(Date.now() - 5 * HOUR) });
      const offered = await shift(empA.id);
      expect((await propose(ann, { shiftId: offered.id, targetEmployeeId: empB.id })).statusCode).toBe(201);
      const theirs = await shift(empB.id);

      const res = await call('GET', '/me/shifts/upcoming', ann);
      expect(res.statusCode, res.body).toBe(200);
      const ids = ShiftListSchema.parse(res.json()).map((s) => s.id);
      expect(ids).toContain(free.id);
      for (const excluded of [started.id, past.id, offered.id, theirs.id]) expect(ids).not.toContain(excluded);
      expect((await call('GET', '/me/shifts/upcoming', owner)).json()).toEqual([]);
    });
  });

  // ============================================================ leave balances
  describe('leave balances', () => {
    let worker: Actor;
    let workerEmp: { id: string };
    let idle: Actor; // an employee login with no leave taken
    let year = 2040;

    beforeAll(async (ctx) => {
      if (!hasDatabase) return;
      worker = await fx.actor(app, 'BAR_STAFF');
      workerEmp = await employee('Leave Wanda', { userId: worker.id });
      idle = await fx.actor(app, 'FRONT_DESK');
      await employee('Leave Idle', { userId: idle.id });
      void ctx;
    });

    const nextYear = () => (year += 3); // a gap, because one test spans two years
    const ask = (actor: Actor, fromDate: string, toDate: string, leaveType = 'CASUAL') => call('POST', '/me/leave', actor, { leaveType, fromDate, toDate });
    const setAllowance = (id: string, days: number) => call('PUT', `/hr/employees/${id}`, owner, { leaveAllowanceDays: days });

    it('GET /me/leave returns the balance for this year: allowance, taken, pending and remaining', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const thisYear = Number(clubDateOf(new Date(), tz).slice(0, 4));
      await setAllowance(workerEmp.id, 10);
      await fx.db.insert(leaveRequests).values([
        { employeeId: workerEmp.id, leaveType: 'CASUAL', fromDate: `${thisYear}-02-01`, toDate: `${thisYear}-02-03`, status: 'APPROVED' },
        { employeeId: workerEmp.id, leaveType: 'SICK', fromDate: `${thisYear}-03-01`, toDate: `${thisYear}-03-02`, status: 'PENDING' },
        { employeeId: workerEmp.id, leaveType: 'SICK', fromDate: `${thisYear}-04-01`, toDate: `${thisYear}-04-05`, status: 'REJECTED' },
        { employeeId: workerEmp.id, leaveType: 'SICK', fromDate: `${thisYear}-05-01`, toDate: `${thisYear}-05-05`, status: 'CANCELLED' },
      ]);
      const res = await call('GET', '/me/leave', worker);
      expect(res.statusCode, res.body).toBe(200);
      const page = MyLeavePageSchema.parse(res.json());
      expect(page.balance).toEqual({ year: thisYear, allowanceDays: 10, takenDays: 3, pendingDays: 2, remainingDays: 5 });
      expect(page.data.length).toBe(4);
    });

    it('the balance is null for an account with no employee record, and each person only sees their own', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const noRecord = await call('GET', '/me/leave', owner);
      expect(noRecord.statusCode).toBe(200);
      expect(noRecord.json()).toMatchObject({ data: [], balance: null });
      const idleBalance = (await call('GET', '/me/leave', idle)).json().balance;
      expect(idleBalance).toMatchObject({ allowanceDays: 24, takenDays: 0, pendingDays: 0, remainingDays: 24 });
      expect((await call('GET', '/me/leave', member)).statusCode).toBe(403);
      expect((await call('GET', '/me/leave')).statusCode).toBe(401);
    });

    it('422 LEAVE_BALANCE_EXCEEDED for a request over the allowance; exactly the allowance is fine; pending counts, rejected does not', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const y = nextYear();
      await setAllowance(workerEmp.id, 5);
      const over = await ask(worker, `${y}-03-01`, `${y}-03-06`);
      expect(over.statusCode).toBe(422);
      expect(over.json().code).toBe('LEAVE_BALANCE_EXCEEDED');
      expect(over.json().message).toContain('5-day allowance');

      const exact = await ask(worker, `${y}-03-01`, `${y}-03-05`);
      expect(exact.statusCode, exact.body).toBe(201);
      // The pending request already uses the whole allowance, so one more day is refused.
      expect((await ask(worker, `${y}-04-01`, `${y}-04-01`)).statusCode).toBe(422);
      // Once the owner rejects it, those days are free again.
      expect((await call('POST', `/hr/leave/${exact.json().id}/decision`, owner, { decision: 'REJECTED' })).statusCode).toBe(200);
      expect((await ask(worker, `${y}-04-01`, `${y}-04-01`)).statusCode).toBe(201);
    });

    it('is counted per calendar year: a December to January request uses each year\'s allowance', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const y = nextYear();
      await setAllowance(workerEmp.id, 3);
      const fits = await ask(worker, `${y}-12-29`, `${y + 1}-01-02`); // 3 days in y and 2 in y+1: each year is within 3
      expect(fits.statusCode, fits.body).toBe(201);
      expect((await ask(worker, `${y + 1}-02-01`, `${y + 1}-02-02`)).statusCode).toBe(422); // 2 + 2 = 4 in y+1
      expect((await ask(worker, `${y}-11-01`, `${y}-11-01`)).statusCode).toBe(422); // 3 + 1 = 4 in y
      expect((await ask(worker, `${y + 1}-02-01`, `${y + 1}-02-01`)).statusCode).toBe(201); // 2 + 1 = 3 in y+1
    });

    it('422 for an absurdly long request, and 400 for dates in the wrong order', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      await setAllowance(workerEmp.id, 366);
      const y = 2090; // far from every other test's leave, so only the length rule can refuse it
      expect((await ask(worker, `${y}-01-01`, `${y + 3}-01-01`)).statusCode).toBe(422);
      expect((await ask(worker, `${y}-02-10`, `${y}-02-09`)).statusCode).toBe(400);
    });

    it('approval re-checks the allowance: lowering it blocks approval (422) and raising it lets the request through', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const y = nextYear();
      await setAllowance(workerEmp.id, 6);
      const req = await ask(worker, `${y}-06-01`, `${y}-06-05`);
      expect(req.statusCode, req.body).toBe(201);
      await setAllowance(workerEmp.id, 4);
      const blocked = await call('POST', `/hr/leave/${req.json().id}/decision`, owner, { decision: 'APPROVED' });
      expect(blocked.statusCode).toBe(422);
      expect(blocked.json().code).toBe('LEAVE_BALANCE_EXCEEDED');
      expect((await fx.db.select({ s: leaveRequests.status }).from(leaveRequests).where(eq(leaveRequests.id, req.json().id)))[0].s).toBe('PENDING');
      await setAllowance(workerEmp.id, 5);
      const approved = await call('POST', `/hr/leave/${req.json().id}/decision`, owner, { decision: 'APPROVED' });
      expect(approved.statusCode, approved.body).toBe(200);
      expect(LeaveRequestSchema.parse(approved.json()).status).toBe('APPROVED');
      // Rejecting never needs balance.
      await setAllowance(workerEmp.id, 0);
      const other = await ask(worker, `${y}-07-01`, `${y}-07-01`);
      expect(other.statusCode).toBe(422);
    });

    it('the owner edits the yearly allowance and the employee list shows allowance and remaining days', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const e = await employee('Leave Lena');
      const set = await setAllowance(e.id, 30);
      expect(set.statusCode, set.body).toBe(200);
      expect(EmployeeSchema.parse(set.json())).toMatchObject({ leaveAllowanceDays: 30, leaveRemainingDays: 30 });
      const thisYear = Number(clubDateOf(new Date(), tz).slice(0, 4));
      await fx.db.insert(leaveRequests).values({ employeeId: e.id, leaveType: 'CASUAL', fromDate: `${thisYear}-08-01`, toDate: `${thisYear}-08-04`, status: 'APPROVED' });
      const row = EmployeeListSchema.parse((await call('GET', '/hr/employees', owner)).json()).find((x) => x.id === e.id)!;
      expect(row).toMatchObject({ leaveAllowanceDays: 30, leaveDaysThisYear: 4, leaveRemainingDays: 26 });
      const profile = (await call('GET', `/hr/employees/${e.id}`, owner)).json();
      expect(profile).toMatchObject({ leaveAllowanceDays: 30, leaveRemainingDays: 26 });
      // A new employee can be created with an allowance, and defaults to 24.
      const created = await call('POST', '/hr/employees', owner, { fullName: `Leave New ${randomUUID().slice(0, 4)}`, position: 'Coach', department: 'COACHING', monthlySalaryPaise: 1_000_000, hiredOn: '2026-01-01', leaveAllowanceDays: 12 });
      expect(created.statusCode, created.body).toBe(201);
      empIds.push(created.json().id);
      expect(created.json()).toMatchObject({ leaveAllowanceDays: 12, leaveRemainingDays: 12 });
      const defaulted = await call('POST', '/hr/employees', owner, { fullName: `Leave Def ${randomUUID().slice(0, 4)}`, position: 'Coach', department: 'COACHING', monthlySalaryPaise: 1_000_000, hiredOn: '2026-01-01' });
      empIds.push(defaulted.json().id);
      expect(defaulted.json().leaveAllowanceDays).toBe(24);
    });

    it('only the owner can change an allowance (403), and invalid allowances are 400', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      for (const actor of [desk, ann, member, worker]) {
        expect((await call('PUT', `/hr/employees/${workerEmp.id}`, actor, { leaveAllowanceDays: 365 })).statusCode).toBe(403);
      }
      expect((await call('PUT', `/hr/employees/${workerEmp.id}`, undefined, { leaveAllowanceDays: 365 })).statusCode).toBe(401);
      for (const bad of [-1, 367, 1.5, '10', null]) {
        expect((await call('PUT', `/hr/employees/${workerEmp.id}`, owner, { leaveAllowanceDays: bad })).statusCode, String(bad)).toBe(400);
      }
      expect((await call('PUT', `/hr/employees/${NO_SUCH_UUID}`, owner, { leaveAllowanceDays: 10 })).statusCode).toBe(404);
    });
  });

  // ======================================================== payroll suggestion
  describe('payroll suggests unpaid leave days', () => {
    const payYear = 2000 + Math.floor(Math.random() * 12);
    const month = (m: number) => `${payYear}-${String(m).padStart(2, '0')}`;
    const runFor = async (m: number) => {
      const res = await call('POST', '/hr/payroll/runs', owner, { month: month(m) });
      expect(res.statusCode, res.body).toBe(201);
      const run = PayrollRunDetailSchema.parse(res.json());
      runIds.push(run.id);
      return run;
    };

    it('suggests the days beyond the yearly allowance, counting earlier months, without applying them; the owner can override', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const within = await employee('Pay Within', { leaveAllowanceDays: 5 });
      const over = await employee('Pay Over', { leaveAllowanceDays: 5 });
      const earlier = await employee('Pay Earlier', { leaveAllowanceDays: 5 });
      const none = await employee('Pay None', { leaveAllowanceDays: 5 });
      await fx.db.insert(leaveRequests).values([
        { employeeId: within.id, leaveType: 'CASUAL', fromDate: `${month(3)}-01`, toDate: `${month(3)}-04`, status: 'APPROVED' }, // 4 of 5
        { employeeId: over.id, leaveType: 'CASUAL', fromDate: `${month(3)}-01`, toDate: `${month(3)}-08`, status: 'APPROVED' }, // 8 of 5
        { employeeId: earlier.id, leaveType: 'CASUAL', fromDate: `${month(1)}-10`, toDate: `${month(1)}-13`, status: 'APPROVED' }, // 4 earlier
        { employeeId: earlier.id, leaveType: 'SICK', fromDate: `${month(3)}-10`, toDate: `${month(3)}-12`, status: 'APPROVED' }, // 3 now, 1 left
        { employeeId: over.id, leaveType: 'SICK', fromDate: `${month(3)}-20`, toDate: `${month(3)}-22`, status: 'PENDING' }, // never counts
      ]);
      const run = await runFor(3);
      const slip = (id: string) => run.payslips.find((s) => s.employeeId === id)!;
      expect(slip(within.id)).toMatchObject({ approvedLeaveDays: 4, suggestedUnpaidLeaveDays: 0, unpaidLeaveDays: 0 });
      expect(slip(over.id)).toMatchObject({ approvedLeaveDays: 8, suggestedUnpaidLeaveDays: 3, unpaidLeaveDays: 0 });
      expect(slip(earlier.id)).toMatchObject({ approvedLeaveDays: 3, suggestedUnpaidLeaveDays: 2, unpaidLeaveDays: 0 });
      expect(slip(none.id)).toMatchObject({ approvedLeaveDays: 0, suggestedUnpaidLeaveDays: 0 });
      // Suggested, not applied: the net pay is still the full base until the owner decides.
      expect(slip(over.id).netPaise).toBe(slip(over.id).basePaise);
      expect(slip(over.id).leaveDeductionPaise).toBe(0);

      // Apply the suggestion by setting the unpaid days; or override it with a different number.
      const applied = await call('PUT', `/hr/payroll/slips/${slip(over.id).id}`, owner, { unpaidLeaveDays: 3 });
      expect(applied.statusCode, applied.body).toBe(200);
      expect(applied.json()).toMatchObject({ unpaidLeaveDays: 3, suggestedUnpaidLeaveDays: 3 });
      expect(applied.json().leaveDeductionPaise).toBe(Math.round((3_000_000 * 3) / 31));
      const overridden = await call('PUT', `/hr/payroll/slips/${slip(over.id).id}`, owner, { unpaidLeaveDays: 0 });
      expect(overridden.json()).toMatchObject({ unpaidLeaveDays: 0, suggestedUnpaidLeaveDays: 3, netPaise: slip(over.id).basePaise });
      const past = await call('PUT', `/hr/payroll/slips/${slip(over.id).id}`, owner, { unpaidLeaveDays: 32 });
      expect(past.statusCode).toBe(400);
      // The suggestion is part of what the owner reads back later.
      const reread = PayrollRunDetailSchema.parse((await call('GET', `/hr/payroll/runs/${run.id}`, owner)).json());
      expect(reread.payslips.find((s) => s.employeeId === over.id)?.suggestedUnpaidLeaveDays).toBe(3);
    });

    it('only the owner reads or adjusts the suggestion (403 for everyone else)', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      for (const actor of [desk, ann, member]) {
        expect((await call('GET', '/hr/payroll/runs', actor)).statusCode).toBe(403);
        expect((await call('PUT', `/hr/payroll/slips/${NO_SUCH_UUID}`, actor, { unpaidLeaveDays: 1 })).statusCode).toBe(403);
      }
    });
  });

  // ========================================================== staff directory
  describe('staff directory: edit, deactivate and reactivate', () => {
    it('the owner edits a profile; others get 403 and bad input 400', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const e = await employee('Dir Dana');
      const edited = await call('PUT', `/hr/employees/${e.id}`, owner, { fullName: 'Dana Directory', position: 'Head coach', department: 'COACHING', monthlySalaryPaise: 4_200_000, phone: '9876543210', email: 'dana@example.com' });
      expect(edited.statusCode, edited.body).toBe(200);
      expect(edited.json()).toMatchObject({ fullName: 'Dana Directory', position: 'Head coach', department: 'COACHING', monthlySalaryPaise: 4_200_000 });
      expect((await call('GET', `/hr/employees/${e.id}`, owner)).json()).toMatchObject({ email: 'dana@example.com', phone: '9876543210' });
      for (const actor of [desk, ann, member]) expect((await call('PUT', `/hr/employees/${e.id}`, actor, { position: 'Boss' })).statusCode).toBe(403);
      expect((await call('PUT', `/hr/employees/${e.id}`, undefined, { position: 'Boss' })).statusCode).toBe(401);
      for (const bad of [{ monthlySalaryPaise: -1 }, { department: 'PIRATE' }, { status: 'FIRED' }, { fullName: '' }, { hiredOn: 'yesterday' }]) {
        expect((await call('PUT', `/hr/employees/${e.id}`, owner, bad)).statusCode, JSON.stringify(bad)).toBe(400);
      }
      expect((await call('GET', `/hr/employees/${e.id}`, owner)).json().position).toBe('Head coach');
    });

    it('a deactivated employee is excluded from shift assignment and from new payroll runs; reactivating brings them back', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const e = await employee('Dir Dev');
      const startsAt = new Date(Date.now() + 400 * HOUR);
      const body = { employeeId: e.id, roleLabel: 'BAR', startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + 2 * HOUR).toISOString() };

      const off = await call('PUT', `/hr/employees/${e.id}`, owner, { status: 'INACTIVE' });
      expect(off.json().status).toBe('INACTIVE');
      const refused = await call('POST', '/shifts', owner, body);
      expect(refused.statusCode).toBe(409);
      expect(refused.json().code).toBe('EMPLOYEE_INACTIVE');
      expect(EmployeeListSchema.parse((await call('GET', '/hr/employees?status=INACTIVE', owner)).json()).map((x) => x.id)).toContain(e.id);
      expect(EmployeeListSchema.parse((await call('GET', '/hr/employees?status=ACTIVE', owner)).json()).map((x) => x.id)).not.toContain(e.id);

      const june = await call('POST', '/hr/payroll/runs', owner, { month: `${2013 + Math.floor(Math.random() * 6)}-06` });
      expect(june.statusCode, june.body).toBe(201);
      runIds.push(june.json().id);
      expect(june.json().payslips.some((s: { employeeId: string }) => s.employeeId === e.id)).toBe(false);
      expect((await call('DELETE', `/hr/payroll/runs/${june.json().id}`, owner)).statusCode).toBe(204);

      expect((await call('PUT', `/hr/employees/${e.id}`, owner, { status: 'ACTIVE' })).json().status).toBe('ACTIVE');
      expect((await call('POST', '/shifts', owner, body)).statusCode).toBe(201);
      const july = await call('POST', '/hr/payroll/runs', owner, { month: `${2019 + Math.floor(Math.random() * 6)}-07` });
      expect(july.statusCode, july.body).toBe(201);
      runIds.push(july.json().id);
      expect(july.json().payslips.some((s: { employeeId: string }) => s.employeeId === e.id)).toBe(true);
    });

    it('a deactivated employee keeps their history: past payslips and leave stay readable', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const e = await employee('Dir History');
      const run = await call('POST', '/hr/payroll/runs', owner, { month: `${2026 + Math.floor(Math.random() * 30)}-08` });
      expect(run.statusCode, run.body).toBe(201);
      runIds.push(run.json().id);
      expect(run.json().payslips.some((s: { employeeId: string }) => s.employeeId === e.id)).toBe(true);
      expect((await call('PUT', `/hr/employees/${e.id}`, owner, { status: 'INACTIVE' })).statusCode).toBe(200);
      const slips = await call('GET', `/hr/employees/${e.id}/payslips`, owner);
      expect(slips.statusCode).toBe(200);
      expect(slips.json().length).toBe(1);
      expect((await call('GET', `/hr/employees/${e.id}`, owner)).json().status).toBe('INACTIVE');
    });
  });
});
