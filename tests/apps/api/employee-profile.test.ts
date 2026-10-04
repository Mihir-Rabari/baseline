import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { employeeBankDetails, employees, leaveRequests } from '@packages/db';
import { EmployeeProfileSchema, EmployeeSchema, PayslipListSchema } from '@packages/validation';
import { buildApp } from '../../../apps/api/src/app.js';
import { isDatabaseAvailable } from '../../../apps/api/src/test-support/database.js';
import { MembersFixtures, type Actor } from '../../../apps/api/src/test-support/members-fixtures.js';

const NO_SUCH_UUID = '00000000-0000-4000-8000-0000000000ef';
const PHOTO = '/api/v1/media/employee/123e4567-e89b-42d3-a456-426614174000.png';
const ACCOUNT = '998877665544';
const bank = { accountHolder: 'Pia Profile', accountNumber: ACCOUNT, ifsc: 'HDFC0001234' };

describe('Employee profile and photo (#65, #80)', () => {
  let app: FastifyInstance;
  let hasDatabase = false;
  const fx = new MembersFixtures();
  let owner: Actor;
  let desk: Actor;
  let bar: Actor;
  let member: Actor;
  let staffUser: Actor;
  const empIds: string[] = [];
  let mine: { id: string };
  let theirs: { id: string };

  const call = (method: 'GET' | 'POST' | 'PUT', url: string, actor?: Actor, payload?: object) =>
    app.inject({ method, url: `/api/v1${url}`, headers: actor ? { cookie: actor.cookie } : {}, ...(payload ? { payload } : {}) });

  async function employee(name: string, userId?: string) {
    const [row] = await fx.db
      .insert(employees)
      .values({ fullName: `${name} ${randomUUID().slice(0, 4)}`, email: 'staff@example.com', phone: '9876543210', position: 'Tester', department: 'BAR', monthlySalaryPaise: 2_500_000, hiredOn: '1990-01-01', userId: userId ?? null })
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
    mine = await employee('Profile Mine', staffUser.id);
    theirs = await employee('Profile Theirs');
  });

  afterAll(async () => {
    if (hasDatabase) {
      if (empIds.length) {
        await fx.db.delete(leaveRequests).where(inArray(leaveRequests.employeeId, empIds));
        await fx.db.delete(employeeBankDetails).where(inArray(employeeBankDetails.employeeId, empIds));
        await fx.db.delete(employees).where(inArray(employees.id, empIds));
      }
      await fx.cleanup();
    }
    await app.close();
  });

  it('401 without a session on the profile, photo and payslip routes', async () => {
    for (const [method, url] of [
      ['GET', `/hr/employees/${NO_SUCH_UUID}`],
      ['PUT', `/hr/employees/${NO_SUCH_UUID}`],
      ['GET', `/hr/employees/${NO_SUCH_UUID}/payslips`],
    ] as const) {
      expect((await call(method, url, undefined, method === 'PUT' ? { photoUrl: PHOTO } : undefined)).statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('only the owner reaches profile, photo, bank and payslip data (403 for everyone else)', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    for (const actor of [desk, bar, member, staffUser]) {
      expect((await call('GET', `/hr/employees/${theirs.id}`, actor)).statusCode).toBe(403);
      expect((await call('PUT', `/hr/employees/${theirs.id}`, actor, { photoUrl: PHOTO })).statusCode).toBe(403);
      expect((await call('GET', `/hr/employees/${theirs.id}/bank`, actor)).statusCode).toBe(403);
      expect((await call('PUT', `/hr/employees/${theirs.id}/bank`, actor, bank)).statusCode).toBe(403);
      expect((await call('GET', `/hr/employees/${theirs.id}/payslips`, actor)).statusCode).toBe(403);
    }
    // An employee cannot read their own HR profile or change their own record through the owner routes either.
    expect((await call('GET', `/hr/employees/${mine.id}`, staffUser)).statusCode).toBe(403);
    expect((await call('PUT', `/hr/employees/${mine.id}`, staffUser, { photoUrl: PHOTO, monthlySalaryPaise: 99_999_999 })).statusCode).toBe(403);
    const unchanged = (await call('GET', `/hr/employees/${mine.id}`, owner)).json();
    expect(unchanged.photoUrl).toBeNull();
    expect(unchanged.monthlySalaryPaise).toBe(2_500_000);
  });

  it('returns the profile shape, 400 for a bad id and 404 for an unknown one', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const res = await call('GET', `/hr/employees/${theirs.id}`, owner);
    expect(res.statusCode, res.body).toBe(200);
    const profile = EmployeeProfileSchema.parse(res.json());
    expect(profile).toMatchObject({ id: theirs.id, department: 'BAR', monthlySalaryPaise: 2_500_000, status: 'ACTIVE', photoUrl: null, email: 'staff@example.com', pendingLeaveRequests: 0 });
    expect((await call('GET', '/hr/employees/not-a-uuid', owner)).statusCode).toBe(400);
    expect((await call('GET', `/hr/employees/${NO_SUCH_UUID}`, owner)).statusCode).toBe(404);
    expect((await call('GET', `/hr/employees/${NO_SUCH_UUID}/payslips`, owner)).statusCode).toBe(404);
  });

  it('the owner sets, replaces and removes the photo; it shows in the profile and the list', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const set = await call('PUT', `/hr/employees/${theirs.id}`, owner, { photoUrl: PHOTO });
    expect(set.statusCode, set.body).toBe(200);
    expect(EmployeeSchema.parse(set.json()).photoUrl).toBe(PHOTO);
    expect((await call('GET', `/hr/employees/${theirs.id}`, owner)).json().photoUrl).toBe(PHOTO);
    const listed = (await call('GET', '/hr/employees', owner)).json().find((e: { id: string }) => e.id === theirs.id);
    expect(listed.photoUrl).toBe(PHOTO);

    const replaced = await call('PUT', `/hr/employees/${theirs.id}`, owner, { photoUrl: 'https://cdn.example.com/p.webp' });
    expect(replaced.json().photoUrl).toBe('https://cdn.example.com/p.webp');
    // Changing another field keeps the photo.
    expect((await call('PUT', `/hr/employees/${theirs.id}`, owner, { position: 'Lead' })).json().photoUrl).toBe('https://cdn.example.com/p.webp');

    const removed = await call('PUT', `/hr/employees/${theirs.id}`, owner, { photoUrl: null });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().photoUrl).toBeNull();
    expect((await call('GET', `/hr/employees/${theirs.id}`, owner)).json().photoUrl).toBeNull();
  });

  it('a new employee can be created with a photo, and unsafe photo URLs are rejected with 400', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const body = { fullName: `Profile Created ${randomUUID().slice(0, 4)}`, position: 'Coach', department: 'COACHING', monthlySalaryPaise: 1_000_000, hiredOn: '2026-01-01' };
    const created = await call('POST', '/hr/employees', owner, { ...body, photoUrl: PHOTO });
    expect(created.statusCode, created.body).toBe(201);
    empIds.push(created.json().id);
    expect(created.json().photoUrl).toBe(PHOTO);

    const hostile = ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'http://insecure.example/x.png', '/etc/passwd', '//evil.example/x.png', 'file:///c:/secret.png'];
    for (const bad of hostile) {
      expect((await call('POST', '/hr/employees', owner, { ...body, photoUrl: bad })).statusCode, `create ${bad}`).toBe(400);
      expect((await call('PUT', `/hr/employees/${theirs.id}`, owner, { photoUrl: bad })).statusCode, `update ${bad}`).toBe(400);
    }
    expect((await call('GET', `/hr/employees/${theirs.id}`, owner)).json().photoUrl).toBeNull();
  });

  it('bank details stay masked on every response that sits next to the profile', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    expect((await call('PUT', `/hr/employees/${theirs.id}/bank`, owner, bank)).statusCode).toBe(200);
    const responses = [
      await call('GET', `/hr/employees/${theirs.id}`, owner),
      await call('GET', `/hr/employees/${theirs.id}/bank`, owner),
      await call('GET', `/hr/employees/${theirs.id}/payslips`, owner),
      await call('GET', '/hr/employees', owner),
    ];
    for (const res of responses) {
      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain(ACCOUNT);
    }
    expect(responses[1].json()).toMatchObject({ configured: true, accountNumberMasked: expect.stringContaining('5544') });
    expect(PayslipListSchema.parse(responses[2].json())).toEqual([]);
  });
});
