import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../../apps/api/src/app.js';
import { isDatabaseAvailable } from '../../../apps/api/src/test-support/database.js';
import { MembersFixtures, type Actor } from '../../../apps/api/src/test-support/members-fixtures.js';
import { detectImage } from '../../../apps/api/src/lib/images.js';

// Smallest valid-looking files: only the signature matters for detection.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 2)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(16, 3)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const HTML = Buffer.from('<html><script>alert(1)</script></html>');
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(32)]);

describe('image detection (unit)', () => {
  it('recognises JPEG, PNG and WebP by their bytes and nothing else', () => {
    expect(detectImage(PNG)?.ext).toBe('png');
    expect(detectImage(JPEG)?.ext).toBe('jpg');
    expect(detectImage(WEBP)?.ext).toBe('webp');
    for (const bad of [SVG, HTML, GIF, Buffer.alloc(0), Buffer.from('RIFF....WAVE'), Buffer.from([0xff, 0xd8])]) expect(detectImage(bad)).toBeNull();
  });
});

describe('Image uploads (#80)', () => {
  let app: FastifyInstance;
  let hasDatabase = false;
  let storageUp = false;
  const fx = new MembersFixtures();
  let owner: Actor;
  let bar: Actor;
  let desk: Actor;
  let member: Actor;

  const upload = (kind: string, body: Buffer | string, type: string, actor?: Actor) =>
    app.inject({ method: 'POST', url: `/api/v1/uploads/${kind}`, headers: { 'content-type': type, ...(actor ? { cookie: actor.cookie } : {}) }, payload: body });

  beforeAll(async () => {
    app = buildApp();
    MembersFixtures.spreadClientIps(app);
    await app.ready();
    hasDatabase = await isDatabaseAvailable();
    storageUp = (await app.storage.healthCheck()).status === 'ok';
    if (!hasDatabase) return;
    owner = await fx.actor(app, 'OWNER');
    bar = await fx.actor(app, 'BAR_STAFF');
    desk = await fx.actor(app, 'FRONT_DESK');
    member = await fx.actor(app, 'MEMBER');
  });

  afterAll(async () => {
    if (hasDatabase) await fx.cleanup();
    await app.close();
  });

  it('401 without a session', async () => {
    expect((await upload('product', PNG, 'image/png')).statusCode).toBe(401);
  });

  it('403 when the role may not upload that kind (privilege escalation)', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    expect((await upload('product', PNG, 'image/png', member)).statusCode).toBe(403);
    expect((await upload('product', PNG, 'image/png', bar)).statusCode).toBe(403);
    expect((await upload('menu', PNG, 'image/png', desk)).statusCode).toBe(403);
    expect((await upload('court', PNG, 'image/png', bar)).statusCode).toBe(403);
    expect((await upload('employee', PNG, 'image/png', desk)).statusCode).toBe(403);
    expect((await upload('club', PNG, 'image/png', member)).statusCode).toBe(403);
  });

  it('400 for an unknown kind; 415 for a non-image content type', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    expect((await upload('passwd', PNG, 'image/png', owner)).statusCode).toBe(400);
    expect((await upload('product', PNG, 'image/svg+xml', owner)).statusCode).toBe(415);
    expect((await upload('product', 'hello', 'text/plain', owner)).statusCode).toBe(415);
    expect((await upload('product', GIF, 'image/gif', owner)).statusCode).toBe(415);
  });

  it('422 when the bytes are not the image they claim to be (SVG, HTML, mismatch)', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    for (const [body, type] of [[SVG, 'image/png'], [HTML, 'image/jpeg'], [GIF, 'image/webp'], [PNG, 'image/jpeg'], [Buffer.alloc(0), 'image/png']] as const) {
      const res = await upload('product', body, type, owner);
      expect([415, 422], `${type} ${body.length}`).toContain(res.statusCode);
    }
  });

  it('413 for an image over 5 MB', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024 + 1, 9)]);
    expect((await upload('product', big, 'image/png', owner)).statusCode).toBe(413);
  });

  it('stores an image and serves it publicly with safe headers', async (ctx) => {
    if (!hasDatabase || !storageUp) return ctx.skip();
    for (const [kind, body, type, actor] of [['product', PNG, 'image/png', owner], ['menu', JPEG, 'image/jpeg', owner], ['court', WEBP, 'image/webp', owner], ['avatar', PNG, 'image/png', member]] as const) {
      const res = await upload(kind, body, type, actor);
      expect(res.statusCode, kind).toBe(201);
      const out = res.json();
      expect(out.url).toMatch(new RegExp(`^/api/v1/media/${kind}/[0-9a-f-]{36}\\.(png|jpg|webp)$`));
      expect(out.size).toBe(body.length);
      const served = await app.inject({ method: 'GET', url: out.url });
      expect(served.statusCode).toBe(200);
      expect(served.headers['content-type']).toBe(type);
      expect(served.headers['x-content-type-options']).toBe('nosniff');
      expect(served.headers['content-security-policy']).toContain("default-src 'none'");
      expect(Buffer.compare(served.rawPayload, body)).toBe(0);
      await app.storage.delete(out.key);
    }
  });

  it('never serves anything but a well-formed upload name (no traversal, no other extensions)', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const id = '123e4567-e89b-42d3-a456-426614174000';
    for (const url of [`/api/v1/media/product/..%2F..%2Fetc%2Fpasswd`, `/api/v1/media/product/${id}.svg`, `/api/v1/media/product/${id}.html`, `/api/v1/media/product/${id}.png.exe`, `/api/v1/media/secrets/${id}.png`, '/api/v1/media/product/x.png']) {
      expect((await app.inject({ method: 'GET', url })).statusCode, url).toBe(400);
    }
    // A well-formed name for an object that does not exist is a 404. Use an empty in-memory store so the
    // result never depends on MinIO being reachable (without it the real client throws and the route is a 500).
    const real = app.storage;
    (app as unknown as { storage: unknown }).storage = { get: async () => null };
    try {
      expect((await app.inject({ method: 'GET', url: `/api/v1/media/product/${id}.png` })).statusCode).toBe(404);
    } finally {
      (app as unknown as { storage: unknown }).storage = real;
    }
  });

  it('returns a correlated 404 for a missing image and preserves storage failures as 500', async () => {
    const get = vi.spyOn(app.storage, 'get');
    const url = '/api/v1/media/product/123e4567-e89b-42d3-a456-426614174000.png';
    try {
      get.mockResolvedValueOnce(null);
      const missing = await app.inject({ method: 'GET', url });
      expect(missing.statusCode).toBe(404);
      expect(missing.json()).toMatchObject({ code: 'NOT_FOUND', requestId: missing.headers['x-request-id'] });

      get.mockRejectedValueOnce(new Error('Storage connection unavailable'));
      const unavailable = await app.inject({ method: 'GET', url });
      expect(unavailable.statusCode).toBe(500);
      expect(unavailable.body).not.toContain('Storage connection unavailable');
    } finally {
      get.mockRestore();
    }
  });

  it('accepts an uploaded or https image on a product, and rejects script URLs', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const make = (imageUrl: string, n: number) =>
      app.inject({ method: 'POST', url: '/api/v1/products', headers: { cookie: owner.cookie }, payload: { sku: `IMG-${Date.now()}-${n}`, name: 'Image test', category: 'ACCESSORY', pricePaise: 100, stockQty: 0, imageUrl } });
    for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'http://insecure.example/x.png', '/etc/passwd']) {
      expect((await make(bad, 1)).statusCode, bad).toBe(400);
    }
    const ok = await make('/api/v1/media/product/123e4567-e89b-42d3-a456-426614174000.png', 2);
    expect(ok.statusCode).toBe(201);
    expect(ok.json().imageUrl).toBe('/api/v1/media/product/123e4567-e89b-42d3-a456-426614174000.png');
    await app.inject({ method: 'PUT', url: `/api/v1/products/${ok.json().id}`, headers: { cookie: owner.cookie }, payload: { isActive: false } });
    const external = await make('https://cdn.example.com/a.png', 3);
    expect(external.statusCode).toBe(201);
    await app.inject({ method: 'PUT', url: `/api/v1/products/${external.json().id}`, headers: { cookie: owner.cookie }, payload: { isActive: false } });
  });
});
