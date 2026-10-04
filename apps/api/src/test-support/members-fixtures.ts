import { randomUUID } from 'node:crypto';
import { eq, inArray, and } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { DEFAULT_TENANT_ID, getDb,
  invoices,
  memberCheckins,
  members,
  memberships,
  payments,
  plans,
  roles,
  userRoles,
  users } from '@packages/db';

export type ActorRole = 'MEMBER' | 'FRONT_DESK' | 'OWNER' | 'BAR_STAFF';

export interface Actor {
  id: string;
  cookie: string;
}

/** Tracks everything a test file creates so it can be removed in dependency order afterwards. */
export class MembersFixtures {
  readonly db = getDb();
  readonly userIds: string[] = [];
  readonly planIds: string[] = [];
  readonly memberIds: string[] = [];

  /**
   * The global per-IP rate limit (100/min) is far below what these suites send, so every
   * injected request gets its own client address. Test-only; production limits are untouched.
   */
  static spreadClientIps(app: FastifyInstance): void {
    const rawInject = app.inject.bind(app) as (opts: object) => Promise<unknown>;
    let n = 0;
    (app as unknown as { inject: (opts: object) => Promise<unknown> }).inject = (opts) => {
      n += 1;
      return rawInject({ remoteAddress: `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`, ...opts });
    };
  }

  /** Signs a user up through the real API, then swaps it onto exactly one domain role. */
  async actor(app: FastifyInstance, role: ActorRole): Promise<Actor> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email: `m10-${randomUUID()}@example.com`, password: 'Password123!', name: `M10 ${role}` },
    });
    if (res.statusCode !== 201) throw new Error(`signup failed: ${res.statusCode}`);
    const id = res.json().user.id as string;
    this.userIds.push(id);
    const cookie = res.cookies.find((c) => c.name === 'app_session');
    await this.db.delete(userRoles).where(eq(userRoles.userId, id));
    const [roleRow] = await this.db.select().from(roles).where(and(eq(roles.tenantId, DEFAULT_TENANT_ID), eq(roles.name, role))).limit(1);
    if (!roleRow) throw new Error(`role ${role} is not seeded; run pnpm db:seed`);
    await this.db.insert(userRoles).values({ userId: id, roleId: roleRow.id });
    return { id, cookie: `app_session=${cookie!.value}` };
  }

  async plan(overrides: Partial<typeof plans.$inferInsert> = {}): Promise<typeof plans.$inferSelect> {
    const [row] = await this.db
      .insert(plans)
      .values({
        code: `T10-${randomUUID().slice(0, 12)}`,
        name: 'M10 Test Plan',
        monthlyFeePaise: 150000,
        courtDiscountPct: 30,
        shopDiscountPct: 8,
        barDiscountPct: 5,
        ...overrides,
      })
      .returning();
    this.planIds.push(row.id);
    return row;
  }

  static phone(): string {
    return `+9198${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  }

  async cleanup(): Promise<void> {
    const { db } = this;
    // Everything hanging off members: find them by test plans, tracked ids and test users.
    const byPlan = this.planIds.length
      ? await db.select({ id: memberships.memberId }).from(memberships).where(inArray(memberships.planId, this.planIds))
      : [];
    const byUser = this.userIds.length
      ? await db.select({ id: members.id }).from(members).where(inArray(members.userId, this.userIds))
      : [];
    const memberIds = [...new Set([...this.memberIds, ...byPlan.map((r) => r.id), ...byUser.map((r) => r.id)])];
    if (memberIds.length) {
      await db.delete(memberCheckins).where(inArray(memberCheckins.memberId, memberIds));
      await db.delete(memberships).where(inArray(memberships.memberId, memberIds));
      await db.delete(payments).where(inArray(payments.memberId, memberIds));
      await db.delete(invoices).where(inArray(invoices.memberId, memberIds));
      await db.delete(members).where(inArray(members.id, memberIds));
    }
    if (this.planIds.length) await db.delete(plans).where(inArray(plans.id, this.planIds));
    if (this.userIds.length) await db.delete(users).where(inArray(users.id, this.userIds));
  }
}
