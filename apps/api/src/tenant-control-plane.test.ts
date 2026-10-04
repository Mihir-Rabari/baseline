import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { eq, inArray, like } from 'drizzle-orm';
import { DEFAULT_TENANT_ID, getDb, systemAuditLogs, tenantBranding, tenantDomains, tenants, users } from '@packages/db';
import { TenantBrandingSchema, TenantDomainDetailSchema, TenantSiteSchema, TenantSummarySchema } from '@packages/validation';
import { buildApp } from './app.js';
import tenantPlugin, { requestHost } from './plugins/tenant.js';
import { TenantDirectory, normalizeHost } from './services/tenant-directory.js';
import type { DnsVerifier } from './lib/dns-verifier.js';
import { isDatabaseAvailable } from './test-support/database.js';
import { MembersFixtures, type Actor } from './test-support/members-fixtures.js';

const RUN = randomUUID().slice(0, 8);
const slug = (s: string) => `t${RUN}-${s}`;
const domain = (s: string) => `${s}-${RUN}.example.org`;

class FakeDns implements DnsVerifier {
  txt = new Map<string, string[][]>();
  cname = new Map<string, string[]>();
  fail = false;
  calls: string[] = [];
  async resolveTxt(name: string) { this.calls.push(`TXT ${name}`); if (this.fail) throw new Error('SERVFAIL'); return this.txt.get(name) ?? []; }
  async resolveCname(name: string) { this.calls.push(`CNAME ${name}`); if (this.fail) throw new Error('SERVFAIL'); return this.cname.get(name) ?? []; }
}

describe('host normalisation and resolution (unit)', () => {
  it('lower-cases, strips ports and trailing dots, and takes the first of a list', () => {
    expect(normalizeHost('Courts.Example.COM:8443')).toBe('courts.example.com');
    expect(normalizeHost('courts.example.com.')).toBe('courts.example.com');
    expect(normalizeHost('a.example.com, b.example.com')).toBe('a.example.com');
    expect(normalizeHost('[::1]:3000')).toBe('[::1]');
    expect(normalizeHost(undefined)).toBe('');
  });

  it('x-tenant-host wins, a forwarded host counts only behind a trusted proxy, otherwise Host', () => {
    const req = (headers: Record<string, string>) => ({ headers }) as never;
    expect(requestHost(req({ host: 'api.example.com', 'x-tenant-host': 'Club.Example.org' }), false)).toEqual({ host: 'club.example.org', hinted: true });
    expect(requestHost(req({ host: 'api.example.com', 'x-forwarded-host': 'club.example.org' }), false)).toEqual({ host: 'api.example.com', hinted: false });
    expect(requestHost(req({ host: 'api.example.com', 'x-forwarded-host': 'club.example.org' }), true)).toEqual({ host: 'club.example.org', hinted: true });
  });
});

