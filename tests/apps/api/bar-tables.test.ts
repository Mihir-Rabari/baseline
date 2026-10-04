import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray, like } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { barTables, tabs } from '@packages/db';
import { BarTableListSchema } from '@packages/validation';
import { buildApp } from '../../../apps/api/src/app.js';
import { isDatabaseAvailable } from '../../../apps/api/src/test-support/database.js';
import { MembersFixtures, type Actor } from '../../../apps/api/src/test-support/members-fixtures.js';

const PREFIX = `BT-${randomUUID().slice(0, 6)}`;
const NO_SUCH_UUID = '00000000-0000-4000-8000-0000000000bb';

describe('Bar table management', () => {
  let app: FastifyInstance;
  let hasDatabase = false;
  const fx = new MembersFixtures();
  const db = fx.db;
  let owner: Actor;
  let bar: Actor;
  let desk: Actor;
  const tableIds: string[] = [];
  const tabIds: string[] = [];

  const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, actor?: Actor, payload?: object) =>
    app.inject({ method, url, headers: actor ? { cookie: actor.cookie } : {}, ...(payload ? { payload } : {}) });

  async function create(name: string, seats = 4) {
    const res = await call('POST', '/api/v1/bar/tables', owner, { name: `${PREFIX}-${name}`, seats });
    if (res.statusCode === 201) tableIds.push(res.json().id);
    return res;
  }

  beforeAll(async () => {
    app = buildApp();
    MembersFixtures.spreadClientIps(app);
    await app.ready();
    hasDatabase = await isDatabaseAvailable();
    if (!hasDatabase) return;
    owner = await fx.actor(app, 'OWNER');
    bar = await fx.actor(app, 'BAR_STAFF');
    desk = await fx.actor(app, 'FRONT_DESK');
  });

  afterAll(async () => {
    if (hasDatabase) {
      if (tabIds.length) await db.delete(tabs).where(inArray(tabs.id, tabIds));
      await db.delete(barTables).where(like(barTables.name, `${PREFIX}%`));
      await fx.cleanup();
    }
    await app.close();
  });

  it('401 without a session on every write', async () => {
    expect((await call('POST', '/api/v1/bar/tables', undefined, { name: 'X', seats: 2 })).statusCode).toBe(401);
    expect((await call('PUT', `/api/v1/bar/tables/${NO_SUCH_UUID}`, undefined, { seats: 2 })).statusCode).toBe(401);
    expect((await call('DELETE', `/api/v1/bar/tables/${NO_SUCH_UUID}`)).statusCode).toBe(401);
  });

  it('403 for bar staff and front desk: only the owner manages tables', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    for (const actor of [bar, desk]) {
      expect((await call('POST', '/api/v1/bar/tables', actor, { name: `${PREFIX}-nope`, seats: 2 })).statusCode).toBe(403);
      expect((await call('PUT', `/api/v1/bar/tables/${NO_SUCH_UUID}`, actor, { seats: 2 })).statusCode).toBe(403);
      expect((await call('DELETE', `/api/v1/bar/tables/${NO_SUCH_UUID}`, actor)).statusCode).toBe(403);
    }
  });

  it('400 for an empty name, zero seats or too many seats', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    for (const payload of [{ name: '  ', seats: 4 }, { name: 'T', seats: 0 }, { name: 'T', seats: 51 }, { name: 'T', seats: 2.5 }, { seats: 4 }]) {
      expect((await call('POST', '/api/v1/bar/tables', owner, payload)).statusCode).toBe(400);
    }
  });

  it('creates, lists, renames and re-seats a table', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const created = await create('A', 6);
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ name: `${PREFIX}-A`, seats: 6, isActive: true });
    const id = created.json().id as string;

    const listed = BarTableListSchema.parse((await call('GET', '/api/v1/bar/tables', bar)).json());
    expect(listed.find((t) => t.id === id)).toMatchObject({ seats: 6, status: 'FREE', openTab: null });

    const updated = await call('PUT', `/api/v1/bar/tables/${id}`, owner, { name: `${PREFIX}-A2`, seats: 8 });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ name: `${PREFIX}-A2`, seats: 8 });
  });

  it('409 for a duplicate name on create and on rename', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const first = await create('DUP1');
    const second = await create('DUP2');
    expect((await create('DUP1')).statusCode).toBe(409);
    const rename = await call('PUT', `/api/v1/bar/tables/${second.json().id}`, owner, { name: `${PREFIX}-DUP1` });
    expect(rename.statusCode).toBe(409);
    expect(rename.json()).toMatchObject({ code: 'CONFLICT' });
    expect(first.statusCode).toBe(201);
  });

  it('404 when the table does not exist', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    expect((await call('PUT', `/api/v1/bar/tables/${NO_SUCH_UUID}`, owner, { seats: 2 })).statusCode).toBe(404);
    expect((await call('DELETE', `/api/v1/bar/tables/${NO_SUCH_UUID}`, owner)).statusCode).toBe(404);
  });

  it('a switched-off table leaves the floor but owners can still list it', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const id = (await create('OFF')).json().id as string;
    expect((await call('PUT', `/api/v1/bar/tables/${id}`, owner, { isActive: false })).json().isActive).toBe(false);

    const floor = BarTableListSchema.parse((await call('GET', '/api/v1/bar/tables', bar)).json());
    expect(floor.some((t) => t.id === id)).toBe(false);
    // Bar staff cannot widen the list; only the owner gets inactive tables.
    const staffAsked = BarTableListSchema.parse((await call('GET', '/api/v1/bar/tables?includeInactive=true', bar)).json());
    expect(staffAsked.some((t) => t.id === id)).toBe(false);
    const ownerAsked = BarTableListSchema.parse((await call('GET', '/api/v1/bar/tables?includeInactive=true', owner)).json());
    expect(ownerAsked.find((t) => t.id === id)).toMatchObject({ isActive: false });
  });

  it('409 when switching off or deleting a table that has an open tab', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const id = (await create('BUSY')).json().id as string;
    const opened = await call('POST', '/api/v1/bar/tabs', bar, { tableId: id, guestName: 'Walk-in' });
    expect(opened.statusCode).toBe(201);
    tabIds.push(opened.json().id);

    const off = await call('PUT', `/api/v1/bar/tables/${id}`, owner, { isActive: false });
    expect(off.statusCode).toBe(409);
    expect(off.json()).toMatchObject({ code: 'TABLE_OCCUPIED' });
    const del = await call('DELETE', `/api/v1/bar/tables/${id}`, owner);
    expect(del.statusCode).toBe(409);
    expect((await db.select().from(barTables).where(eq(barTables.id, id))).length).toBe(1);
  });

  it('deletes an unused table outright', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const id = (await create('GONE')).json().id as string;
    const res = await call('DELETE', `/api/v1/bar/tables/${id}`, owner);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deleted: true, deactivated: false });
    expect(await db.select().from(barTables).where(eq(barTables.id, id))).toHaveLength(0);
  });

  it('switches off, instead of deleting, a table whose tabs are in the history', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const id = (await create('HIST')).json().id as string;
    const opened = await call('POST', '/api/v1/bar/tabs', bar, { tableId: id, guestName: 'Walk-in' });
    tabIds.push(opened.json().id);
    // Close the tab so the table is free, but keep the row so the table has history.
    await db.update(tabs).set({ status: 'VOID' }).where(eq(tabs.id, opened.json().id));

    const res = await call('DELETE', `/api/v1/bar/tables/${id}`, owner);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deleted: false, deactivated: true });
    const [row] = await db.select().from(barTables).where(eq(barTables.id, id));
    expect(row.isActive).toBe(false);
  });
});
