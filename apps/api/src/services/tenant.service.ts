import { randomBytes } from 'node:crypto';
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import { tenantBranding, tenantDomains, tenants, type DatabaseInstance } from '@packages/db';
import type {
  DnsRecord,
  TenantBranding,
  TenantDomainDetail,
  TenantSite,
  TenantSummary,
  UpdateTenantBrandingRequest,
} from '@packages/validation';
import { DomainError } from '../lib/domain-error.js';
import { UNIQUE_VIOLATION, pgCode } from '../lib/db-errors.js';
import type { DnsVerifier } from '../lib/dns-verifier.js';
import type { TenantDirectory } from './tenant-directory.js';

export const VERIFY_PREFIX = '_baseline-verify';
export const MAX_DOMAINS_PER_TENANT = 5;

type DomainRow = typeof tenantDomains.$inferSelect;

const normalizeDns = (value: string) => value.trim().toLowerCase().replace(/\.$/, '');

export interface TenantServiceOptions {
  platformDomain?: string;
  cnameTarget?: string;
  now?: () => Date;
}

/** Tenants, their domains and branding. Everything a club owner or the platform operator manages. */
export class TenantService {
  private readonly now: () => Date;

  constructor(
    private readonly db: DatabaseInstance,
    private readonly directory: TenantDirectory,
    private readonly dns: () => DnsVerifier,
    private readonly options: TenantServiceOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
  }

  // ------------------------------------------------------------------ site and branding

  async branding(tenantId: string): Promise<TenantBranding> {
    const [row] = await this.db.select().from(tenantBranding).where(eq(tenantBranding.tenantId, tenantId)).limit(1);
    return {
      logoUrl: row?.logoUrl ?? null,
      primaryColor: row?.primaryColor ?? null,
      secondaryColor: row?.secondaryColor ?? null,
      accentColor: row?.accentColor ?? null,
    };
  }

