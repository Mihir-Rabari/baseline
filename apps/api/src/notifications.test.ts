import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inArray, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  getDb,
  notifications,
  roles,
  userPolicies,
  userRoles,
  users,
} from '@packages/db';
import { buildApp } from './app.js';
import { NotificationService } from './services/notification.service.js';
import { isDatabaseAvailable } from './test-support/database.js';

describe('Notifications', () => {
  let app: FastifyInstance;
  let hasDatabase = false;
  const db = getDb();
  const service = new NotificationService(db);
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];

  async function makeUser(status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE'): Promise<string> {
    const [u] = await db
      .insert(users)
      .values({
        email: `m09-n-${randomUUID()}@example.com`,
        name: 'M09 Notify Tester',
        passwordHash: 'not-a-real-hash',
        status,
      })
      .returning({ id: users.id });
    createdUserIds.push(u.id);
    return u.id;
  }

  async function signup(): Promise<{ id: string; cookie: string }> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: {
        email: `m09-s-${randomUUID()}@example.com`,
        password: 'Password123!',
        name: 'M09 Signup',
      },
    });
    expect(res.statusCode).toBe(201);
    const id = res.json().user.id as string;
    createdUserIds.push(id);
    const set = res.cookies.find((c) => c.name === 'app_session');
    return { id, cookie: `app_session=${set!.value}` };
  }

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
    hasDatabase = await isDatabaseAvailable();
  });

  afterAll(async () => {
    if (hasDatabase) {
      if (createdUserIds.length) await db.delete(users).where(inArray(users.id, createdUserIds));
      if (createdRoleIds.length) await db.delete(roles).where(inArray(roles.id, createdRoleIds));
    }
    await app.close();
  });

  describe('service: notifyRole fan-out and dedupe', () => {
    it('creates one row per active user of the role and skips suspended users', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const [role] = await db
        .insert(roles)
        .values({ name: `M09_TEST_${randomUUID()}` })
        .returning();
      createdRoleIds.push(role.id);
      const a = await makeUser();
      const b = await makeUser();
      const suspended = await makeUser('SUSPENDED');
      const outsider = await makeUser();
      await db.insert(userRoles).values([a, b, suspended].map((userId) => ({ userId, roleId: role.id })));

      const created = await service.notifyRole(
        [role.name],
        { type: 'NEW_LEAD', title: 'New lead', link: '/crm/1' },
        `m09-fanout:${randomUUID()}`
      );
      expect(created.map((n) => n.userId).sort()).toEqual([a, b].sort());
      expect(created.some((n) => n.userId === outsider)).toBe(false);
    });

    it('the same dedupe key twice creates one notification per user', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const [role] = await db
        .insert(roles)
        .values({ name: `M09_TEST_${randomUUID()}` })
        .returning();
      createdRoleIds.push(role.id);
      const a = await makeUser();
      const b = await makeUser();
      await db.insert(userRoles).values([a, b].map((userId) => ({ userId, roleId: role.id })));
      const key = `low-stock:${randomUUID()}:2026-10-03`;

      const first = await service.notifyRole([role.name], { type: 'LOW_STOCK', title: 'Low' }, key);
      const second = await service.notifyRole([role.name], { type: 'LOW_STOCK', title: 'Low' }, key);
      expect(first).toHaveLength(2);
      expect(second).toHaveLength(0);

      const rows = await db.select().from(notifications).where(inArray(notifications.userId, [a, b]));
      expect(rows).toHaveLength(2);
    });

    it('does nothing for no roles, unknown roles or no recipients', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      expect(await service.notifyRole([], { type: 'NEW_LEAD', title: 'x' })).toEqual([]);
      expect(
        await service.notifyRole([`NO_SUCH_ROLE_${randomUUID()}`], { type: 'NEW_LEAD', title: 'x' })
      ).toEqual([]);
    });

    it('rejects an over-long dedupe key instead of overflowing the column', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const a = await makeUser();
      await expect(
        service.notifyUsers([a], { type: 'NEW_LEAD', title: 'x' }, 'k'.repeat(100))
      ).rejects.toThrow(RangeError);
    });
  });

  describe('routes: authentication and validation', () => {
    it.each([
      ['GET', '/api/v1/notifications'],
      ['GET', '/api/v1/notifications/unread-count'],
      ['POST', `/api/v1/notifications/${randomUUID()}/read`],
      ['POST', '/api/v1/notifications/read-all'],
    ] as const)('%s %s returns 401 without a session', async (method, url) => {
      const res = await app.inject({ method, url });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('UNAUTHORIZED');
    });

    it('POST /notifications/:id/read rejects a non-UUID id with 400', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/notifications/not-a-uuid/read' });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    });

    it.each(['page=0', 'limit=1000', 'unread=maybe', 'order=sideways'])(
      'GET /notifications rejects invalid query %s with 400',
      async (qs) => {
        const res = await app.inject({ method: 'GET', url: `/api/v1/notifications?${qs}` });
        expect(res.statusCode).toBe(400);
        expect(res.json().code).toBe('VALIDATION_ERROR');
      }
    );
  });

  describe('routes: success shapes and ownership (database)', () => {
    it('lists, counts, marks read, and marks all read for the caller', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const me = await signup();
      const rows = await db
        .insert(notifications)
        .values([
          { userId: me.id, type: 'NEW_LEAD', title: 'One', body: 'b', link: '/crm/1' },
          { userId: me.id, type: 'LOW_STOCK', title: 'Two' },
          { userId: me.id, type: 'ONLINE_ORDER', title: 'Three' },
        ])
        .returning();

      const count = await app.inject({
        method: 'GET',
        url: '/api/v1/notifications/unread-count',
        headers: { cookie: me.cookie },
      });
      expect(count.statusCode).toBe(200);
      expect(count.json()).toEqual({ count: 3 });

      const list = await app.inject({
        method: 'GET',
        url: '/api/v1/notifications?limit=2&page=1',
        headers: { cookie: me.cookie },
      });
      expect(list.statusCode).toBe(200);
      const page = list.json();
      expect(page.data).toHaveLength(2);
      expect(page.meta).toMatchObject({ page: 1, limit: 2, totalItems: 3, totalPages: 2, hasNextPage: true });
      expect(Object.keys(page.data[0]).sort()).toEqual(
        ['body', 'createdAt', 'id', 'link', 'readAt', 'title', 'type'].sort()
      );
      expect(typeof page.data[0].createdAt).toBe('string');
      expect(page.data[0]).not.toHaveProperty('userId');

      const read = await app.inject({
        method: 'POST',
        url: `/api/v1/notifications/${rows[0].id}/read`,
        headers: { cookie: me.cookie },
      });
      expect(read.statusCode).toBe(200);
      expect(read.json().id).toBe(rows[0].id);
      expect(typeof read.json().readAt).toBe('string');

      const unread = await app.inject({
        method: 'GET',
        url: '/api/v1/notifications?unread=true',
        headers: { cookie: me.cookie },
      });
      expect(unread.json().data).toHaveLength(2);

      const readAll = await app.inject({
        method: 'POST',
        url: '/api/v1/notifications/read-all',
        headers: { cookie: me.cookie },
      });
      expect(readAll.statusCode).toBe(200);
      expect(readAll.json()).toEqual({ updated: 2 });

      const again = await app.inject({
        method: 'POST',
        url: '/api/v1/notifications/read-all',
        headers: { cookie: me.cookie },
      });
      expect(again.json()).toEqual({ updated: 0 });
    });

    it('a user cannot see or read another user\'s notification (adversarial)', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const victim = await signup();
      const attacker = await signup();
      const [secret] = await db
        .insert(notifications)
        .values({ userId: victim.id, type: 'NEW_LEAD', title: 'Victim only' })
        .returning();

      const read = await app.inject({
        method: 'POST',
        url: `/api/v1/notifications/${secret.id}/read`,
        headers: { cookie: attacker.cookie },
      });
      expect(read.statusCode).toBe(404);
      expect(read.body).not.toContain('Victim only');

      // Untouched for the victim.
      const [after] = await db.select().from(notifications).where(eq(notifications.id, secret.id));
      expect(after.readAt).toBeNull();

      const list = await app.inject({
        method: 'GET',
        url: '/api/v1/notifications',
        headers: { cookie: attacker.cookie },
      });
      expect(list.json().data).toEqual([]);
      expect(list.body).not.toContain('Victim only');

      const all = await app.inject({
        method: 'POST',
        url: '/api/v1/notifications/read-all',
        headers: { cookie: attacker.cookie },
      });
      expect(all.json()).toEqual({ updated: 0 });
      const [still] = await db.select().from(notifications).where(eq(notifications.id, secret.id));
      expect(still.readAt).toBeNull();

      const count = await app.inject({
        method: 'GET',
        url: '/api/v1/notifications/unread-count',
        headers: { cookie: attacker.cookie },
      });
      expect(count.json()).toEqual({ count: 0 });
    });

    it('returns 404 for an unknown notification id', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const me = await signup();
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/notifications/${randomUUID()}/read`,
        headers: { cookie: me.cookie },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
      expect(res.json().requestId).toBeTruthy();
    });

    it('returns 403 for an authenticated user without notification permissions', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const nobody = await signup();
      await db.delete(userRoles).where(eq(userRoles.userId, nobody.id));
      await db.delete(userPolicies).where(eq(userPolicies.userId, nobody.id));

      for (const [method, url] of [
        ['GET', '/api/v1/notifications'],
        ['GET', '/api/v1/notifications/unread-count'],
        ['POST', '/api/v1/notifications/read-all'],
        ['POST', `/api/v1/notifications/${randomUUID()}/read`],
      ] as const) {
        const res = await app.inject({ method, url, headers: { cookie: nobody.cookie } });
        expect(res.statusCode, `${method} ${url}`).toBe(403);
      }
    });
  });
});
