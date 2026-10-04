import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, like } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { courtTypes, courts, systemSettings } from '@packages/db';
import { buildApp } from './app.js';
import { isDatabaseAvailable } from './test-support/database.js';
import { MembersFixtures, type Actor } from './test-support/members-fixtures.js';

const CODE = `IMG${Date.now()}`.slice(0, 30);
const MEDIA = '/api/v1/media/court/123e4567-e89b-42d3-a456-426614174000.png';

describe('Court photos and club logo (#80)', () => {
  let app: FastifyInstance;
  let hasDatabase = false;
  const fx = new MembersFixtures();
  let owner: Actor;
  let desk: Actor;
  let originalProfile: unknown;
  const call = (method: 'GET' | 'POST' | 'PUT', url: string, actor?: Actor, payload?: object) =>
    app.inject({ method, url: `/api/v1${url}`, headers: actor ? { cookie: actor.cookie } : {}, ...(payload ? { payload } : {}) });

  beforeAll(async () => {
    app = buildApp();
    MembersFixtures.spreadClientIps(app);
    await app.ready();
    hasDatabase = await isDatabaseAvailable();
    if (!hasDatabase) return;
    owner = await fx.actor(app, 'OWNER');
    desk = await fx.actor(app, 'FRONT_DESK');
    const [row] = await fx.db.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, 'club.profile')).limit(1);
    originalProfile = row?.value;
  });

  afterAll(async () => {
    if (hasDatabase) {
      await fx.db.delete(courts).where(like(courts.name, `${CODE}%`));
      await fx.db.delete(courtTypes).where(like(courtTypes.code, `${CODE}%`));
      if (originalProfile !== undefined) await fx.db.update(systemSettings).set({ value: originalProfile }).where(eq(systemSettings.key, 'club.profile'));
      else await fx.db.delete(systemSettings).where(eq(systemSettings.key, 'club.profile'));
      await fx.cleanup();
    }
    await app.close();
  });

  it('a court takes an uploaded or https image, can drop it, and refuses script URLs', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const type = (await call('POST', '/court-types', owner, { code: CODE, name: 'Image sport', baseRatePaise: 1000 })).json();
    const make = (name: string, imageUrl?: string) => call('POST', '/courts', owner, { name: `${CODE} ${name}`, courtTypeId: type.id, ...(imageUrl ? { imageUrl } : {}) });
    for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'http://insecure.example/x.png', '/etc/passwd']) {
      expect((await make('bad', bad)).statusCode, bad).toBe(400);
    }
    const created = await make('one', MEDIA);
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json().imageUrl).toBe(MEDIA);
    const swapped = await call('PUT', `/courts/${created.json().id}`, owner, { imageUrl: 'https://cdn.example.com/c.webp' });
    expect(swapped.json().imageUrl).toBe('https://cdn.example.com/c.webp');
    const cleared = await call('PUT', `/courts/${created.json().id}`, owner, { imageUrl: null });
    expect(cleared.json().imageUrl).toBeNull();
    expect((await make('plain')).json().imageUrl).toBeNull();
    // Only the owner changes court details.
    expect((await call('PUT', `/courts/${created.json().id}`, desk, { imageUrl: MEDIA })).statusCode).toBe(403);
  });

  it('the club logo is set by the owner, shown on the public site, and can be removed', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const logo = '/api/v1/media/club/123e4567-e89b-42d3-a456-426614174001.png';
    expect((await call('PUT', '/club/profile', desk, { logoUrl: logo })).statusCode).toBe(403);
    expect((await call('PUT', '/club/profile', owner, { logoUrl: 'javascript:alert(1)' })).statusCode).toBe(400);
    const set = await call('PUT', '/club/profile', owner, { logoUrl: logo });
    expect(set.statusCode, set.body).toBe(200);
    expect(set.json().logoUrl).toBe(logo);
    expect((await call('GET', '/public/club')).json().logoUrl).toBe(logo);
    // Changing another field keeps the logo.
    expect((await call('PUT', '/club/profile', owner, { tagline: 'Play more' })).json().logoUrl).toBe(logo);
    expect((await call('PUT', '/club/profile', owner, { logoUrl: null })).json().logoUrl).toBeNull();
    expect((await call('GET', '/public/club')).json().logoUrl).toBeNull();
  });
});
