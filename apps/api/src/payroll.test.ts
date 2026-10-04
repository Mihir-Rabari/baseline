import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { employeeBankDetails, employees, leaveRequests, payrollRuns, payslips } from '@packages/db';
import { BankDetailsSchema, PayrollRunDetailSchema, PayslipListSchema } from '@packages/validation';
import { buildApp } from './app.js';
import { isDatabaseAvailable } from './test-support/database.js';
import { MembersFixtures, type Actor } from './test-support/members-fixtures.js';
import { computeNet, daysInMonth, prorate } from './services/payroll.service.js';
import { open, seal } from './lib/secret-box.js';
import { renderPdf } from './lib/simple-pdf.js';

const NO_SUCH_UUID = '00000000-0000-4000-8000-0000000000ee';
const ACCOUNT = '123456789012';
const bank = { accountHolder: 'Asha Rao', accountNumber: ACCOUNT, ifsc: 'hdfc0001234', bankName: 'HDFC Bank', upiId: 'asha@okhdfc' };

describe('payroll maths and helpers (unit)', () => {
  it('prorates in whole paise and never lets net pay go negative', () => {
    expect(prorate(3_000_000, 15, 30)).toBe(1_500_000);
    expect(prorate(1_000_00, 10, 31)).toBe(32_258);
    expect(daysInMonth('2030-02')).toBe(28);
    expect(daysInMonth('2032-02')).toBe(29);
    expect(computeNet({ basePaise: 100, leaveDeductionPaise: 30, bonusPaise: 50, otherDeductionPaise: 20 })).toBe(100);
    expect(computeNet({ basePaise: 100, leaveDeductionPaise: 100, bonusPaise: 0, otherDeductionPaise: 500 })).toBe(0);
  });

  it('seals and opens a value, and refuses tampering or the wrong key', () => {
    const sealed = seal(ACCOUNT, 'a-secret-that-is-long-enough-123456', 'bank');
    expect(sealed).not.toContain(ACCOUNT);
    expect(open(sealed, 'a-secret-that-is-long-enough-123456', 'bank')).toBe(ACCOUNT);
    expect(() => open(sealed, 'another-secret-that-is-long-enough', 'bank')).toThrow();
    expect(() => open(sealed, 'a-secret-that-is-long-enough-123456', 'other-purpose')).toThrow();
    const parts = sealed.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => open(parts.join('.'), 'a-secret-that-is-long-enough-123456', 'bank')).toThrow();
  });

  it('renders a well-formed PDF with escaped text', () => {
    const pdf = renderPdf([{ text: 'Net (pay) \\ total', right: 'Rs. 1.00' }], 'T').toString('latin1');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('Net \\(pay\\) \\\\ total');
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
  });
});