describe('tenant plugin in production mode', () => {
  const db = getDb();
  let app: FastifyInstance;
  let available = false;
  const prodSlug = `t${RUN}-prod`;
  const suspendedSlug = `t${RUN}-susp`;

  beforeAll(async () => {
    available = await isDatabaseAvailable();
    if (!available) return;
    await db.insert(tenants).values([{ slug: prodSlug, name: 'Prod club' }, { slug: suspendedSlug, name: 'Suspended club', status: 'SUSPENDED' }]);
    app = fastify();
    // Stand-ins for the plugins the tenant plugin depends on, with production settings.
    await app.register(fp(async (f) => { f.decorate('env', { NODE_ENV: 'production', TRUST_PROXY: 'false', PLATFORM_DOMAIN: 'plat.example.org' } as never); }, { name: 'app-config' }));
    await app.register(fp(async (f) => { f.decorate('db', db as never); }, { name: 'app-services' }));
    await app.register(tenantPlugin);
    app.get('/ping', async (request) => ({ tenantId: request.tenantId }));
    app.get('/health', async () => ({ ok: true }));
    await app.ready();
  });

  afterAll(async () => {
    if (available) await db.delete(tenants).where(like(tenants.slug, `t${RUN}-%`));
    if (app) await app.close();
  });

  it('serves a platform subdomain, refuses unknown and nested ones, and keeps probes host-free', async (ctx) => {
    if (!available) return ctx.skip();
    const ping = (headers: Record<string, string>) => app.inject({ method: 'GET', url: '/ping', headers });
    const ok = await ping({ 'x-tenant-host': `${prodSlug}.plat.example.org` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().tenantId).not.toBe(DEFAULT_TENANT_ID);
    expect((await ping({ 'x-tenant-host': 'unknown.plat.example.org' })).statusCode).toBe(404);
    expect((await ping({ 'x-tenant-host': `a.${prodSlug}.plat.example.org` })).statusCode).toBe(404);
    expect((await ping({ 'x-tenant-host': 'random.example.net' })).statusCode).toBe(404);
    const suspended = await ping({ 'x-tenant-host': `${suspendedSlug}.plat.example.org` });
    expect(suspended.statusCode).toBe(403);
    expect(suspended.json().code).toBe('TENANT_SUSPENDED');
    expect((await app.inject({ method: 'GET', url: '/health', headers: { 'x-tenant-host': 'random.example.net' } })).statusCode).toBe(200);
    // The API's own address (a plain Host nobody claimed) is not an error; preflights are never refused.
    expect((await app.inject({ method: 'GET', url: '/ping', headers: { host: 'api.internal' } })).json().tenantId).toBe(DEFAULT_TENANT_ID);
    expect((await app.inject({ method: 'OPTIONS', url: '/ping', headers: { 'x-tenant-host': 'random.example.net' } })).body).not.toContain('TENANT_NOT_FOUND');
  });

  it('a spoofed x-forwarded-host is ignored unless the proxy is trusted', async (ctx) => {
    if (!available) return ctx.skip();
    const res = await app.inject({ method: 'GET', url: '/ping', headers: { host: 'api.internal', 'x-forwarded-host': `${prodSlug}.plat.example.org` } });
    expect(res.json().tenantId).toBe(DEFAULT_TENANT_ID);
  });

  it('caches lookups briefly and drops them on invalidate', async (ctx) => {
    if (!available) return ctx.skip();
    let clock = 0;
    const dir = new TenantDirectory(db, 'plat.example.org', 1000, () => clock);
    const host = `t${RUN}-late.plat.example.org`;
    expect(await dir.resolve(host)).toBeNull();
    await db.insert(tenants).values({ slug: `t${RUN}-late`, name: 'Late' });
    expect(await dir.resolve(host)).toBeNull(); // cached miss
    clock = 1500;
    expect(await dir.resolve(host)).not.toBeNull(); // ttl passed
    await db.delete(tenants).where(eq(tenants.slug, `t${RUN}-late`));
    expect(await dir.resolve(host)).not.toBeNull(); // cached hit
    dir.invalidate();
    expect(await dir.resolve(host)).toBeNull();
  });
});

describe('Tenant control plane (database)', () => {
  const db = getDb();
  let app: FastifyInstance;
  let available = false;
  let dns: FakeDns;
  const fx = new MembersFixtures();
  let owner: Actor;
  let desk: Actor;
  let member: Actor;
  let root: Actor;
  let otherOwner: Actor;
  let otherTenantId: string;

  const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, actor?: Actor, payload?: object, host?: string) =>
    app.inject({ method, url: `/api/v1${url}`, headers: { ...(actor ? { cookie: actor.cookie } : {}), ...(host ? { 'x-tenant-host': host } : {}) }, ...(payload ? { payload } : {}) });

  beforeAll(async () => {
    available = await isDatabaseAvailable();
    app = buildApp();
    MembersFixtures.spreadClientIps(app);
    await app.ready();
    dns = new FakeDns();
    app.dnsVerifier = dns;
    if (!available) return;
    owner = await fx.actor(app, 'OWNER');
    desk = await fx.actor(app, 'FRONT_DESK');
    member = await fx.actor(app, 'MEMBER');
    root = await fx.actor(app, 'OWNER');
    await db.update(users).set({ identityType: 'ROOT' }).where(eq(users.id, root.id));
    // The signup session was created before the change, so sign in again to get a ROOT session.
    const [{ email }] = await db.select({ email: users.email }).from(users).where(eq(users.id, root.id));
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'Password123!' } });
    root = { id: root.id, cookie: `app_session=${login.cookies.find((c) => c.name === 'app_session')!.value}` };
    const [other] = await db.insert(tenants).values({ slug: slug('other'), name: 'Other club' }).returning();
    otherTenantId = other.id;
    await db.insert(tenantBranding).values({ tenantId: other.id });
    await db.insert(tenantDomains).values({ tenantId: other.id, domain: domain('other'), status: 'VERIFIED', verificationToken: 'x', verifiedAt: new Date() });
    // The other club's own owner: sessions are bound to a club, so the default club's owner cannot act there.
    otherOwner = await fx.actor(app, 'OWNER', domain('other'));
  });

  afterAll(async () => {
    if (available) {
      await fx.cleanup(); // users (and their sessions) go before the clubs they belong to
      const mine = (await db.select({ id: tenants.id }).from(tenants).where(like(tenants.slug, `t${RUN}-%`))).map((t) => t.id);
      if (mine.length) await db.delete(systemAuditLogs).where(inArray(systemAuditLogs.tenantId, mine));
      await db.delete(tenants).where(like(tenants.slug, `t${RUN}-%`));
      await db.delete(tenantDomains).where(like(tenantDomains.domain, `%-${RUN}.example.org`));
    }
    await app.close();
  });

  it('401 without a session on every management route, 403 for staff and members', async (ctx) => {
    if (!available) return ctx.skip();
    const id = randomUUID();
    const routes: Array<['GET' | 'POST' | 'PUT' | 'DELETE', string, object?]> = [
      ['PUT', '/tenant/branding', { primaryColor: '#112233' }], ['GET', '/tenant/domains'], ['POST', '/tenant/domains', { domain: 'x.example.org' }],
      ['GET', `/tenant/domains/${id}`], ['POST', `/tenant/domains/${id}/verify`], ['DELETE', `/tenant/domains/${id}`],
      ['GET', '/platform/tenants'], ['POST', '/platform/tenants', { slug: 'abc', name: 'x' }], ['PUT', `/platform/tenants/${id}/status`, { status: 'SUSPENDED' }],
    ];
    for (const [method, url, body] of routes) {
      expect((await call(method, url, undefined, body)).statusCode, `${method} ${url}`).toBe(401);
      for (const actor of [desk, member]) expect((await call(method, url, actor, body)).statusCode, `${method} ${url}`).toBe(403);
    }
    // Club owners cannot manage clubs themselves; only the platform operator can.
    for (const [method, url, body] of routes.filter((r) => r[1].startsWith('/platform'))) expect((await call(method, url, owner, body)).statusCode, `${method} ${url}`).toBe(403);
  });

  it('serves the club site and branding to anyone', async (ctx) => {
    if (!available) return ctx.skip();
    const site = TenantSiteSchema.parse((await call('GET', '/tenant')).json());
    expect(site.slug).toBe('default');
    expect(TenantBrandingSchema.parse((await call('GET', '/tenant/branding')).json())).toBeDefined();
  });

  it('resolves a verified custom domain to its tenant, ignoring case and ports, and never an unverified one', async (ctx) => {
    if (!available) return ctx.skip();
    const other = TenantSiteSchema.parse((await call('GET', '/tenant', undefined, undefined, domain('other').toUpperCase() + ':8443')).json());
    expect(other.slug).toBe(slug('other'));
    const pending = await call('POST', '/tenant/domains', owner, { domain: domain('pending') });
    expect(pending.statusCode).toBe(201);
    // Not verified yet: the host falls back to the default tenant (development) rather than resolving.
    expect(TenantSiteSchema.parse((await call('GET', '/tenant', undefined, undefined, domain('pending'))).json()).slug).toBe('default');
  });

  it('updates branding with validated colours and refuses injection', async (ctx) => {
    if (!available) return ctx.skip();
    const ok = await call('PUT', '/tenant/branding', otherOwner, { primaryColor: '#1A73E8', accentColor: '#ff8800', logoUrl: 'https://cdn.example.org/logo.png' }, domain('other'));
    expect(ok.statusCode, ok.body).toBe(200);
    expect(TenantBrandingSchema.parse(ok.json())).toMatchObject({ primaryColor: '#1a73e8', accentColor: '#ff8800', logoUrl: 'https://cdn.example.org/logo.png', secondaryColor: null });
    // Branding landed on the other tenant, not the default one.
    const [otherRow] = await db.select().from(tenantBranding).where(eq(tenantBranding.tenantId, otherTenantId));
    expect(otherRow.primaryColor).toBe('#1a73e8');
    const [defaultRow] = await db.select().from(tenantBranding).where(eq(tenantBranding.tenantId, DEFAULT_TENANT_ID));
    expect(defaultRow.primaryColor).not.toBe('#1a73e8');
    // The default club's owner has no standing on the other club's host.
    expect([401, 403]).toContain((await call('PUT', '/tenant/branding', owner, { primaryColor: '#000000' }, domain('other'))).statusCode);
    for (const bad of [{ primaryColor: 'red' }, { primaryColor: '#12345' }, { primaryColor: 'red; background:url(//evil)' }, { accentColor: 'url(javascript:alert(1))' }, { logoUrl: 'javascript:alert(1)' }, { logoUrl: 'data:image/png;base64,AAAA' }, {}]) {
      expect((await call('PUT', '/tenant/branding', owner, bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
    expect((await call('PUT', '/tenant/branding', otherOwner, { accentColor: null }, domain('other'))).json().accentColor).toBeNull();
  });

  it('adds a domain, returns the DNS records, verifies through DNS and then resolves it', async (ctx) => {
    if (!available) return ctx.skip();
    const name = domain('mine');
    const created = await call('POST', '/tenant/domains', owner, { domain: name.toUpperCase() });
    expect(created.statusCode, created.body).toBe(201);
    const d = TenantDomainDetailSchema.parse(created.json());
    expect(d).toMatchObject({ domain: name, kind: 'CUSTOM', status: 'PENDING', verifiedAt: null });
    const txt = d.dnsRecords.find((r) => r.type === 'TXT')!;
    expect(txt).toMatchObject({ name: `_baseline-verify.${name}`, purpose: 'ownership' });
    expect(txt.value).toMatch(/^[0-9a-f]{48}$/);

    // No record yet: FAILED with a readable reason, still retryable.
    const early = await call('POST', `/tenant/domains/${d.id}/verify`, owner);
    expect(early.json()).toMatchObject({ status: 'FAILED' });
    expect(early.json().lastError).toContain('_baseline-verify');
    // A wrong token is refused.
    dns.txt.set(txt.name, [['not-the-token']]);
    expect((await call('POST', `/tenant/domains/${d.id}/verify`, owner)).json().status).toBe('FAILED');
    // The right token verifies.
    dns.txt.set(txt.name, [[txt.value.slice(0, 20), txt.value.slice(20)]]);
    const ok = await call('POST', `/tenant/domains/${d.id}/verify`, owner);
    expect(ok.json()).toMatchObject({ status: 'VERIFIED', lastError: null });
    expect(ok.json().verifiedAt).toBeTruthy();
    expect(TenantSiteSchema.parse((await call('GET', '/tenant', undefined, undefined, name)).json()).slug).toBe('default');
    expect((await call('GET', `/tenant/domains/${d.id}`, owner)).json().status).toBe('VERIFIED');
    // Only DNS records were requested: no connection to the domain itself.
    expect(dns.calls.every((c) => c.startsWith('TXT ') || c.startsWith('CNAME '))).toBe(true);
  });

  it('a DNS outage is a retryable failure, not a crash', async (ctx) => {
    if (!available) return ctx.skip();
    const created = (await call('POST', '/tenant/domains', owner, { domain: domain('outage') })).json();
    dns.fail = true;
    const res = await call('POST', `/tenant/domains/${created.id}/verify`, owner);
    dns.fail = false;
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'FAILED', lastError: 'The DNS lookup failed. Try again in a few minutes.' });
  });

  it('rejects bad, reserved and duplicate domains', async (ctx) => {
    if (!available) return ctx.skip();
    for (const bad of ['localhost', 'http://x.example.org', 'x.example.org/path', 'x.example.org:8080', '1.2.3.4', '*.example.org', 'internal', '169.254.169.254', '-a.example.org']) {
      expect((await call('POST', '/tenant/domains', owner, { domain: bad })).statusCode, bad).toBe(400);
    }
    const name = domain('dup');
    expect((await call('POST', '/tenant/domains', owner, { domain: name })).statusCode).toBe(201);
    const again = await call('POST', '/tenant/domains', owner, { domain: name.toUpperCase() });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('DOMAIN_TAKEN');
    // A domain already verified for another tenant cannot be claimed.
    expect((await call('POST', '/tenant/domains', owner, { domain: domain('other') })).statusCode).toBe(409);
  });

  it('a club cannot see, verify or delete another club\'s domains', async (ctx) => {
    if (!available) return ctx.skip();
    const mine = (await call('POST', '/tenant/domains', owner, { domain: domain('isolated') })).json();
    const otherHost = domain('other');
    // The default club's owner session is refused outright on the other club's host.
    for (const [method, url] of [['GET', `/tenant/domains/${mine.id}`], ['POST', `/tenant/domains/${mine.id}/verify`], ['DELETE', `/tenant/domains/${mine.id}`], ['GET', '/tenant/domains']] as const) {
      expect([401, 403], `${method} ${url}`).toContain((await call(method, url, owner, undefined, otherHost)).statusCode);
    }
    // The other club's real owner is authorised there but cannot see the row.
    expect((await call('GET', `/tenant/domains/${mine.id}`, otherOwner, undefined, otherHost)).statusCode).toBe(404);
    expect((await call('POST', `/tenant/domains/${mine.id}/verify`, otherOwner, undefined, otherHost)).statusCode).toBe(404);
    expect((await call('DELETE', `/tenant/domains/${mine.id}`, otherOwner, undefined, otherHost)).statusCode).toBe(404);
    const list = (await call('GET', '/tenant/domains', otherOwner, undefined, otherHost)).json() as Array<{ id: string }>;
    expect(list.map((x) => x.id)).not.toContain(mine.id);
    expect((await call('GET', `/tenant/domains/${mine.id}`, owner)).statusCode).toBe(200);
  });

  it('limits custom domains per club and removes them', async (ctx) => {
    if (!available) return ctx.skip();
    const existing = ((await call('GET', '/tenant/domains', owner)).json() as Array<{ id: string; kind: string }>).filter((x) => x.kind === 'CUSTOM');
    for (const x of existing) expect((await call('DELETE', `/tenant/domains/${x.id}`, owner)).statusCode).toBe(204);
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const res = await call('POST', '/tenant/domains', owner, { domain: domain(`limit${i}`) });
      expect(res.statusCode, res.body).toBe(201);
      ids.push(res.json().id);
    }
    const sixth = await call('POST', '/tenant/domains', owner, { domain: domain('limit5') });
    expect(sixth.statusCode).toBe(422);
    expect(sixth.json().code).toBe('DOMAIN_LIMIT');
    expect((await call('DELETE', `/tenant/domains/${ids[0]}`, owner)).statusCode).toBe(204);
    expect((await call('GET', `/tenant/domains/${ids[0]}`, owner)).statusCode).toBe(404);
  });

  it('rate limits verification attempts', async (ctx) => {
    if (!available) return ctx.skip();
    // Rate limiting is keyed by client address, so reuse one address for this burst.
    const created = (await call('POST', '/tenant/domains', owner, { domain: domain('burst') })).json();
    const hit = () => app.inject({ method: 'POST', url: `/api/v1/tenant/domains/${created.id}/verify`, remoteAddress: '10.250.0.1', headers: { cookie: owner.cookie } });
    const codes: number[] = [];
    for (let i = 0; i < 8; i += 1) codes.push((await hit()).statusCode);
    expect(codes.slice(0, 5).every((c) => c === 200)).toBe(true);
    expect(codes.slice(5).some((c) => c === 429)).toBe(true);
  });

  it('the platform operator creates, lists and suspends clubs', async (ctx) => {
    if (!available) return ctx.skip();
    expect((await call('POST', '/platform/tenants', root, { slug: 'AB', name: 'x' })).statusCode).toBe(400);
    expect((await call('POST', '/platform/tenants', root, { slug: 'has space', name: 'x' })).statusCode).toBe(400);
    const created = await call('POST', '/platform/tenants', root, { slug: slug('new'), name: 'New club' });
    expect(created.statusCode, created.body).toBe(201);
    const summary = TenantSummarySchema.parse(created.json());
    expect(summary).toMatchObject({ slug: slug('new'), status: 'ACTIVE' });
    const [branding] = await db.select().from(tenantBranding).where(eq(tenantBranding.tenantId, summary.id));
    expect(branding).toBeDefined();
    expect((await call('POST', '/platform/tenants', root, { slug: slug('new'), name: 'Dup' })).statusCode).toBe(409);
    const listed = (await call('GET', '/platform/tenants', root)).json() as Array<{ id: string }>;
    expect(listed.map((t) => t.id)).toContain(summary.id);
    expect((await call('PUT', `/platform/tenants/${summary.id}/status`, root, { status: 'SUSPENDED' })).json().status).toBe('SUSPENDED');
    expect((await call('PUT', `/platform/tenants/${randomUUID()}/status`, root, { status: 'SUSPENDED' })).statusCode).toBe(404);
    expect((await call('PUT', `/platform/tenants/${summary.id}/status`, root, { status: 'GONE' })).statusCode).toBe(400);
  });
});