  async site(tenantId: string): Promise<TenantSite> {
    const [tenant] = await this.db.select({ slug: tenants.slug, name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (!tenant) throw new DomainError('NOT_FOUND', 404, 'Club not found.');
    return { slug: tenant.slug, name: tenant.name, branding: await this.branding(tenantId) };
  }

  async updateBranding(tenantId: string, patch: UpdateTenantBrandingRequest): Promise<TenantBranding> {
    const set = {
      ...(patch.logoUrl !== undefined && { logoUrl: patch.logoUrl }),
      ...(patch.primaryColor !== undefined && { primaryColor: patch.primaryColor?.toLowerCase() ?? null }),
      ...(patch.secondaryColor !== undefined && { secondaryColor: patch.secondaryColor?.toLowerCase() ?? null }),
      ...(patch.accentColor !== undefined && { accentColor: patch.accentColor?.toLowerCase() ?? null }),
      updatedAt: this.now(),
    };
    await this.db.insert(tenantBranding).values({ tenantId, ...set }).onConflictDoUpdate({ target: tenantBranding.tenantId, set });
    return this.branding(tenantId);
  }

  // ------------------------------------------------------------------ domains

  private records(row: DomainRow): DnsRecord[] {
    const out: DnsRecord[] = [{ type: 'TXT', name: `${VERIFY_PREFIX}.${row.domain}`, value: row.verificationToken, purpose: 'ownership' }];
    if (row.kind === 'CUSTOM' && this.options.cnameTarget) {
      out.push({ type: 'CNAME', name: row.domain, value: this.options.cnameTarget, purpose: 'routing' });
    }
    return out;
  }

  private dto(row: DomainRow): TenantDomainDetail {
    return {
      id: row.id,
      domain: row.domain,
      kind: row.kind,
      status: row.status,
      verifiedAt: row.verifiedAt?.toISOString() ?? null,
      lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
      lastError: row.lastError,
      createdAt: row.createdAt.toISOString(),
      dnsRecords: row.kind === 'PLATFORM' ? [] : this.records(row),
    };
  }

  async listDomains(tenantId: string): Promise<TenantDomainDetail[]> {
    const rows = await this.db.select().from(tenantDomains).where(eq(tenantDomains.tenantId, tenantId)).orderBy(asc(tenantDomains.createdAt));
    return rows.map((r) => this.dto(r));
  }

  /** A tenant only ever sees its own domains: an id from another tenant is simply "not found". */
  private async ownedDomain(tenantId: string, id: string): Promise<DomainRow> {
    const [row] = await this.db.select().from(tenantDomains).where(and(eq(tenantDomains.id, id), eq(tenantDomains.tenantId, tenantId))).limit(1);
    if (!row) throw new DomainError('NOT_FOUND', 404, 'Domain not found.');
    return row;
  }

  async getDomain(tenantId: string, id: string): Promise<TenantDomainDetail> {
    return this.dto(await this.ownedDomain(tenantId, id));
  }

  async addDomain(tenantId: string, domain: string): Promise<TenantDomainDetail> {
    const platform = this.options.platformDomain;
    if (platform && (domain === platform || domain.endsWith(`.${platform}`))) {
      throw new DomainError('DOMAIN_RESERVED', 422, `Addresses under ${platform} are assigned by the platform. Use your own domain.`);
    }
    const [{ n }] = await this.db.select({ n: count() }).from(tenantDomains).where(and(eq(tenantDomains.tenantId, tenantId), eq(tenantDomains.kind, 'CUSTOM')));
    if (Number(n) >= MAX_DOMAINS_PER_TENANT) {
      throw new DomainError('DOMAIN_LIMIT', 422, `A club can have at most ${MAX_DOMAINS_PER_TENANT} custom domains.`);
    }
    try {
      const [row] = await this.db
        .insert(tenantDomains)
        .values({ tenantId, domain, kind: 'CUSTOM', verificationToken: randomBytes(24).toString('hex') })
        .returning();
      return this.dto(row);
    } catch (error) {
      if (pgCode(error) === UNIQUE_VIOLATION) throw new DomainError('DOMAIN_TAKEN', 409, 'That domain is already connected to a club.');
      throw error;
    }
  }

  async removeDomain(tenantId: string, id: string): Promise<void> {
    const row = await this.ownedDomain(tenantId, id);
    if (row.kind === 'PLATFORM') throw new DomainError('DOMAIN_RESERVED', 422, 'The platform address cannot be removed.');
    await this.db.delete(tenantDomains).where(and(eq(tenantDomains.id, id), eq(tenantDomains.tenantId, tenantId)));
    this.directory.invalidate();
  }

  /**
   * Checks the DNS records: a TXT at `_baseline-verify.<domain>` holding the token (ownership), and,
   * when a platform CNAME target is configured, a CNAME pointing at it (routing). Only DNS answers
   * are read; the domain itself is never contacted, so a hostile domain cannot aim us at internal hosts.
   */
  async verifyDomain(tenantId: string, id: string): Promise<TenantDomainDetail> {
    const row = await this.ownedDomain(tenantId, id);
    if (row.kind === 'PLATFORM') return this.dto(row);
    let error: string | null = null;
    try {
      const txt = (await this.dns().resolveTxt(`${VERIFY_PREFIX}.${row.domain}`)).map((parts) => parts.join('').trim());
      if (!txt.includes(row.verificationToken)) {
        error = `The TXT record ${VERIFY_PREFIX}.${row.domain} was not found with the expected value. DNS changes can take a while to spread.`;
      } else if (this.options.cnameTarget) {
        const cnames = (await this.dns().resolveCname(row.domain)).map(normalizeDns);
        if (!cnames.includes(normalizeDns(this.options.cnameTarget))) {
          error = `${row.domain} does not point at ${this.options.cnameTarget} yet. Add the CNAME record and try again.`;
        }
      }
    } catch {
      error = 'The DNS lookup failed. Try again in a few minutes.';
    }
    const now = this.now();
    const [updated] = await this.db
      .update(tenantDomains)
      .set(error ? { status: 'FAILED', lastCheckedAt: now, lastError: error } : { status: 'VERIFIED', lastCheckedAt: now, lastError: null, verifiedAt: row.verifiedAt ?? now })
      .where(and(eq(tenantDomains.id, id), eq(tenantDomains.tenantId, tenantId)))
      .returning();
    this.directory.invalidate();
    return this.dto(updated);
  }

  // ------------------------------------------------------------------ platform operator

  private summary(row: typeof tenants.$inferSelect, platformDomain: string | null): TenantSummary {
    return { id: row.id, slug: row.slug, name: row.name, status: row.status, platformDomain, createdAt: row.createdAt.toISOString() };
  }

  async listTenants(): Promise<TenantSummary[]> {
    const rows = await this.db
      .select({ t: tenants, domain: sql<string | null>`(select domain from tenant_domains d where d.tenant_id = ${tenants.id} and d.kind = 'PLATFORM' limit 1)` })
      .from(tenants)
      .orderBy(desc(tenants.createdAt), asc(tenants.slug));
    return rows.map((r) => this.summary(r.t, r.domain));
  }

  async createTenant(input: { slug: string; name: string }): Promise<TenantSummary> {
    const platform = this.options.platformDomain;
    try {
      return await this.db.transaction(async (tx) => {
        const [row] = await tx.insert(tenants).values({ slug: input.slug, name: input.name }).returning();
        await tx.insert(tenantBranding).values({ tenantId: row.id });
        let domain: string | null = null;
        if (platform) {
          domain = `${row.slug}.${platform}`;
          await tx.insert(tenantDomains).values({
            tenantId: row.id, domain, kind: 'PLATFORM', status: 'VERIFIED', verifiedAt: this.now(), verificationToken: randomBytes(24).toString('hex'),
          });
        }
        return this.summary(row, domain);
      });
    } catch (error) {
      if (pgCode(error) === UNIQUE_VIOLATION) throw new DomainError('CONFLICT', 409, 'That address is already taken.');
      throw error;
    }
  }

  async setStatus(id: string, status: 'ACTIVE' | 'SUSPENDED'): Promise<TenantSummary> {
    const [row] = await this.db.update(tenants).set({ status }).where(eq(tenants.id, id)).returning();
    if (!row) throw new DomainError('NOT_FOUND', 404, 'Club not found.');
    this.directory.invalidate();
    const [{ domain }] = await this.db.select({ domain: sql<string | null>`(select domain from tenant_domains d where d.tenant_id = ${row.id} and d.kind = 'PLATFORM' limit 1)` }).from(tenants).where(eq(tenants.id, id));
    return this.summary(row, domain);
  }
}
