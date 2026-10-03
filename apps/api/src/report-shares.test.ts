import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { getDb, reportShares, roles, userRoles, users } from '@packages/db';
import { hashSessionToken } from '@packages/auth';
import { CreateReportShareResponseSchema, ReportShareListSchema, SharedReportResponseSchema } from '@packages/validation';
import { buildApp } from './app.js';
import { isDatabaseAvailable } from './test-support/database.js';
import { ReportShareService } from './services/report-share.service.js';

const API = '/api/v1';

describe('Report share links (S-06)', () => {
  let app: FastifyInstance;
  let hasDatabase = false;
  const db = getDb();
  const userIds: string[] = [];
  const shareIds: string[] = [];
  let owner: { id: string; cookie: string };
  let desk: { id: string; cookie: string };
  let bar: { id: string; cookie: string };
  let member: { id: string; cookie: string };
  let ipCounter = 0;
  const nextIp = () => `10.31.${(ipCounter >> 8) & 255}.${ipCounter++ & 255}`;

  const call = (method: 'GET' | 'POST' | 'DELETE', url: string, actor: { cookie: string } | null, payload?: object) =>
    app.inject({ method, url: `${API}${url}`, remoteAddress: nextIp(), headers: actor ? { cookie: actor.cookie } : undefined, payload });

  async function makeActor(roleName: 'OWNER' | 'FRONT_DESK' | 'BAR_STAFF' | null) {
    const res = await app.inject({
      method: 'POST', url: `${API}/auth/signup`, remoteAddress: nextIp(),
      payload: { email: `s06-${randomUUID()}@example.com`, password: 'Password123!', name: 'S06 Tester' },
    });
    expect(res.statusCode).toBe(201);
    const id = res.json().user.id as string;
    userIds.push(id);
    if (roleName) {
      const [role] = await db.select().from(roles).where(eq(roles.name, roleName)).limit(1);
      await db.delete(userRoles).where(eq(userRoles.userId, id));
      await db.insert(userRoles).values({ userId: id, roleId: role.id });
    }
    return { id, cookie: `app_session=${res.cookies.find((c) => c.name === 'app_session')!.value}` };
  }

  async function createShare(payload: object = {}) {
    const res = await call('POST', '/reports/shares', owner, payload);
    expect(res.statusCode).toBe(201);
    const body = CreateReportShareResponseSchema.parse(res.json());
    shareIds.push(body.id);
    return body;
  }

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
    hasDatabase = await isDatabaseAvailable();
    if (!hasDatabase) return;
    const found = await db.select({ name: roles.name }).from(roles).where(inArray(roles.name, ['OWNER', 'FRONT_DESK', 'BAR_STAFF']));
    if (found.length < 3) {
      hasDatabase = false;
      return;
    }
    owner = await makeActor('OWNER');
    desk = await makeActor('FRONT_DESK');
    bar = await makeActor('BAR_STAFF');
    member = await makeActor(null);
  }, 60_000);

  afterAll(async () => {
    if (hasDatabase) {
      if (shareIds.length) await db.delete(reportShares).where(inArray(reportShares.id, shareIds));
      if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
    }
    await app.close();
  });

  describe('owner routes: 401 and 403', () => {
    it('401 without a session on every share route', async () => {
      const id = randomUUID();
      for (const [method, url] of [['POST', '/reports/shares'], ['GET', '/reports/shares'], ['DELETE', `/reports/shares/${id}`]] as const) {
        expect((await call(method, url, null, method === 'POST' ? {} : undefined)).statusCode, `${method} ${url}`).toBe(401);
      }
    });

    it('adversarial: front desk, bar staff and members cannot create, list or revoke links', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const existing = await createShare();
      for (const actor of [desk, bar, member]) {
        expect((await call('POST', '/reports/shares', actor, {})).statusCode).toBe(403);
        expect((await call('GET', '/reports/shares', actor)).statusCode).toBe(403);
        expect((await call('DELETE', `/reports/shares/${existing.id}`, actor)).statusCode).toBe(403);
      }
      const listed = ReportShareListSchema.parse((await call('GET', '/reports/shares', owner)).json());
      expect(listed.find((s) => s.id === existing.id)?.revokedAt).toBeNull();
    });
  });

  describe('POST /reports/shares', () => {
    it('201 returns the token and url once, stores only the hash and defaults to month / 7 days', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const before = Date.now();
      const share = await createShare();
      expect(share.defaultRange).toBe('month');
      expect(share.url.endsWith(`/share/${share.token}`)).toBe(true);
      const days = (Date.parse(share.expiresAt) - before) / 86_400_000;
      expect(days).toBeGreaterThan(6.99);
      expect(days).toBeLessThan(7.01);
      const [row] = await db.select().from(reportShares).where(eq(reportShares.id, share.id));
      expect(row.tokenHash).toBe(hashSessionToken(share.token));
      expect(JSON.stringify(row)).not.toContain(share.token);
    });

    it('400 for an out-of-range expiry, an unknown range and a non-integer expiry', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      for (const bad of [{ expiresInDays: 0 }, { expiresInDays: 31 }, { expiresInDays: 1.5 }, { defaultRange: 'year' }]) {
        expect((await call('POST', '/reports/shares', owner, bad)).statusCode, JSON.stringify(bad)).toBe(400);
      }
    });
  });

  describe('GET /reports/shares', () => {
    it('lists links newest first and never exposes the token or its hash', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const first = await createShare({ defaultRange: 'week' });
      const second = await createShare({ defaultRange: 'today', expiresInDays: 1 });
      const res = await call('GET', '/reports/shares', owner);
      expect(res.statusCode).toBe(200);
      const list = ReportShareListSchema.parse(res.json());
      expect(list.findIndex((s) => s.id === second.id)).toBeLessThan(list.findIndex((s) => s.id === first.id));
      expect(res.body).not.toContain(first.token);
      expect(res.body).not.toContain('tokenHash');
      expect(res.body).not.toContain(hashSessionToken(first.token));
    });
  });

  describe('GET /public/reports/shared/:token', () => {
    it('200 for a valid token: summary only with the expiry, no owed amounts or alerts', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const share = await createShare({ defaultRange: 'week' });
      const res = await call('GET', `/public/reports/shared/${share.token}`, null);
      expect(res.statusCode).toBe(200);
      const body = SharedReportResponseSchema.parse(res.json());
      expect(body.range).toBe('week');
      expect(body.expiresAt).toBe(share.expiresAt);
      expect(Object.keys(res.json())).not.toContain('owed');
      expect(Object.keys(res.json())).not.toContain('alerts');
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('lets the viewer pick another range and rejects an unknown one with 400', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const share = await createShare({ defaultRange: 'week' });
      expect((await call('GET', `/public/reports/shared/${share.token}?range=today`, null)).json().range).toBe('today');
      expect((await call('GET', `/public/reports/shared/${share.token}?range=decade`, null)).statusCode).toBe(400);
    });

    it('404 SHARE_LINK_INVALID for an unknown or malformed token, with a request id', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      for (const token of ['nope', 'a'.repeat(64), hashSessionToken('x')]) {
        const res = await call('GET', `/public/reports/shared/${token}`, null);
        expect(res.statusCode, token).toBe(404);
        expect(res.json()).toMatchObject({ code: 'SHARE_LINK_INVALID', requestId: expect.any(String) });
      }
    });

    it('adversarial: the stored hash is not a usable token', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const share = await createShare();
      const [row] = await db.select().from(reportShares).where(eq(reportShares.id, share.id));
      expect((await call('GET', `/public/reports/shared/${row.tokenHash}`, null)).statusCode).toBe(404);
    });

    it('adversarial: a revoked token stops working immediately', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const share = await createShare();
      expect((await call('GET', `/public/reports/shared/${share.token}`, null)).statusCode).toBe(200);
      const revoked = await call('DELETE', `/reports/shares/${share.id}`, owner);
      expect(revoked.statusCode).toBe(200);
      expect(revoked.json()).toMatchObject({ success: true });
      const after = await call('GET', `/public/reports/shared/${share.token}`, null);
      expect(after.statusCode).toBe(404);
      expect(after.json().code).toBe('SHARE_LINK_INVALID');
    });

    it('adversarial: an expired token stops working', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const share = await createShare();
      await db.update(reportShares).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(reportShares.id, share.id));
      const res = await call('GET', `/public/reports/shared/${share.token}`, null);
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('SHARE_LINK_INVALID');
    });
  });

  describe('custom-period links (#91)', () => {
    it('shares a fixed window: the viewer sees it and cannot widen it with ?range', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const share = await createShare({ from: '2031-03-01', to: '2031-03-10' });
      expect(share).toMatchObject({ from: '2031-03-01', to: '2031-03-10' });
      const res = await call('GET', `/public/reports/shared/${share.token}?range=month`, null);
      expect(res.statusCode).toBe(200);
      expect(SharedReportResponseSchema.parse(res.json())).toMatchObject({ range: 'custom', from: '2031-03-01', to: '2031-03-10' });
      const listed = ReportShareListSchema.parse((await call('GET', '/reports/shares', owner)).json());
      expect(listed.find((x) => x.id === share.id)).toMatchObject({ from: '2031-03-01', to: '2031-03-10' });
      expect(JSON.stringify(listed)).not.toContain(share.token);
    });

    it('400 for a half-open, reversed, mixed or over-long period', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      for (const payload of [
        { from: '2031-03-01' }, { to: '2031-03-01' }, { from: '2031-03-10', to: '2031-03-01' },
        { defaultRange: 'week', from: '2031-03-01', to: '2031-03-02' }, { from: '2030-01-01', to: '2031-03-01' }, { from: '2031-02-30', to: '2031-03-01' },
      ]) {
        expect((await call('POST', '/reports/shares', owner, payload)).statusCode, JSON.stringify(payload)).toBe(400);
      }
      expect((await call('POST', '/reports/shares', owner, { from: '2031-01-01', to: '2031-12-31' })).statusCode).toBe(201);
    });

    it('a front desk user still cannot create one', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      expect((await call('POST', '/reports/shares', desk, { from: '2031-03-01', to: '2031-03-02' })).statusCode).toBe(403);
    });
  });

  describe('DELETE /reports/shares/:id', () => {
    it('400 for a non-UUID id and 404 for an unknown one', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      expect((await call('DELETE', '/reports/shares/not-a-uuid', owner)).statusCode).toBe(400);
      const missing = await call('DELETE', `/reports/shares/${randomUUID()}`, owner);
      expect(missing.statusCode).toBe(404);
      expect(missing.json()).toMatchObject({ code: 'NOT_FOUND', requestId: expect.any(String) });
    });

    it('revoking twice keeps the first revokedAt', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const share = await createShare();
      expect((await call('DELETE', `/reports/shares/${share.id}`, owner)).statusCode).toBe(200);
      const [first] = await db.select().from(reportShares).where(eq(reportShares.id, share.id));
      await new Promise((resolve) => setTimeout(resolve, 15));
      expect((await call('DELETE', `/reports/shares/${share.id}`, owner)).statusCode).toBe(200);
      const [second] = await db.select().from(reportShares).where(eq(reportShares.id, share.id));
      expect(second.revokedAt?.getTime()).toBe(first.revokedAt?.getTime());
    });
  });

  describe('ReportShareService (unit clock)', () => {
    it('treats a link as expired exactly at expiresAt', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const start = new Date('2031-05-14T00:00:00.000Z');
      let now = start;
      const service = new ReportShareService(db, 'http://localhost:3000/', () => now);
      const created = await service.create({ expiresInDays: 1 }, owner.id);
      shareIds.push(created.id);
      expect(created.url.startsWith('http://localhost:3000/share/')).toBe(true);
      now = new Date(start.getTime() + 86_400_000 - 1);
      await expect(service.resolve(created.token)).resolves.toMatchObject({ defaultRange: 'month' });
      now = new Date(start.getTime() + 86_400_000);
      await expect(service.resolve(created.token)).rejects.toMatchObject({ code: 'SHARE_LINK_INVALID', statusCode: 404 });
    });
  });
});
