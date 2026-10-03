import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { employees, getDb, leaveRequests, notifications, staffShifts, users } from '@packages/db';
import {
  EmployeeListSchema,
  EmployeeSchema,
  LeaveRequestPageSchema,
  LeaveRequestSchema,
  PayrollSummarySchema,
  ShiftListSchema,
  ShiftSchema,
} from '@packages/validation';
import { buildApp } from './app.js';
import { isDatabaseAvailable } from './test-support/database.js';
import { makeActor, nextIp, rolesSeeded, type Actor } from './test-support/role-actors.js';
import { shiftStatus } from './services/shift.service.js';
import { leaveDays } from './services/hr.service.js';

const API = '/api/v1';
const MIN = 60_000;

describe('shift status and leave day helpers (unit)', () => {
  const at = (iso: string) => new Date(iso);
  it('derives the shift status from clock times and the end time', () => {
    const base = { clockInAt: null, clockOutAt: null, endsAt: at('2031-05-14T10:00:00Z') };
    expect(shiftStatus(base, at('2031-05-14T09:59:59Z'))).toBe('SCHEDULED');
    expect(shiftStatus(base, at('2031-05-14T10:00:00Z'))).toBe('MISSED');
    expect(shiftStatus({ ...base, clockInAt: at('2031-05-14T08:00:00Z') }, at('2031-05-14T12:00:00Z'))).toBe('ON_SHIFT');
    expect(shiftStatus({ ...base, clockInAt: at('2031-05-14T08:00:00Z'), clockOutAt: at('2031-05-14T09:00:00Z') }, at('2031-05-14T12:00:00Z'))).toBe('DONE');
  });
  it('counts leave days inclusively across month and year ends', () => {
    expect(leaveDays('2031-05-14', '2031-05-14')).toBe(1);
    expect(leaveDays('2031-05-30', '2031-06-02')).toBe(4);
    expect(leaveDays('2031-12-30', '2032-01-02')).toBe(4);
  });
});

