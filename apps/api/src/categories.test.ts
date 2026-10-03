import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, like } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { categories, courtTypes } from '@packages/db';
import { CategoryListSchema, CategorySchema } from '@packages/validation';
import { buildApp } from './app.js';
import { isDatabaseAvailable } from './test-support/database.js';
import { MembersFixtures, type Actor } from './test-support/members-fixtures.js';

const SUFFIX = randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase();
const NO_SUCH_UUID = '00000000-0000-4000-8000-0000000000cc';

describe('Managed categories and sports (#77)', () => {
  let app: FastifyInstance;
  let hasDatabase = false;
  const fx = new MembersFixtures();
  let owner: Actor;
  let bar: Actor;
  let desk: Actor;
  let member: Actor;

  const call = (method: 'GET' | 'POST' | 'PUT', url: string, actor?: Actor, payload?: object) =>
    app.inject({ method, url, headers: actor ? { cookie: actor.cookie } : {}, ...(payload ? { payload } : {}) });

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
    if (hasDatabase) {
      await fx.db.delete(categories).where(like(categories.code, `T${SUFFIX}%`));
      await fx.db.delete(courtTypes).where(like(courtTypes.code, `T${SUFFIX}%`));
      await fx.cleanup();
    }
    await app.close();
  });

  it('401 without a session on every category and sport route', async () => {
    for (const [method, url] of [
      ['GET', '/api/v1/products/categories'],
      ['POST', '/api/v1/products/categories'],
      ['PUT', `/api/v1/products/categories/${NO_SUCH_UUID}`],
      ['GET', '/api/v1/bar/categories'],
      ['POST', '/api/v1/bar/categories'],
      ['POST', '/api/v1/court-types'],
      ['PUT', `/api/v1/court-types/${NO_SUCH_UUID}`],
    ] as const) {
      const valid = { code: 'ANYTHING', name: 'x', baseRatePaise: 100 };
      const res = await call(method, url, undefined, method === 'GET' ? undefined : valid);
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('serves the active product categories publicly', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const res = await call('GET', '/api/v1/public/product-categories');
    expect(res.statusCode).toBe(200);
    const list = CategoryListSchema.parse(res.json());
    expect(list.every((c) => c.scope === 'PRODUCT' && c.isActive)).toBe(true);
    expect(list.map((c) => c.code)).toEqual(expect.arrayContaining(['RACKET', 'BALL', 'SHOE', 'ACCESSORY', 'APPAREL']));
  });

  it('403 when the caller lacks the permission (privilege escalation)', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const body = { code: `T${SUFFIX}X`, name: 'Nope' };
    for (const actor of [member, desk]) {
      expect((await call('POST', '/api/v1/bar/categories', actor, body)).statusCode).toBe(403);
      expect((await call('POST', '/api/v1/court-types', actor, { ...body, baseRatePaise: 100 })).statusCode).toBe(403);
    }
    // Bar staff run the menu, but only the owner edits the lists.
    expect((await call('POST', '/api/v1/bar/categories', bar, body)).statusCode).toBe(403);
    expect((await call('POST', '/api/v1/products/categories', bar, body)).statusCode).toBe(403);
    expect((await call('GET', '/api/v1/bar/categories', member)).statusCode).toBe(403);
  });

  it('400 for a malformed code or empty name', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const bad = [
      { code: 'lower', name: 'x' },
      { code: 'A', name: 'x' },
      { code: `T${SUFFIX}Y`, name: '  ' },
      { code: 'HAS SPACE', name: 'x' },
    ];
    for (const body of bad) {
      expect((await call('POST', '/api/v1/products/categories', owner, body)).statusCode).toBe(400);
    }
  });

  it('creates, searches, renames, switches off and refuses duplicate codes', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const code = `T${SUFFIX}P`;
    const created = await call('POST', '/api/v1/products/categories', owner, { code, name: 'Test Strings' });
    expect(created.statusCode).toBe(201);
    const row = CategorySchema.parse(created.json());
    expect(row).toMatchObject({ scope: 'PRODUCT', code, isActive: true });

    expect((await call('POST', '/api/v1/products/categories', owner, { code, name: 'Again' })).statusCode).toBe(409);
    // The same code in the other list is a different category.
    const twin = await call('POST', '/api/v1/bar/categories', owner, { code, name: 'Menu twin' });
    expect(twin.statusCode).toBe(201);

    const found = CategoryListSchema.parse((await call('GET', '/api/v1/products/categories?q=test%20str', owner)).json());
    expect(found.map((c) => c.code)).toContain(code);

    const renamed = await call('PUT', `/api/v1/products/categories/${row.id}`, owner, { name: 'Strings', sortOrder: 9 });
    expect(renamed.json()).toMatchObject({ name: 'Strings', sortOrder: 9, code });

    // A menu-category id is not reachable through the product route.
    expect((await call('PUT', `/api/v1/products/categories/${twin.json().id}`, owner, { name: 'hijack' })).statusCode).toBe(404);
    const [untouched] = await fx.db
      .select()
      .from(categories)
      .where(and(eq(categories.code, code), eq(categories.scope, 'MENU')));
    expect(untouched.name).toBe('Menu twin');

    await call('PUT', `/api/v1/products/categories/${row.id}`, owner, { isActive: false });
    const active = CategoryListSchema.parse((await call('GET', '/api/v1/products/categories', owner)).json());
    expect(active.map((c) => c.code)).not.toContain(code);
    const all = CategoryListSchema.parse((await call('GET', '/api/v1/products/categories?includeInactive=true', owner)).json());
    expect(all.map((c) => c.code)).toContain(code);
  });

  it('only accepts active categories on products and menu items', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const product = (category: string, sku: string) => ({ sku, name: 'Cat test', category, pricePaise: 1000, stockQty: 0 });
    const unknown = await call('POST', '/api/v1/products', owner, product('NOPE_CAT', `T${SUFFIX}-0`));
    expect(unknown.statusCode).toBe(422);

    const code = `T${SUFFIX}Q`;
    const made = (await call('POST', '/api/v1/products/categories', owner, { code, name: 'Q' })).json();
    const ok = await call('POST', '/api/v1/products', owner, product(code, `T${SUFFIX}-1`));
    expect(ok.statusCode).toBe(201);
    const productId = ok.json().id;

    await call('PUT', `/api/v1/products/categories/${made.id}`, owner, { isActive: false });
    // Editing a product that keeps its (now switched-off) category is fine.
    expect((await call('PUT', `/api/v1/products/${productId}`, owner, { name: 'Renamed' })).statusCode).toBe(200);
    expect((await call('PUT', `/api/v1/products/${productId}`, owner, { category: 'BALL' })).statusCode).toBe(200);
    // Moving back into a switched-off category is not.
    expect((await call('PUT', `/api/v1/products/${productId}`, owner, { category: code })).statusCode).toBe(422);
    await call('PUT', `/api/v1/products/${productId}`, owner, { isActive: false });

    const menu = await call('POST', '/api/v1/bar/menu', owner, {
      name: `T${SUFFIX} item`,
      category: 'NOPE_CAT',
      station: 'BAR',
      pricePaise: 100,
    });
    expect(menu.statusCode).toBe(422);
  });

  it('manages sports: create, duplicate 409, edit, and refuses to switch off a sport in use', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const code = `T${SUFFIX}S`;
    const created = await call('POST', '/api/v1/court-types', owner, { code, name: 'Test sport', baseRatePaise: 50000 });
    expect(created.statusCode).toBe(201);
    const type = created.json();
    expect(type).toMatchObject({ code, baseRatePaise: 50000, socialFeePaise: 0, isActive: true });
    expect((await call('POST', '/api/v1/court-types', owner, { code, name: 'Dup', baseRatePaise: 1 })).statusCode).toBe(409);
    expect((await call('POST', '/api/v1/court-types', owner, { code: 'bad code', name: 'x', baseRatePaise: 1 })).statusCode).toBe(400);
    expect((await call('POST', '/api/v1/court-types', owner, { code: `T${SUFFIX}Z`, name: 'x', baseRatePaise: -5 })).statusCode).toBe(400);

    const edited = await call('PUT', `/api/v1/court-types/${type.id}`, owner, { name: 'Renamed', baseRatePaise: 60000, socialCapacity: 12 });
    expect(edited.json()).toMatchObject({ name: 'Renamed', baseRatePaise: 60000, socialCapacity: 12, code });
    expect((await call('PUT', `/api/v1/court-types/${NO_SUCH_UUID}`, owner, { name: 'x' })).statusCode).toBe(404);

    const court = await call('POST', '/api/v1/courts', owner, { name: `T${SUFFIX} court`, courtTypeId: type.id });
    expect(court.statusCode).toBe(201);
    const blocked = await call('PUT', `/api/v1/court-types/${type.id}`, owner, { isActive: false });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe('SPORT_IN_USE');
    await call('DELETE', `/api/v1/courts/${court.json().id}`, owner);
    expect((await call('PUT', `/api/v1/court-types/${type.id}`, owner, { isActive: false })).statusCode).toBe(200);
  });
});
