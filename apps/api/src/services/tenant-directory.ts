import { and, eq, sql } from 'drizzle-orm';
import { DEFAULT_TENANT_ID, tenantDomains, tenants, type TenantStatus } from '@packages/db';
import type { DbExecutor } from './db-types.js';

export interface ResolvedTenant {
  tenantId: string;
  status: TenantStatus;
  slug: string;
}

interface Entry {
  value: ResolvedTenant | null;
  expires: number;
}

/** Lower-cases a Host header and removes the port and any trailing dot. */
export function normalizeHost(raw: string | undefined): string {
  if (!raw) return '';
  const first = raw.split(',')[0].trim().toLowerCase();
  // [::1]:3000 or example.com:3000
  const withoutPort = first.startsWith('[') ? first.slice(0, first.indexOf(']') + 1) : first.replace(/:\d+$/, '');
  return withoutPort.replace(/\.$/, '');
}

/**
 * Maps a hostname to a tenant: `<slug>.<platform domain>` or a VERIFIED custom domain. Results are
 * cached briefly (including misses) and dropped whenever domains change.
 */
export class TenantDirectory {
  private readonly cache = new Map<string, Entry>();

  constructor(
    private readonly db: DbExecutor,
    private readonly platformDomain: string | undefined,
    private readonly ttlMs = 30_000,
    private readonly now: () => number = () => Date.now()
  ) {}

  invalidate(): void {
    this.cache.clear();
  }

  async resolve(host: string): Promise<ResolvedTenant | null> {
    if (!host) return null;
    const hit = this.cache.get(host);
    if (hit && hit.expires > this.now()) return hit.value;
    const value = await this.lookup(host);
    this.cache.set(host, { value, expires: this.now() + this.ttlMs });
    if (this.cache.size > 5000) this.cache.clear();
    return value;
  }

  private async lookup(host: string): Promise<ResolvedTenant | null> {
    const platform = this.platformDomain;
    if (platform && host.endsWith(`.${platform}`)) {
      const slug = host.slice(0, -(platform.length + 1));
      // One label only: `a.b.platform` is not a club.
      if (!slug || slug.includes('.')) return null;
      const [row] = await this.db.select({ id: tenants.id, status: tenants.status, slug: tenants.slug }).from(tenants).where(eq(tenants.slug, slug)).limit(1);
      return row ? { tenantId: row.id, status: row.status, slug: row.slug } : null;
    }
    const [row] = await this.db
      .select({ id: tenants.id, status: tenants.status, slug: tenants.slug })
      .from(tenantDomains)
      .innerJoin(tenants, eq(tenants.id, tenantDomains.tenantId))
      .where(and(sql`lower(${tenantDomains.domain}) = ${host}`, eq(tenantDomains.status, 'VERIFIED')))
      .limit(1);
    return row ? { tenantId: row.id, status: row.status, slug: row.slug } : null;
  }

  /** Is this origin one of our tenant sites? Used by CORS. */
  async isKnownHost(host: string): Promise<boolean> {
    return (await this.resolve(host)) !== null;
  }

  static readonly defaultTenant: ResolvedTenant = { tenantId: DEFAULT_TENANT_ID, status: 'ACTIVE', slug: 'default' };
}
