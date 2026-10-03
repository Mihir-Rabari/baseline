import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, like } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { members, membershipEvents, membershipReminders, memberships, notifications } from '@packages/db';
import { MembershipExpiryJobResponseSchema } from '@packages/validation';
import { buildApp } from './app.js';
import { JobService, startMembershipExpiryScheduler } from './services/job.service.js';
import { isDatabaseAvailable } from './test-support/database.js';
import { MembersFixtures, type Actor } from './test-support/members-fixtures.js';

/**
 * These tests use dates in 2020 so that running the job as-of those days can only ever touch the
 * rows created here; real and parallel-test memberships end years later and are never selected.
 */
describe('Membership expiry job (M-10)', () => {
  let app: FastifyInstance;
  let hasDatabase = false;
  const fx = new MembersFixtures();
  const db = fx.db;
  let owner: Actor;
  let desk: Actor;
  let memberLogin: Actor;
  let jobs: JobService;

  async function seedMembership(endsOn: string, withLogin = true) {
    const plan = await fx.plan();
    const login = withLogin ? await fx.actor(app, 'MEMBER') : null;
    const [member] = await db
      .insert(members)
      .values({
        memberCode: `CC-8${String(Math.floor(Math.random() * 1e5)).padStart(5, '0')}`,
        fullName: 'Expiry Subject',
        phone: MembersFixtures.phone(),
        userId: login?.id ?? null,
      })
      .returning();
    fx.memberIds.push(member.id);
    const [membership] = await db
      .insert(memberships)
      .values({ memberId: member.id, planId: plan.id, status: 'ACTIVE', startsOn: '2020-01-01', endsOn })
      .returning();
    return { member, membership, login };
  }

  const remindersOf = (membershipId: string) =>
    db.select().from(membershipReminders).where(eq(membershipReminders.membershipId, membershipId));
  const notificationsFor = (userId: string, membershipId: string) =>
    db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, userId), like(notifications.dedupeKey, `mship-remind:${membershipId}:%`)));

  beforeAll(async () => {
    app = buildApp();
    MembersFixtures.spreadClientIps(app);
    await app.ready();
    hasDatabase = await isDatabaseAvailable();
    if (hasDatabase) {
      owner = await fx.actor(app, 'OWNER');
      desk = await fx.actor(app, 'FRONT_DESK');
      memberLogin = await fx.actor(app, 'MEMBER');
      jobs = new JobService(db);
    }
  });

  afterAll(async () => {
    if (hasDatabase) await fx.cleanup();
    await app.close();
  });

  it('creates each reminder once for the member and the front desk even when run three times', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const { membership, login } = await seedMembership('2020-03-30');

    const first = await jobs.runMembershipExpiry('2020-03-25'); // 5 days left -> T7
    expect(first.remindersCreated).toBeGreaterThanOrEqual(1);
    await jobs.runMembershipExpiry('2020-03-25');
    await jobs.runMembershipExpiry('2020-03-25');

    expect((await remindersOf(membership.id)).map((r) => r.kind)).toEqual(['T7']);
    const memberNotes = await notificationsFor(login!.id, membership.id);
    expect(memberNotes).toHaveLength(1);
    expect(memberNotes[0]).toMatchObject({ type: 'MEMBERSHIP_EXPIRING', dedupeKey: `mship-remind:${membership.id}:T7:${login!.id}` });
    expect(memberNotes[0].title).toContain('5 days');
    expect(await notificationsFor(desk.id, membership.id)).toHaveLength(1);
    // The owner is not a front desk recipient.
    expect(await notificationsFor(owner.id, membership.id)).toHaveLength(0);
  });

  it('walks T30 -> T7 -> T1 -> EXPIRED as the date advances, one reminder per kind', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const { membership } = await seedMembership('2020-05-31');
    for (const asOf of ['2020-05-02', '2020-05-02', '2020-05-25', '2020-05-30', '2020-05-31', '2020-06-01', '2020-06-01']) {
      await jobs.runMembershipExpiry(asOf);
    }
    const kinds = (await remindersOf(membership.id)).map((r) => r.kind).sort();
    expect(kinds).toEqual(['EXPIRED', 'T1', 'T30', 'T7']);
  });

  it('flips an ACTIVE membership to EXPIRED the day after ends_on and writes an event', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const { membership, login } = await seedMembership('2020-07-10');

    const onLastDay = await jobs.runMembershipExpiry('2020-07-10');
    expect(onLastDay.expired).toBe(0);
    expect((await db.select().from(memberships).where(eq(memberships.id, membership.id)))[0].status).toBe('ACTIVE');

    const next = await jobs.runMembershipExpiry('2020-07-11');
    expect(next.asOf).toBe('2020-07-11');
    expect(next.expired).toBeGreaterThanOrEqual(1);
    expect(next.remindersCreated).toBeGreaterThanOrEqual(1);
    expect((await db.select().from(memberships).where(eq(memberships.id, membership.id)))[0].status).toBe('EXPIRED');
    const events = await db.select().from(membershipEvents).where(eq(membershipEvents.membershipId, membership.id));
    expect(events.map((e) => e.type)).toEqual(['EXPIRED']);

    const expiredNote = (await notificationsFor(login!.id, membership.id)).find((n) => n.type === 'MEMBERSHIP_EXPIRED');
    expect(expiredNote?.title).toBe('Your membership has expired');
    expect(await notificationsFor(desk.id, membership.id)).not.toHaveLength(0);

    // Re-running does not expire it again or repeat anything.
    const again = await jobs.runMembershipExpiry('2020-07-11');
    expect(again.expired).toBe(0);
    expect((await remindersOf(membership.id)).filter((r) => r.kind === 'EXPIRED')).toHaveLength(1);
  });

  it('is safe under concurrent runs: still one reminder and one notification per recipient', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const { membership, login } = await seedMembership('2020-09-30');
    await Promise.all([1, 2, 3, 4].map(() => jobs.runMembershipExpiry('2020-09-29')));
    expect(await remindersOf(membership.id)).toHaveLength(1); // T1
    expect(await notificationsFor(login!.id, membership.id)).toHaveLength(1);
    expect(await notificationsFor(desk.id, membership.id)).toHaveLength(1);
  });

  it('a member without a login still produces the front desk task', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const { membership } = await seedMembership('2020-10-15', false);
    await jobs.runMembershipExpiry('2020-10-14');
    expect(await remindersOf(membership.id)).toHaveLength(1);
    expect(await notificationsFor(desk.id, membership.id)).toHaveLength(1);
  });

  it('ignores memberships with plenty of time left', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const { membership } = await seedMembership('2020-12-31');
    await jobs.runMembershipExpiry('2020-11-01'); // 60 days left
    expect(await remindersOf(membership.id)).toHaveLength(0);
  });

  describe('POST /admin/jobs/membership-expiry', () => {
    it('lets the owner run it with asOf and returns the contract shape', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const { membership } = await seedMembership('2020-02-10');
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/jobs/membership-expiry',
        headers: { cookie: owner.cookie },
        payload: { asOf: '2020-02-11' },
      });
      expect(res.statusCode).toBe(200);
      const body = MembershipExpiryJobResponseSchema.parse(res.json());
      expect(body.asOf).toBe('2020-02-11');
      expect(body.expired).toBeGreaterThanOrEqual(1);
      expect((await db.select().from(memberships).where(eq(memberships.id, membership.id)))[0].status).toBe('EXPIRED');
    });

    it('defaults asOf to today and accepts an empty request', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const res = await app.inject({ method: 'POST', url: '/api/v1/admin/jobs/membership-expiry', headers: { cookie: owner.cookie } });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('rejects a malformed asOf (400), anonymous callers (401) and non-admins (403)', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const bad = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/jobs/membership-expiry',
        headers: { cookie: owner.cookie },
        payload: { asOf: 'tomorrow' },
      });
      expect(bad.statusCode).toBe(400);
      const anon = await app.inject({ method: 'POST', url: '/api/v1/admin/jobs/membership-expiry', payload: {} });
      expect(anon.statusCode).toBe(401);
      for (const actor of [desk, memberLogin]) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/admin/jobs/membership-expiry',
          headers: { cookie: actor.cookie },
          payload: { asOf: '2020-01-01' },
        });
        expect(res.statusCode).toBe(403);
      }
    });
  });

  describe('scheduler', () => {
    it('runs the job on every interval tick, skips overlapping runs, and stops when cleared', async () => {
      vi.useFakeTimers();
      try {
        let resolveRun: (() => void) | undefined;
        const run = vi.fn(
          () =>
            new Promise<{ asOf: string; expired: number; remindersCreated: number }>((resolve) => {
              resolveRun = () => resolve({ asOf: '2020-01-01', expired: 0, remindersCreated: 0 });
            })
        );
        const log = { info: vi.fn(), error: vi.fn() };
        const stop = startMembershipExpiryScheduler({ runMembershipExpiry: run } as unknown as JobService, log, 15 * 60 * 1000);

        await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
        expect(run).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(15 * 60 * 1000); // previous run still pending: skipped
        expect(run).toHaveBeenCalledTimes(1);
        resolveRun?.();
        await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
        expect(run).toHaveBeenCalledTimes(2);
        expect(log.info).toHaveBeenCalled();

        stop();
        resolveRun?.();
        await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
        expect(run).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('logs a failed run instead of crashing and keeps ticking', async () => {
      vi.useFakeTimers();
      try {
        const run = vi.fn().mockRejectedValue(new Error('db down'));
        const log = { info: vi.fn(), error: vi.fn() };
        const stop = startMembershipExpiryScheduler({ runMembershipExpiry: run } as unknown as JobService, log, 1000);
        await vi.advanceTimersByTimeAsync(2500);
        expect(run).toHaveBeenCalledTimes(2);
        expect(log.error).toHaveBeenCalledTimes(2);
        stop();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
