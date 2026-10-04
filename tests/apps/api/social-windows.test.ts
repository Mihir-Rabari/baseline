import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { getDb, socialWindows } from '@packages/db';
import { SocialWindowListSchema, SocialWindowSchema } from '@packages/validation';
import { buildApp } from '../../../apps/api/src/app.js';
import { isDatabaseAvailable } from '../../../apps/api/src/test-support/database.js';
import { FixtureTracker, createSocialWindow, createUserWithPolicy } from '../../../apps/api/src/test-support/court-fixtures.js';

const NO_SUCH_UUID = '00000000-0000-4000-8000-0000000000aa';

describe('Social window routes', () => {
  let app: FastifyInstance;
  let hasDatabase = false;
  const tracker = new FixtureTracker();
  const windowIds: string[] = [];
  let windowId = '';
  const cookies: Record<'member' | 'frontDesk' | 'owner', string> = { member: '', frontDesk: '', owner: '' };

  const login = async (userId: string) => {
    const { sessionToken } = await app.sessionManager.createSession({ userId });
    return `${app.env.SESSION_COOKIE_NAME}=${sessionToken}`;
  };
  const put = (id: string, payload: object, cookie?: string) =>
    app.inject({ method: 'PUT', url: `/api/v1/social-windows/${id}`, headers: cookie ? { cookie } : {}, payload });

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
    hasDatabase = await isDatabaseAvailable();
    if (!hasDatabase) return;
    const db = getDb();
    const entries = {
      member: await createUserWithPolicy(db, 'MemberPolicy'),
      frontDesk: await createUserWithPolicy(db, 'FrontDeskPolicy'),
      owner: await createUserWithPolicy(db, 'OwnerPolicy'),
    };
    for (const entry of Object.values(entries)) {
      tracker.userIds.push(entry.user.id);
      tracker.policyIds.push(entry.policyId);
    }
    cookies.member = await login(entries.member.user.id);
    cookies.frontDesk = await login(entries.frontDesk.user.id);
    cookies.owner = await login(entries.owner.user.id);
    const row = await createSocialWindow(db, { weekday: 5, startsTime: '18:00', endsTime: '22:00' }); // Friday
    windowId = row.id;
    windowIds.push(row.id);
  });

  afterAll(async () => {
    if (hasDatabase) {
      const db = getDb();
      for (const id of windowIds) await db.delete(socialWindows).where(eq(socialWindows.id, id));
      await tracker.cleanup(db);
    }
    await app.close();
  });

  describe('GET /api/v1/social-windows', () => {
    it('401 without a session', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/social-windows' });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ code: 'UNAUTHORIZED', requestId: expect.any(String) });
    });

    it.each(['member', 'frontDesk', 'owner'] as const)('200 with HH:MM times and a 0-6 weekday for %s', async (who, ctx) => {
      if (!hasDatabase) return ctx.skip();
      const res = await app.inject({ method: 'GET', url: '/api/v1/social-windows', headers: { cookie: cookies[who] } });
      expect(res.statusCode).toBe(200);
      const list = SocialWindowListSchema.parse(res.json());
      expect(list.find((w) => w.id === windowId)).toEqual({ id: windowId, weekday: 5, startsTime: '18:00', endsTime: '22:00', isActive: true });
    });
  });

  describe('PUT /api/v1/social-windows/:id', () => {
    it('401 without a session', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      expect((await put(windowId, { isActive: false })).statusCode).toBe(401);
    });

    it('adversarial: members and the front desk cannot edit a window (403) and nothing changes', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      for (const who of ['member', 'frontDesk'] as const) {
        const res = await put(windowId, { isActive: false, startsTime: '09:00' }, cookies[who]);
        expect(res.statusCode, who).toBe(403);
      }
      const [row] = await getDb().select().from(socialWindows).where(eq(socialWindows.id, windowId));
      expect(row).toMatchObject({ isActive: true, weekday: 5 });
      expect(row.startsTime.slice(0, 5)).toBe('18:00');
    });

    it('400 for weekday outside 0-6, malformed times, an unknown field type and a non-UUID id', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      for (const bad of [{ weekday: 7 }, { weekday: -1 }, { weekday: 2.5 }, { startsTime: '9am' }, { endsTime: '24:00' }, { isActive: 'yes' }]) {
        expect((await put(windowId, bad, cookies.owner)).statusCode, JSON.stringify(bad)).toBe(400);
      }
      expect((await put('not-a-uuid', { isActive: true }, cookies.owner)).statusCode).toBe(400);
    });

    it('400 when both times are sent and the end is not after the start', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      expect((await put(windowId, { startsTime: '20:00', endsTime: '20:00' }, cookies.owner)).statusCode).toBe(400);
      expect((await put(windowId, { startsTime: '21:00', endsTime: '19:00' }, cookies.owner)).statusCode).toBe(400);
    });

    it('422 when a one-sided edit would leave the stored window ending before it starts', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const late = await put(windowId, { startsTime: '22:30' }, cookies.owner);
      expect(late.statusCode).toBe(422);
      expect(late.json()).toMatchObject({ code: 'VALIDATION_ERROR', requestId: expect.any(String) });
      expect((await put(windowId, { endsTime: '17:00' }, cookies.owner)).statusCode).toBe(422);
      const [row] = await getDb().select().from(socialWindows).where(eq(socialWindows.id, windowId));
      expect([row.startsTime.slice(0, 5), row.endsTime.slice(0, 5)]).toEqual(['18:00', '22:00']);
    });

    it('404 for an unknown window', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const res = await put(NO_SUCH_UUID, { isActive: false }, cookies.owner);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ code: 'NOT_FOUND', requestId: expect.any(String) });
    });

    it('200 for the owner: updates times and the active flag and returns the window', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const res = await put(windowId, { startsTime: '17:30', endsTime: '21:30', isActive: false }, cookies.owner);
      expect(res.statusCode).toBe(200);
      expect(SocialWindowSchema.parse(res.json())).toEqual({ id: windowId, weekday: 5, startsTime: '17:30', endsTime: '21:30', isActive: false });
      const restored = await put(windowId, { isActive: true }, cookies.owner);
      expect(restored.json()).toMatchObject({ isActive: true, startsTime: '17:30' });
    });

    it('maps the API weekday 0 (Sunday) to the stored ISO weekday 7 and back', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const res = await put(windowId, { weekday: 0 }, cookies.owner);
      expect(res.statusCode).toBe(200);
      expect(res.json().weekday).toBe(0);
      const [row] = await getDb().select().from(socialWindows).where(eq(socialWindows.id, windowId));
      expect(row.weekday).toBe(7);
      expect((await put(windowId, { weekday: 5 }, cookies.owner)).json().weekday).toBe(5);
    });
  });
});