describe('Payroll, payslips and bank details (#65)', () => {
  let app: FastifyInstance;
  let hasDatabase = false;
  const fx = new MembersFixtures();
  const db = fx.db;
  let owner: Actor;
  let desk: Actor;
  let bar: Actor;
  let member: Actor;
  let staffUser: Actor;
  const empIds: string[] = [];
  const runIds: string[] = [];
  const year = 1985 + Math.floor(Math.random() * 14);
  const month = (m: number) => `${year}-${String(m).padStart(2, '0')}`;
  let emp: { id: string };
  let other: { id: string };
  let late: { id: string };

  const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, actor?: Actor, payload?: object) =>
    app.inject({ method, url, headers: actor ? { cookie: actor.cookie } : {}, ...(payload ? { payload } : {}) });

  async function employee(name: string, salaryPaise: number, hiredOn: string, userId?: string) {
    const [row] = await db
      .insert(employees)
      .values({ fullName: `${name} ${randomUUID().slice(0, 4)}`, position: 'Tester', department: 'BAR', monthlySalaryPaise: salaryPaise, hiredOn, userId: userId ?? null })
      .returning({ id: employees.id });
    empIds.push(row.id);
    return row;
  }

  beforeAll(async () => {
    app = buildApp();
    MembersFixtures.spreadClientIps(app);
    await app.ready();
    hasDatabase = await isDatabaseAvailable();
    if (!hasDatabase) return;
    owner = await fx.actor(app, 'OWNER');
    desk = await fx.actor(app, 'FRONT_DESK');
    bar = await fx.actor(app, 'BAR_STAFF');
    member = await fx.actor(app, 'MEMBER');
    staffUser = await fx.actor(app, 'BAR_STAFF');
    emp = await employee('Payroll Ann', 3_000_000, '1980-01-01', staffUser.id);
    other = await employee('Payroll Bob', 2_000_000, '1980-01-01');
    late = await employee('Payroll Late', 3_100_000, `${month(3)}-16`); // joins mid-month
  });

  afterAll(async () => {
    if (hasDatabase) {
      if (runIds.length) await db.delete(payrollRuns).where(inArray(payrollRuns.id, runIds));
      if (empIds.length) {
        await db.delete(leaveRequests).where(inArray(leaveRequests.employeeId, empIds));
        await db.delete(employeeBankDetails).where(inArray(employeeBankDetails.employeeId, empIds));
        await db.delete(payslips).where(inArray(payslips.employeeId, empIds));
        await db.delete(employees).where(inArray(employees.id, empIds));
      }
      await fx.cleanup();
    }
    await app.close();
  });

  it('401 without a session on every payroll and bank route', async () => {
    for (const [method, url] of [
      ['GET', `/api/v1/hr/employees/${NO_SUCH_UUID}/bank`],
      ['PUT', `/api/v1/hr/employees/${NO_SUCH_UUID}/bank`],
      ['GET', '/api/v1/hr/payroll/runs'],
      ['POST', '/api/v1/hr/payroll/runs'],
      ['GET', `/api/v1/hr/payroll/runs/${NO_SUCH_UUID}`],
      ['PUT', `/api/v1/hr/payroll/slips/${NO_SUCH_UUID}`],
      ['POST', `/api/v1/hr/payroll/runs/${NO_SUCH_UUID}/finalize`],
      ['POST', `/api/v1/hr/payroll/runs/${NO_SUCH_UUID}/pay`],
      ['GET', `/api/v1/hr/payroll/slips/${NO_SUCH_UUID}/pdf`],
      ['GET', '/api/v1/me/payslips'],
    ] as const) {
      const res = await call(method, url, undefined, method === 'GET' ? undefined : method === 'POST' && url.endsWith('runs') ? { month: '2000-01' } : method === 'PUT' && url.includes('bank') ? bank : {});
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('403 for front desk, bar staff and members: no bank or payroll access (privilege escalation)', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    for (const actor of [desk, bar, member]) {
      expect((await call('GET', `/api/v1/hr/employees/${emp.id}/bank`, actor)).statusCode).toBe(403);
      expect((await call('PUT', `/api/v1/hr/employees/${emp.id}/bank`, actor, bank)).statusCode).toBe(403);
      expect((await call('GET', '/api/v1/hr/payroll/runs', actor)).statusCode).toBe(403);
      expect((await call('POST', '/api/v1/hr/payroll/runs', actor, { month: month(1) })).statusCode).toBe(403);
      expect((await call('GET', `/api/v1/hr/payroll/slips/${NO_SUCH_UUID}/pdf`, actor)).statusCode).toBe(403);
    }
  });

  it('stores bank details encrypted and only ever returns the last four digits', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    expect(BankDetailsSchema.parse((await call('GET', `/api/v1/hr/employees/${emp.id}/bank`, owner)).json())).toEqual({ configured: false });
    expect((await call('PUT', `/api/v1/hr/employees/${emp.id}/bank`, owner, { ...bank, accountNumber: '12ab' })).statusCode).toBe(400);
    expect((await call('PUT', `/api/v1/hr/employees/${emp.id}/bank`, owner, { ...bank, ifsc: 'BAD' })).statusCode).toBe(400);
    expect((await call('PUT', `/api/v1/hr/employees/${emp.id}/bank`, owner, { ...bank, upiId: 'not a upi' })).statusCode).toBe(400);
    expect((await call('PUT', `/api/v1/hr/employees/${NO_SUCH_UUID}/bank`, owner, bank)).statusCode).toBe(404);

    const saved = await call('PUT', `/api/v1/hr/employees/${emp.id}/bank`, owner, bank);
    expect(saved.statusCode).toBe(200);
    expect(saved.body).not.toContain(ACCOUNT);
    expect(BankDetailsSchema.parse(saved.json())).toMatchObject({ configured: true, accountNumberMasked: 'XXXXXX9012', ifsc: 'HDFC0001234', upiId: 'asha@okhdfc' });
    const read = await call('GET', `/api/v1/hr/employees/${emp.id}/bank`, owner);
    expect(read.body).not.toContain(ACCOUNT);
    expect(read.headers['cache-control']).toBe('no-store');

    const [row] = await db.select().from(employeeBankDetails).where(eq(employeeBankDetails.employeeId, emp.id));
    expect(row.accountNumberEnc).not.toContain(ACCOUNT);
    expect(row.accountLast4).toBe('9012');
  });

  it('creates a draft run with prorated pay, leave and attendance, and refuses a duplicate month', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    await db.insert(leaveRequests).values({ employeeId: emp.id, leaveType: 'SICK', fromDate: `${month(3)}-10`, toDate: `${month(3)}-12`, status: 'APPROVED' });
    expect((await call('POST', '/api/v1/hr/payroll/runs', owner, { month: '2030-13' })).statusCode).toBe(400);

    const created = await call('POST', '/api/v1/hr/payroll/runs', owner, { month: month(3) });
    expect(created.statusCode).toBe(201);
    const run = PayrollRunDetailSchema.parse(created.json());
    runIds.push(run.id);
    expect(run.status).toBe('DRAFT');
    expect(run.headcount).toBe(3);
    const slip = (id: string) => run.payslips.find((s) => s.employeeId === id)!;
    expect(slip(emp.id)).toMatchObject({ basePaise: 3_000_000, netPaise: 3_000_000, payableDays: 31, approvedLeaveDays: 3, bankConfigured: true });
    expect(slip(other.id).bankConfigured).toBe(false);
    // Joined on the 16th of a 31-day month: 16 payable days.
    expect(slip(late.id)).toMatchObject({ payableDays: 16, basePaise: prorate(3_100_000, 16, 31) });
    expect(run.totalNetPaise).toBe(run.payslips.reduce((n, s) => n + s.netPaise, 0));

    const dup = await call('POST', '/api/v1/hr/payroll/runs', owner, { month: month(3) });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe('PAYROLL_RUN_EXISTS');
    expect((await call('POST', '/api/v1/hr/payroll/runs', owner, { month: '1960-01' })).json().code).toBe('NO_EMPLOYEES');
  });

  it('adjusts a draft payslip, recomputes net pay and validates the adjustments', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const runs = (await call('GET', '/api/v1/hr/payroll/runs', owner)).json() as Array<{ id: string; month: string }>;
    const run = PayrollRunDetailSchema.parse((await call('GET', `/api/v1/hr/payroll/runs/${runs.find((r) => r.month === month(3))!.id}`, owner)).json());
    const slip = run.payslips.find((s) => s.employeeId === other.id)!;
    const put = (payload: object) => call('PUT', `/api/v1/hr/payroll/slips/${slip.id}`, owner, payload);

    const ok = await put({ unpaidLeaveDays: 2, bonusPaise: 50_000, otherDeductionPaise: 10_000, note: 'Two days LOP' });
    expect(ok.statusCode).toBe(200);
    const leaveCut = prorate(2_000_000, 2, 31);
    expect(ok.json()).toMatchObject({ unpaidLeaveDays: 2, leaveDeductionPaise: leaveCut, netPaise: 2_000_000 - leaveCut + 50_000 - 10_000, note: 'Two days LOP' });

    expect((await put({ unpaidLeaveDays: -1 })).statusCode).toBe(400);
    expect((await put({ bonusPaise: 1.5 })).statusCode).toBe(400);
    expect((await put({ unpaidLeaveDays: 31 })).statusCode).toBe(200); // all 31 payable days
    expect((await put({ unpaidLeaveDays: 32 })).statusCode).toBe(400);
    expect((await call('PUT', `/api/v1/hr/payroll/slips/${NO_SUCH_UUID}`, owner, { bonusPaise: 1 })).statusCode).toBe(404);
    expect((await put({ unpaidLeaveDays: 0, bonusPaise: 0, otherDeductionPaise: 0 })).json().netPaise).toBe(2_000_000);
  });

  it('finalises, freezes the run, shows payslips to their employee only, and marks it paid once', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const created = await call('POST', '/api/v1/hr/payroll/runs', owner, { month: month(4) });
    expect(created.statusCode).toBe(201);
    const run = PayrollRunDetailSchema.parse(created.json());
    runIds.push(run.id);
    const own = run.payslips.find((s) => s.employeeId === emp.id)!;
    const theirs = run.payslips.find((s) => s.employeeId === other.id)!;

    // Not visible to the employee while the run is a draft.
    expect(PayslipListSchema.parse((await call('GET', '/api/v1/me/payslips', staffUser)).json()).filter((s) => s.runId === run.id)).toHaveLength(0);
    expect((await call('GET', `/api/v1/me/payslips/${own.id}/pdf`, staffUser)).statusCode).toBe(404);
    expect((await call('POST', `/api/v1/hr/payroll/runs/${run.id}/pay`, owner)).json().code).toBe('INVALID_RUN_STATUS'); // must finalise first

    const done = await call('POST', `/api/v1/hr/payroll/runs/${run.id}/finalize`, owner);
    expect(done.statusCode).toBe(200);
    expect(done.json().status).toBe('FINALIZED');
    expect((await call('POST', `/api/v1/hr/payroll/runs/${run.id}/finalize`, owner)).statusCode).toBe(409);

    // Frozen: no edits, no delete.
    const edit = await call('PUT', `/api/v1/hr/payroll/slips/${own.id}`, owner, { bonusPaise: 1 });
    expect(edit.statusCode).toBe(409);
    expect(edit.json().code).toBe('RUN_LOCKED');
    expect((await call('DELETE', `/api/v1/hr/payroll/runs/${run.id}`, owner)).statusCode).toBe(409);

    // The employee sees their own slip, and cannot reach anyone else's (same 404 as a missing one).
    const mine = PayslipListSchema.parse((await call('GET', '/api/v1/me/payslips', staffUser)).json());
    expect(mine.map((s) => s.id)).toContain(own.id);
    expect(mine.every((s) => s.employeeId === emp.id)).toBe(true);
    const pdf = await call('GET', `/api/v1/me/payslips/${own.id}/pdf`, staffUser);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toContain('payslip-');
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await call('GET', `/api/v1/me/payslips/${theirs.id}/pdf`, staffUser)).statusCode).toBe(404);
    expect((await call('GET', '/api/v1/me/payslips', member)).statusCode).toBe(403);

    // Owner can download any payslip; the PDF never contains the account number.
    const ownerPdf = await call('GET', `/api/v1/hr/payroll/slips/${theirs.id}/pdf`, owner);
    expect(ownerPdf.statusCode).toBe(200);
    expect(ownerPdf.rawPayload.toString('latin1')).not.toContain(ACCOUNT);

    const paid = await call('POST', `/api/v1/hr/payroll/runs/${run.id}/pay`, owner);
    expect(paid.statusCode).toBe(200);
    expect(paid.json()).toMatchObject({ status: 'PAID' });
    expect((await call('POST', `/api/v1/hr/payroll/runs/${run.id}/pay`, owner)).statusCode).toBe(409);
  });

  it('discards a draft run', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const created = PayrollRunDetailSchema.parse((await call('POST', '/api/v1/hr/payroll/runs', owner, { month: month(5) })).json());
    expect((await call('DELETE', `/api/v1/hr/payroll/runs/${created.id}`, owner)).statusCode).toBe(204);
    expect((await call('GET', `/api/v1/hr/payroll/runs/${created.id}`, owner)).statusCode).toBe(404);
    expect((await call('DELETE', `/api/v1/hr/payroll/runs/${NO_SUCH_UUID}`, owner)).statusCode).toBe(404);
  });
});
