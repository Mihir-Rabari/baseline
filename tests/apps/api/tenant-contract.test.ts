import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, like } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { DEFAULT_TENANT_ID, DEFAULT_TENANT_SLUG, getDb, tenantBranding, tenantDomains, tenants } from '@packages/db';
import { DomainNameSchema, HexColorSchema, TenantSlugSchema } from '@packages/validation';
import { buildApp } from '../../../apps/api/src/app.js';
import { isDatabaseAvailable } from '../../../apps/api/src/test-support/database.js';

describe('tenancy contract (shared by the control plane and the isolation work)', () => {
  const db = getDb();
  let app: FastifyInstance;
  let available = false;
  const slug = `contract-${Date.now()}`;

  beforeAll(async () => {
    app = buildApp();
    app.get('/__tenant', async (request) => ({ tenantId: request.tenantId }));
    await app.ready();
    available = await isDatabaseAvailable();
  });

  afterAll(async () => {
    if (available) await db.delete(tenants).where(like(tenants.slug, `${slug}%`));
    await app.close();
  });

  it('every request carries a tenantId, the default one until host resolution lands', async () => {
    const res = await app.inject({ method: 'GET', url: '/__tenant', headers: { host: 'anything.example.com' } });
    expect(res.json()).toEqual({ tenantId: DEFAULT_TENANT_ID });
  });

  it('the default tenant and its branding row exist after migration', async (ctx) => {
    if (!available) return ctx.skip();
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, DEFAULT_TENANT_ID));
    expect(tenant).toMatchObject({ slug: DEFAULT_TENANT_SLUG, status: 'ACTIVE' });
    const [branding] = await db.select().from(tenantBranding).where(eq(tenantBranding.tenantId, DEFAULT_TENANT_ID));
    expect(branding).toBeDefined();
  });

  it('slugs are unique, and a hostname belongs to one tenant whatever its case', async (ctx) => {
    if (!available) return ctx.skip();
    const [a] = await db.insert(tenants).values({ slug: `${slug}-a`, name: 'A' }).returning();
    const [b] = await db.insert(tenants).values({ slug: `${slug}-b`, name: 'B' }).returning();
    await expect(db.insert(tenants).values({ slug: `${slug}-a`, name: 'Dup' })).rejects.toThrow();
    await db.insert(tenantDomains).values({ tenantId: a.id, domain: `Courts-${slug}.Example.com`, verificationToken: 'tok-a' });
    await expect(
      db.insert(tenantDomains).values({ tenantId: b.id, domain: `courts-${slug}.example.com`, verificationToken: 'tok-b' })
    ).rejects.toThrow();
    // Deleting a tenant removes its domains and branding.
    await db.insert(tenantBranding).values({ tenantId: a.id, primaryColor: '#112233' });
    await db.delete(tenants).where(eq(tenants.id, a.id));
    expect(await db.select().from(tenantDomains).where(eq(tenantDomains.tenantId, a.id))).toHaveLength(0);
    expect(await db.select().from(tenantBranding).where(eq(tenantBranding.tenantId, a.id))).toHaveLength(0);
  });
});

describe('tenancy validation helpers', () => {
  it('accepts clean slugs and domains and rejects anything that could escape a hostname or path', () => {
    for (const ok of ['my-club', 'club1', 'abc']) expect(TenantSlugSchema.safeParse(ok).success, ok).toBe(true);
    for (const bad of ['ab', '-club', 'club-', 'my club', 'a/b', 'UPPER_CASE', 'club.example', '../etc']) expect(TenantSlugSchema.safeParse(bad).success, bad).toBe(false);
    expect(DomainNameSchema.parse('Courts.Example.COM')).toBe('courts.example.com');
    for (const bad of ['localhost', 'http://example.com', 'example.com/path', 'example.com:8080', 'exa mple.com', '-a.example.com', 'example', '1.2.3.4', '*.example.com']) {
      expect(DomainNameSchema.safeParse(bad).success, bad).toBe(false);
    }
    expect(HexColorSchema.safeParse('#1a73e8').success).toBe(true);
    for (const bad of ['1a73e8', '#fff', '#12345g', 'red', 'url(javascript:alert(1))']) expect(HexColorSchema.safeParse(bad).success, bad).toBe(false);
  });
});