describe('Shifts, employees, leave and payroll (S-05)', () => {
  let app: FastifyInstance;
  let ready = false;
  const db = getDb();
  const userIds: string[] = [];
  const employeeIds: string[] = [];
  let owner: Actor;
  let desk: Actor;
  let bar: Actor;
  let member: Actor;
  let barEmp: string;
  let deskEmp: string;
  let otherEmp: string;

  const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, actor: Actor | null, payload?: object) =>
    app.inject({ method, url: `${API}${url}`, remoteAddress: nextIp(), headers: actor ? { cookie: actor.cookie } : undefined, payload });

  async function newEmployee(extra: Partial<typeof employees.$inferInsert> = {}) {
    const [row] = await db
      .insert(employees)
      .values({ fullName: `S05 ${randomUUID().slice(0, 8)}`, position: 'Clerk', department: 'FRONT_DESK', monthlySalaryPaise: 2_500_000, hiredOn: '2030-01-01', ...extra })
      .returning();
    employeeIds.push(row.id);
    return row;
  }
  async function newShift(employeeId: string, startMin: number, durationMin = 120, extra: Partial<typeof staffShifts.$inferInsert> = {}) {
    const startsAt = new Date(Date.now() + startMin * MIN);
    const [row] = await db
      .insert(staffShifts)
      .values({ employeeId, roleLabel: 'OTHER', startsAt, endsAt: new Date(startsAt.getTime() + durationMin * MIN), ...extra })
      .returning();
    return row;
  }

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
    ready = (await isDatabaseAvailable()) && (await rolesSeeded());
    if (!ready) return;
    [owner, desk, bar, member] = await Promise.all([
      makeActor(app, 'OWNER', 's05'), makeActor(app, 'FRONT_DESK', 's05'), makeActor(app, 'BAR_STAFF', 's05'), makeActor(app, 'MEMBER', 's05'),
    ]);
    userIds.push(owner.id, desk.id, bar.id, member.id);
    barEmp = (await newEmployee({ userId: bar.id, department: 'BAR', position: 'Bartender' })).id;
    deskEmp = (await newEmployee({ userId: desk.id })).id;
    otherEmp = (await newEmployee()).id;
  }, 60_000);

  afterAll(async () => {
    if (ready) {
      if (employeeIds.length) await db.delete(employees).where(inArray(employees.id, employeeIds)); // shifts and leave cascade
      if (userIds.length) {
        await db.delete(notifications).where(inArray(notifications.userId, userIds));
        await db.delete(users).where(inArray(users.id, userIds));
      }
    }
    await app.close();
  });

  // =================================================================== shifts
  describe('shifts: authentication and authorization', () => {
    it('401 without a session on every shift route', async () => {
      const id = randomUUID();
      // Bodies are valid on purpose: schema validation runs before the auth hook.
      const body = { employeeId: id, roleLabel: 'BAR', startsAt: '2031-05-14T10:00:00.000Z', endsAt: '2031-05-14T12:00:00.000Z' };
      for (const [method, url, payload] of [['GET', '/shifts'], ['POST', '/shifts', body], ['DELETE', `/shifts/${id}`], ['POST', `/shifts/${id}/clock-in`], ['POST', `/shifts/${id}/clock-out`], ['GET', '/me/shift/current']] as const) {
        expect((await call(method, url, null, payload)).statusCode, `${method} ${url}`).toBe(401);
      }
    });

    it('adversarial: members cannot see rosters, clock, or schedule; front desk and bar cannot schedule or delete', async (ctx) => {
      if (!ready) return ctx.skip();
      const shift = await newShift(barEmp, 600);
      const body = { employeeId: barEmp, roleLabel: 'BAR', startsAt: new Date(Date.now() + 900 * MIN).toISOString(), endsAt: new Date(Date.now() + 1000 * MIN).toISOString() };
      for (const [method, url, payload] of [['GET', '/shifts'], ['POST', `/shifts/${shift.id}/clock-in`], ['GET', '/me/shift/current'], ['POST', '/shifts', body]] as const) {
        expect((await call(method, url, member, payload)).statusCode, `member ${method} ${url}`).toBe(403);
      }
      for (const actor of [desk, bar]) {
        expect((await call('POST', '/shifts', actor, body)).statusCode).toBe(403);
        expect((await call('DELETE', `/shifts/${shift.id}`, actor)).statusCode).toBe(403);
      }
      expect(await db.select().from(staffShifts).where(eq(staffShifts.id, shift.id))).toHaveLength(1);
    });
  });

  describe('GET /shifts', () => {
    it('roster viewers see everyone; bar staff see only their own shifts', async (ctx) => {
      if (!ready) return ctx.skip();
      const mine = await newShift(barEmp, 3000);
      const theirs = await newShift(otherEmp, 3000);
      const q = `?from=${new Date(Date.now() + 2900 * MIN).toISOString().slice(0, 10)}&to=${new Date(Date.now() + 3200 * MIN).toISOString().slice(0, 10)}`;
      const asOwner = ShiftListSchema.parse((await call('GET', `/shifts${q}`, owner)).json());
      expect(asOwner.map((s) => s.id)).toEqual(expect.arrayContaining([mine.id, theirs.id]));
      const asDesk = ShiftListSchema.parse((await call('GET', `/shifts${q}`, desk)).json());
      expect(asDesk.map((s) => s.id)).toEqual(expect.arrayContaining([mine.id, theirs.id]));
      const asBar = ShiftListSchema.parse((await call('GET', `/shifts${q}`, bar)).json());
      expect(asBar.map((s) => s.id)).toContain(mine.id);
      expect(asBar.map((s) => s.id)).not.toContain(theirs.id);
      const probing = ShiftListSchema.parse((await call('GET', `/shifts${q}&employeeId=${otherEmp}`, bar)).json());
      expect(probing).toEqual([]);
      const filtered = ShiftListSchema.parse((await call('GET', `/shifts${q}&employeeId=${otherEmp}`, owner)).json());
      expect(filtered.every((s) => s.employee.id === otherEmp)).toBe(true);
    });

    it('400 for malformed dates or employee ids', async (ctx) => {
      if (!ready) return ctx.skip();
      expect((await call('GET', '/shifts?from=tomorrow', owner)).statusCode).toBe(400);
      expect((await call('GET', '/shifts?employeeId=nope', owner)).statusCode).toBe(400);
    });
  });

  describe('POST /shifts and DELETE /shifts/:id', () => {
    const body = (employeeId: string, startMin: number, durationMin = 60, roleLabel = 'BAR') => ({
      employeeId, roleLabel, startsAt: new Date(Date.now() + startMin * MIN).toISOString(), endsAt: new Date(Date.now() + (startMin + durationMin) * MIN).toISOString(),
    });

    it('201 creates a SCHEDULED shift and 409 SHIFT_OVERLAP when the same employee is double booked', async (ctx) => {
      if (!ready) return ctx.skip();
      const created = await call('POST', '/shifts', owner, body(otherEmp, 5000));
      expect(created.statusCode).toBe(201);
      const shift = ShiftSchema.parse(created.json());
      expect(shift).toMatchObject({ status: 'SCHEDULED', clockInAt: null, clockOutAt: null, roleLabel: 'BAR' });
      const clash = await call('POST', '/shifts', owner, body(otherEmp, 5030));
      expect(clash.statusCode).toBe(409);
      expect(clash.json().code).toBe('SHIFT_OVERLAP');
      expect((await call('POST', '/shifts', owner, body(otherEmp, 5060))).statusCode).toBe(201); // back to back is fine
    });

    it('400 for end before start, an over-long role label and a missing employee id', async (ctx) => {
      if (!ready) return ctx.skip();
      expect((await call('POST', '/shifts', owner, { ...body(otherEmp, 6000), endsAt: new Date(Date.now() + 5990 * MIN).toISOString() })).statusCode).toBe(400);
      expect((await call('POST', '/shifts', owner, body(otherEmp, 6000, 60, 'x'.repeat(25)))).statusCode).toBe(400);
      expect((await call('POST', '/shifts', owner, { roleLabel: 'BAR' })).statusCode).toBe(400);
    });

    it('404 for an unknown employee and 409 for an inactive one', async (ctx) => {
      if (!ready) return ctx.skip();
      expect((await call('POST', '/shifts', owner, body(randomUUID(), 6000))).statusCode).toBe(404);
      const inactive = await newEmployee({ status: 'INACTIVE' });
      const res = await call('POST', '/shifts', owner, body(inactive.id, 6000));
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('EMPLOYEE_INACTIVE');
    });

    it('DELETE: 200 for an unstarted shift, 404 when missing, 409 once clocked in', async (ctx) => {
      if (!ready) return ctx.skip();
      const fresh = await newShift(otherEmp, 7000);
      expect((await call('DELETE', `/shifts/${fresh.id}`, owner)).json()).toMatchObject({ success: true });
      expect((await call('DELETE', `/shifts/${fresh.id}`, owner)).statusCode).toBe(404);
      const started = await newShift(otherEmp, -10, 120, { clockInAt: new Date() });
      const res = await call('DELETE', `/shifts/${started.id}`, owner);
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('SHIFT_STARTED');
      expect(await db.select().from(staffShifts).where(eq(staffShifts.id, started.id))).toHaveLength(1);
    });
  });

  describe('clock-in, clock-out and current shift', () => {
    it('clocks in and out of your own shift and rejects repeats', async (ctx) => {
      if (!ready) return ctx.skip();
      const shift = await newShift(deskEmp, -5, 120);
      const current = await call('GET', '/me/shift/current', desk);
      expect(ShiftSchema.parse(current.json()).id).toBe(shift.id);
      const clockedIn = await call('POST', `/shifts/${shift.id}/clock-in`, desk);
      expect(clockedIn.statusCode).toBe(200);
      expect(ShiftSchema.parse(clockedIn.json())).toMatchObject({ status: 'ON_SHIFT', clockOutAt: null });
      expect(clockedIn.json().clockInAt).toBeTruthy();
      const again = await call('POST', `/shifts/${shift.id}/clock-in`, desk);
      expect(again.statusCode).toBe(409);
      expect(again.json().code).toBe('ALREADY_CLOCKED_IN');
      const out = await call('POST', `/shifts/${shift.id}/clock-out`, desk);
      expect(ShiftSchema.parse(out.json())).toMatchObject({ status: 'DONE' });
      expect((await call('POST', `/shifts/${shift.id}/clock-out`, desk)).json().code).toBe('ALREADY_CLOCKED_OUT');
      expect((await call('POST', `/shifts/${shift.id}/clock-in`, desk)).json().code).toBe('ALREADY_CLOCKED_OUT');
    });

    it('adversarial: nobody can clock in or out of someone else\'s shift', async (ctx) => {
      if (!ready) return ctx.skip();
      const theirs = await newShift(barEmp, -5, 120);
      expect((await call('POST', `/shifts/${theirs.id}/clock-in`, desk)).statusCode).toBe(403);
      expect((await call('POST', `/shifts/${theirs.id}/clock-out`, desk)).statusCode).toBe(403);
      // The owner has no employee record, so owner clocking is refused too.
      expect((await call('POST', `/shifts/${theirs.id}/clock-in`, owner)).statusCode).toBe(403);
      const [row] = await db.select().from(staffShifts).where(eq(staffShifts.id, theirs.id));
      expect(row.clockInAt).toBeNull();
    });

    it('404 for an unknown shift; 409 for clock-out before clock-in, too early, and ended shifts', async (ctx) => {
      if (!ready) return ctx.skip();
      expect((await call('POST', `/shifts/${randomUUID()}/clock-in`, bar)).statusCode).toBe(404);
      const early = await newShift(barEmp, 240, 60);
      expect((await call('POST', `/shifts/${early.id}/clock-in`, bar)).json().code).toBe('TOO_EARLY');
      expect((await call('POST', `/shifts/${early.id}/clock-out`, bar)).json().code).toBe('NOT_CLOCKED_IN');
      const ended = await newShift(barEmp, -300, 60);
      expect((await call('POST', `/shifts/${ended.id}/clock-in`, bar)).json().code).toBe('SHIFT_ENDED');
      expect((await call('GET', '/shifts', bar)).statusCode).toBe(200);
    });

    it('GET /me/shift/current is null for an owner without an employee record', async (ctx) => {
      if (!ready) return ctx.skip();
      const res = await call('GET', '/me/shift/current', owner);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toBeNull();
    });
  });

  // =================================================================== employees
  describe('employees', () => {
    it('401, and 403 for front desk, bar staff and members', async (ctx) => {
      if (!ready) return ctx.skip();
      const id = randomUUID();
      const body = { fullName: 'X', position: 'P', department: 'BAR', monthlySalaryPaise: 1, hiredOn: '2030-01-01' };
      for (const [method, url, payload] of [['GET', '/hr/employees'], ['POST', '/hr/employees', body], ['PUT', `/hr/employees/${id}`, { position: 'Y' }], ['GET', '/hr/payroll-summary?month=2031-05']] as const) {
        expect((await call(method, url, null, payload)).statusCode, `anon ${method} ${url}`).toBe(401);
        for (const actor of [desk, bar, member]) expect((await call(method, url, actor, payload)).statusCode, `${method} ${url}`).toBe(403);
      }
    });

    it('creates, lists with filters and updates an employee', async (ctx) => {
      if (!ready) return ctx.skip();
      const created = await call('POST', '/hr/employees', owner, { fullName: 'S05 Coach Anita', position: 'Head coach', department: 'COACHING', monthlySalaryPaise: 4_000_000, hiredOn: '2030-06-01' });
      expect(created.statusCode).toBe(201);
      const employee = EmployeeSchema.parse(created.json());
      employeeIds.push(employee.id);
      expect(employee).toMatchObject({ status: 'ACTIVE', leaveDaysThisYear: 0, department: 'COACHING' });
      const list = EmployeeListSchema.parse((await call('GET', '/hr/employees?department=COACHING&q=anita', owner)).json());
      expect(list.map((e) => e.id)).toContain(employee.id);
      expect(list.every((e) => e.department === 'COACHING')).toBe(true);
      const updated = await call('PUT', `/hr/employees/${employee.id}`, owner, { monthlySalaryPaise: 4_500_000, status: 'INACTIVE' });
      expect(EmployeeSchema.parse(updated.json())).toMatchObject({ monthlySalaryPaise: 4_500_000, status: 'INACTIVE' });
      const inactive = EmployeeListSchema.parse((await call('GET', '/hr/employees?status=INACTIVE&q=anita', owner)).json());
      expect(inactive.map((e) => e.id)).toContain(employee.id);
      expect((await call('PUT', `/hr/employees/${employee.id}`, owner, {})).statusCode).toBe(200);
    });

    it('400 for an unknown department, a negative salary and a bad status; 404 for a missing employee', async (ctx) => {
      if (!ready) return ctx.skip();
      const base = { fullName: 'X', position: 'P', department: 'BAR', monthlySalaryPaise: 1, hiredOn: '2030-01-01' };
      for (const bad of [{ ...base, department: 'SPACE' }, { ...base, monthlySalaryPaise: -1 }, { ...base, hiredOn: '2030-02-30' }, { ...base, fullName: ' ' }]) {
        expect((await call('POST', '/hr/employees', owner, bad)).statusCode, JSON.stringify(bad)).toBe(400);
      }
      expect((await call('PUT', `/hr/employees/${otherEmp}`, owner, { status: 'FIRED' })).statusCode).toBe(400);
      expect((await call('PUT', `/hr/employees/${randomUUID()}`, owner, { position: 'Y' })).statusCode).toBe(404);
      expect((await call('GET', '/hr/employees?department=SPACE', owner)).statusCode).toBe(400);
    });

    it('404 for an unknown linked user and 409 when a user is already linked to another employee', async (ctx) => {
      if (!ready) return ctx.skip();
      const base = { fullName: 'S05 Linked', position: 'P', department: 'BAR', monthlySalaryPaise: 1, hiredOn: '2030-01-01' };
      expect((await call('POST', '/hr/employees', owner, { ...base, userId: randomUUID() })).statusCode).toBe(404);
      const dup = await call('POST', '/hr/employees', owner, { ...base, userId: bar.id });
      expect(dup.statusCode).toBe(409);
      expect(dup.json().code).toBe('USER_ALREADY_LINKED');
    });
  });

  // ======================================================================= leave
  describe('leave requests', () => {
    const range = (offsetDays: number, days: number) => {
      const from = new Date(Date.UTC(2032, 0, 1 + offsetDays));
      const to = new Date(from.getTime() + (days - 1) * 86_400_000);
      return { fromDate: from.toISOString().slice(0, 10), toDate: to.toISOString().slice(0, 10) };
    };

    it('401 and 403: members cannot request leave and staff cannot read all leave or decide', async (ctx) => {
      if (!ready) return ctx.skip();
      expect((await call('GET', '/me/leave', null)).statusCode).toBe(401);
      expect((await call('POST', '/me/leave', member, { leaveType: 'CASUAL', ...range(0, 1) })).statusCode).toBe(403);
      expect((await call('GET', '/me/leave', member)).statusCode).toBe(403);
      for (const actor of [desk, bar, member]) {
        expect((await call('GET', '/hr/leave', actor)).statusCode).toBe(403);
        expect((await call('POST', `/hr/leave/${randomUUID()}/decision`, actor, { decision: 'APPROVED' })).statusCode).toBe(403);
      }
    });

    it('requests leave, notifies the owner, lists it as own and rejects overlaps and bad input', async (ctx) => {
      if (!ready) return ctx.skip();
      const dates = range(0, 3);
      const created = await call('POST', '/me/leave', bar, { leaveType: 'SICK', ...dates, reason: 'Flu' });
      expect(created.statusCode).toBe(201);
      const leave = LeaveRequestSchema.parse(created.json());
      expect(leave).toMatchObject({ status: 'PENDING', days: 3, decidedBy: null, employee: { id: barEmp } });
      const notified = await db.select().from(notifications).where(eq(notifications.userId, owner.id));
      expect(notified.some((n) => n.type === 'LEAVE_REQUEST')).toBe(true);

      const overlap = await call('POST', '/me/leave', bar, { leaveType: 'CASUAL', ...range(2, 2) });
      expect(overlap.statusCode).toBe(409);
      expect(overlap.json().code).toBe('LEAVE_OVERLAP');
      expect((await call('POST', '/me/leave', bar, { leaveType: 'CASUAL', fromDate: '2032-02-10', toDate: '2032-02-09' })).statusCode).toBe(400);
      expect((await call('POST', '/me/leave', bar, { leaveType: 'HOLIDAY', ...range(20, 1) })).statusCode).toBe(400);

      const mine = LeaveRequestPageSchema.parse((await call('GET', '/me/leave', bar)).json());
      expect(mine.data.map((l) => l.id)).toContain(leave.id);
      expect(mine.data.every((l) => l.employee.id === barEmp)).toBe(true);
    });

    it('adversarial: one employee never sees another employee\'s leave through /me/leave', async (ctx) => {
      if (!ready) return ctx.skip();
      const mine = await call('POST', '/me/leave', desk, { leaveType: 'PAID', ...range(40, 2) });
      expect(mine.statusCode).toBe(201);
      const seenByBar = LeaveRequestPageSchema.parse((await call('GET', '/me/leave', bar)).json());
      expect(seenByBar.data.map((l) => l.id)).not.toContain(mine.json().id);
    });

    it('404 NOT_AN_EMPLOYEE for the owner, who has no employee record, and an empty list', async (ctx) => {
      if (!ready) return ctx.skip();
      const res = await call('POST', '/me/leave', owner, { leaveType: 'CASUAL', ...range(60, 1) });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('NOT_AN_EMPLOYEE');
      expect(LeaveRequestPageSchema.parse((await call('GET', '/me/leave', owner)).json()).data).toEqual([]);
    });

    it('owner approves, the employee is told, and a decision cannot be repeated', async (ctx) => {
      if (!ready) return ctx.skip();
      const request = (await call('POST', '/me/leave', bar, { leaveType: 'CASUAL', ...range(80, 2) })).json();
      const decided = await call('POST', `/hr/leave/${request.id}/decision`, owner, { decision: 'APPROVED', note: 'Enjoy' });
      expect(decided.statusCode).toBe(200);
      expect(LeaveRequestSchema.parse(decided.json())).toMatchObject({ status: 'APPROVED', decisionNote: 'Enjoy', decidedBy: { id: owner.id } });
      const told = await db.select().from(notifications).where(eq(notifications.userId, bar.id));
      expect(told.some((n) => n.type === 'LEAVE_DECIDED')).toBe(true);
      const again = await call('POST', `/hr/leave/${request.id}/decision`, owner, { decision: 'REJECTED' });
      expect(again.statusCode).toBe(409);
      expect(again.json().code).toBe('ALREADY_DECIDED');
      const status = await db.select().from(leaveRequests).where(eq(leaveRequests.id, request.id));
      expect(status[0].status).toBe('APPROVED');
    });

    it('409 LEAVE_OVERLAP when approving leave that overlaps already approved leave; rejecting is still fine', async (ctx) => {
      if (!ready) return ctx.skip();
      const dates = range(120, 3);
      const approved = await db.insert(leaveRequests).values({ employeeId: otherEmp, leaveType: 'CASUAL', ...dates, status: 'APPROVED' }).returning();
      const pending = await db.insert(leaveRequests).values({ employeeId: otherEmp, leaveType: 'SICK', ...range(121, 2), status: 'PENDING' }).returning();
      expect(approved).toHaveLength(1);
      const clash = await call('POST', `/hr/leave/${pending[0].id}/decision`, owner, { decision: 'APPROVED' });
      expect(clash.statusCode).toBe(409);
      expect(clash.json().code).toBe('LEAVE_OVERLAP');
      expect((await call('POST', `/hr/leave/${pending[0].id}/decision`, owner, { decision: 'REJECTED', note: 'Overlaps' })).json().status).toBe('REJECTED');
    });

    it('400 for a bad decision and 404 for an unknown request; /hr/leave filters by status and employee', async (ctx) => {
      if (!ready) return ctx.skip();
      expect((await call('POST', `/hr/leave/${randomUUID()}/decision`, owner, { decision: 'MAYBE' })).statusCode).toBe(400);
      expect((await call('POST', `/hr/leave/${randomUUID()}/decision`, owner, { decision: 'APPROVED' })).statusCode).toBe(404);
      const list = LeaveRequestPageSchema.parse((await call('GET', `/hr/leave?employeeId=${otherEmp}&status=APPROVED`, owner)).json());
      expect(list.data.length).toBeGreaterThan(0);
      expect(list.data.every((l) => l.employee.id === otherEmp && l.status === 'APPROVED')).toBe(true);
      expect((await call('GET', '/hr/leave?status=NOPE', owner)).statusCode).toBe(400);
    });

    it('counts approved leave days this year on the employee list', async (ctx) => {
      if (!ready) return ctx.skip();
      const year = new Date().getUTCFullYear();
      const worker = await newEmployee();
      await db.insert(leaveRequests).values([
        { employeeId: worker.id, leaveType: 'CASUAL', fromDate: `${year}-03-10`, toDate: `${year}-03-12`, status: 'APPROVED' },
        { employeeId: worker.id, leaveType: 'SICK', fromDate: `${year}-04-01`, toDate: `${year}-04-02`, status: 'PENDING' },
        { employeeId: worker.id, leaveType: 'PAID', fromDate: `${year - 1}-12-30`, toDate: `${year}-01-02`, status: 'APPROVED' },
      ]);
      const list = EmployeeListSchema.parse((await call('GET', `/hr/employees?q=${encodeURIComponent(worker.fullName)}`, owner)).json());
      expect(list.find((e) => e.id === worker.id)?.leaveDaysThisYear).toBe(3 + 2); // 3 in March plus 2 clipped from the year boundary
    });
  });

  // ===================================================================== payroll
  describe('GET /hr/payroll-summary', () => {
    it('400 for a malformed month', async (ctx) => {
      if (!ready) return ctx.skip();
      for (const month of ['2031-13', '2031-5', 'May', '']) expect((await call('GET', `/hr/payroll-summary?month=${month}`, owner)).statusCode, month).toBe(400);
    });

    it('sums active staff hired by month end, by department, and lists approved leave in the month', async (ctx) => {
      if (!ready) return ctx.skip();
      const away = await newEmployee({ fullName: 'S05 Away Anil' });
      await db.insert(leaveRequests).values({ employeeId: away.id, leaveType: 'PAID', fromDate: '2031-12-30', toDate: '2032-01-02', status: 'APPROVED' });
      const res = await call('GET', '/hr/payroll-summary?month=2032-01', owner);
      expect(res.statusCode).toBe(200);
      const summary = PayrollSummarySchema.parse(res.json());
      expect(summary.month).toBe('2032-01');
      expect(summary.totalPaise).toBe(summary.byDepartment.reduce((sum, d) => sum + d.amountPaise, 0));
      expect(summary.headcount).toBe(summary.byDepartment.reduce((sum, d) => sum + d.headcount, 0));
      expect(summary.onLeave).toContainEqual({ employeeName: 'S05 Away Anil', fromDate: '2031-12-30', toDate: '2032-01-02' });
      const december = PayrollSummarySchema.parse((await call('GET', '/hr/payroll-summary?month=2031-12', owner)).json());
      expect(december.onLeave).toContainEqual({ employeeName: 'S05 Away Anil', fromDate: '2031-12-30', toDate: '2032-01-02' });
      const november = PayrollSummarySchema.parse((await call('GET', '/hr/payroll-summary?month=2031-11', owner)).json());
      expect(november.onLeave.find((l) => l.employeeName === 'S05 Away Anil')).toBeUndefined();
      const late = await newEmployee({ hiredOn: '2032-01-31', monthlySalaryPaise: 1_000_000, department: 'MAINTENANCE' });
      const after = PayrollSummarySchema.parse((await call('GET', '/hr/payroll-summary?month=2032-01', owner)).json());
      expect(after.totalPaise - summary.totalPaise).toBe(1_000_000);
      expect(december.totalPaise).toBe(after.totalPaise - 1_000_000); // not yet hired in December
      await db.update(employees).set({ status: 'INACTIVE' }).where(eq(employees.id, late.id));
      const inactive = PayrollSummarySchema.parse((await call('GET', '/hr/payroll-summary?month=2032-01', owner)).json());
      expect(inactive.totalPaise).toBe(summary.totalPaise);
    });
  });
});
