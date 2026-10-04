import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { eq, like } from 'drizzle-orm';
import { getDb, roles, runInTenant, runUnscoped, tenantDomains, tenants, userRoles } from '@packages/db';

import { TenantService } from '../services/tenant.service.js';
import { nextIp, type RoleName } from './role-actors.js';

export interface ClubActor {
  id: string;
  cookie: string;
}

export interface Club {
  id: string;
  slug: string;
  /** The verified custom domain this club answers on; sent as `x-tenant-host`. */
  host: string;
  owner: ClubActor;
  desk: ClubActor;
}

/**
 * Real clubs for isolation tests: created exactly as the platform operator creates them (so each gets
 * its own seeded IAM baseline and categories), reachable on a verified host, each with an owner and a
 * front-desk account that signed up through the API on that host.
 */
export class ClubFixtures {
  readonly run = randomUUID().slice(0, 8);
  readonly clubs: Club[] = [];

  constructor(private readonly app: FastifyInstance) {}

  /** `x-tenant-host` + optional session cookie. */
  headers(club: Pick<Club, 'host'>, actor?: ClubActor): Record<string, string> {
    return { 'x-tenant-host': club.host, ...(actor ? { cookie: actor.cookie } : {}) };
  }

  request(club: Pick<Club, 'host'>, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, actor?: ClubActor, payload?: object, extra: Record<string, string> = {}): ReturnType<FastifyInstance['inject']> {
    return this.app.inject({
      method,
      url: url.startsWith('/api') ? url : `/api/v1${url}`,
      headers: { ...this.headers(club, actor), ...extra },
      ...(payload ? { payload } : {}),
    });
  }

  async actorIn(clubId: string, host: string, roleName: RoleName): Promise<ClubActor> {
    const res = await this.app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      remoteAddress: nextIp(),
      headers: { 'x-tenant-host': host },
      payload: { email: `iso-${randomUUID()}@example.com`, password: 'Password123!', name: `Iso ${roleName}` },
    });
    if (res.statusCode !== 201) throw new Error(`signup failed on ${host}: ${res.statusCode} ${res.body}`);
    const id = res.json().user.id as string;
    await runInTenant(clubId, async () => {
      const db = getDb();
      const [role] = await db.select().from(roles).where(eq(roles.name, roleName)).limit(1);
      if (!role) throw new Error(`role ${roleName} missing in club ${clubId}`);
      await db.delete(userRoles).where(eq(userRoles.userId, id));
      await db.insert(userRoles).values({ userId: id, roleId: role.id });
    });
    return { id, cookie: `app_session=${res.cookies.find((c) => c.name === 'app_session')!.value}` };
  }

  async createClub(label: string): Promise<Club> {
    const slug = `iso${this.run}-${label}`;
    const host = `${label}-${this.run}.clubs.example.org`;
    const service = new TenantService(getDb(), this.app.tenantDirectory, () => this.app.dnsVerifier, {});
    const created = await runUnscoped(async () => service.createTenant({ slug, name: `Club ${label}` }));
    await runUnscoped(async () =>
      getDb().insert(tenantDomains).values({ tenantId: created.id, domain: host, kind: 'CUSTOM', status: 'VERIFIED', verifiedAt: new Date(), verificationToken: randomUUID().replace(/-/g, '') })
    );
    this.app.tenantDirectory.invalidate();
    const owner = await this.actorIn(created.id, host, 'OWNER');
    const desk = await this.actorIn(created.id, host, 'FRONT_DESK');
    const club = { id: created.id, slug, host, owner, desk };
    this.clubs.push(club);
    return club;
  }

  /** Deleting a club cascades to everything it owns. */
  async cleanup(): Promise<void> {
    await runUnscoped(async () => getDb().delete(tenants).where(like(tenants.slug, `iso${this.run}-%`)));
    this.app.tenantDirectory.invalidate();
  }
}
