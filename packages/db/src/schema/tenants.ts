import { pgTable, varchar, text, uuid, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { pk, tstz, createdAt } from './_columns.js';

/** The tenant that owns every row created before multi-tenancy and every request on an unknown local host. */
export const DEFAULT_TENANT_ID = '00000000-0000-4000-8000-000000000001';
export const DEFAULT_TENANT_SLUG = 'default';

export type TenantStatus = 'ACTIVE' | 'SUSPENDED';
export type DomainKind = 'PLATFORM' | 'CUSTOM';
export type DomainStatus = 'PENDING' | 'VERIFIED' | 'FAILED';

/** A club. Each club has its own site, branding and (from the isolation work) its own data. */
export const tenants = pgTable('tenants', {
  id: pk(),
  slug: varchar('slug', { length: 63 }).notNull().unique(),
  name: varchar('name', { length: 120 }).notNull(),
  status: varchar('status', { length: 12 }).$type<TenantStatus>().notNull().default('ACTIVE'),
  createdAt: createdAt(),
});

/**
 * Hostnames that resolve to a tenant. PLATFORM rows are `<slug>.<platform domain>`; CUSTOM rows are
 * the club's own domain and only resolve once VERIFIED through a DNS TXT or CNAME check.
 */
export const tenantDomains = pgTable(
  'tenant_domains',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    domain: varchar('domain', { length: 253 }).notNull(),
    kind: varchar('kind', { length: 8 }).$type<DomainKind>().notNull().default('CUSTOM'),
    status: varchar('status', { length: 10 }).$type<DomainStatus>().notNull().default('PENDING'),
    verificationToken: varchar('verification_token', { length: 64 }).notNull(),
    verifiedAt: tstz('verified_at'),
    lastCheckedAt: tstz('last_checked_at'),
    lastError: text('last_error'),
    createdAt: createdAt(),
  },
  (t) => [
    // A hostname belongs to at most one tenant, whatever its case.
    uniqueIndex('uq_tenant_domains_domain').on(sql`lower(${t.domain})`),
    index('idx_tenant_domains_tenant').on(t.tenantId),
  ]
);

/** Logo and colour palette (hex colours). One row per tenant. */
export const tenantBranding = pgTable('tenant_branding', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  logoUrl: varchar('logo_url', { length: 512 }),
  primaryColor: varchar('primary_color', { length: 7 }),
  secondaryColor: varchar('secondary_color', { length: 7 }),
  accentColor: varchar('accent_color', { length: 7 }),
  updatedAt: tstz('updated_at').defaultNow().notNull(),
});
