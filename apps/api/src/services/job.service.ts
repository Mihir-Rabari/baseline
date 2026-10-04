import { and, asc, eq, gte, lt } from 'drizzle-orm';
import {
  members,
  membershipEvents,
  membershipReminders,
  memberships,
  plans,
  runInTenant,
  runUnscoped,
  tenants,
  type DatabaseInstance,
  type ReminderKind,
} from '@packages/db';
import type { MembershipExpiryJobResponse } from '@packages/validation';
import { getEnv } from '@packages/config/env';
import { addDays, clubDateOf, diffDays } from '../lib/club-date.js';
import { NotificationService } from './notification.service.js';

/** How far back a missed EXPIRED reminder is still worth sending. */
const EXPIRED_REMINDER_WINDOW_DAYS = 7;
/** Reminder thresholds, tightest first. */
const THRESHOLDS: Array<{ kind: Exclude<ReminderKind, 'EXPIRED'>; days: number }> = [
  { kind: 'T1', days: 1 },
  { kind: 'T7', days: 7 },
  { kind: 'T30', days: 30 },
];

export const MEMBERSHIP_EXPIRY_INTERVAL_MS = 15 * 60 * 1000;

/** What one sweep over every active club did. */
export interface AllClubsExpiryResult {
  clubs: number;
  failed: number;
  expired: number;
  remindersCreated: number;
  perClub: Array<{ tenantId: string; slug: string; result?: MembershipExpiryJobResponse; error?: string }>;
}

interface Logger {
  info: (obj: object, msg?: string) => void;
  error: (obj: object, msg?: string) => void;
}

export class JobService {
  private readonly timeZone: string;

  constructor(
    private readonly db: DatabaseInstance,
    private readonly clock: () => Date = () => new Date(),
    timeZone?: string
  ) {
    this.timeZone = timeZone ?? getEnv().CLUB_TIMEZONE;
  }

  /**
   * Runs the membership expiry job once for every ACTIVE club, each inside that club's own database
   * scope: a club's memberships, reminders and notifications are read and written only as that club, so
   * one club's run can never touch another's rows. Suspended clubs are skipped. A failure in one club is
   * recorded and does not stop the others.
   */
  async runMembershipExpiryForAllClubs(asOf?: string): Promise<AllClubsExpiryResult> {
    const clubs = await runUnscoped(async () =>
      this.db.select({ id: tenants.id, slug: tenants.slug }).from(tenants).where(eq(tenants.status, 'ACTIVE')).orderBy(asc(tenants.slug))
    );
    const out: AllClubsExpiryResult = { clubs: clubs.length, failed: 0, expired: 0, remindersCreated: 0, perClub: [] };
    for (const club of clubs) {
      try {
        const result = await runInTenant(club.id, async () => this.runMembershipExpiry(asOf));
        out.expired += result.expired;
        out.remindersCreated += result.remindersCreated;
        out.perClub.push({ tenantId: club.id, slug: club.slug, result });
      } catch (error) {
        out.failed += 1;
        out.perClub.push({ tenantId: club.id, slug: club.slug, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return out;
  }

  /**
   * Idempotent, safe to run any number of times for the same `asOf`:
   *  1. ACTIVE memberships whose `ends_on` is before `asOf` become EXPIRED (with an event row).
   *  2. Each membership gets at most one reminder per kind (T30 / T7 / T1 / EXPIRED). The
   *     `membership_reminders` primary key decides who wins a race, and notifications also carry a
   *     dedupe key, so the member's user and the front desk are told exactly once.
   *
   * Reminders are catch-up: a membership with 5 days left gets T7 (the tightest threshold it has
   * crossed), never a burst of T30 and T7 together.
   */
  async runMembershipExpiry(asOf?: string): Promise<MembershipExpiryJobResponse> {
    const day = asOf ?? clubDateOf(this.clock(), this.timeZone);

    const expiredNow = await this.db.transaction(async (tx) => {
      const rows = await tx
        .update(memberships)
        .set({ status: 'EXPIRED', updatedAt: new Date() })
        .where(and(eq(memberships.status, 'ACTIVE'), lt(memberships.endsOn, day)))
        .returning({ id: memberships.id, memberId: memberships.memberId, planId: memberships.planId });
      if (rows.length > 0) {
        await tx.insert(membershipEvents).values(
          rows.map((r) => ({
            membershipId: r.id,
            memberId: r.memberId,
            type: 'EXPIRED' as const,
            fromPlanId: r.planId,
            note: `Expired as of ${day}`,
          }))
        );
      }
      return rows;
    });

    let remindersCreated = 0;

    // Upcoming expiries.
    const active = await this.db
      .select({
        id: memberships.id,
        memberId: memberships.memberId,
        endsOn: memberships.endsOn,
        planName: plans.name,
      })
      .from(memberships)
      .innerJoin(plans, eq(plans.id, memberships.planId))
      .where(and(eq(memberships.status, 'ACTIVE'), gte(memberships.endsOn, day)));
    for (const m of active) {
      const daysLeft = diffDays(m.endsOn, day);
      const threshold = THRESHOLDS.find((t) => daysLeft <= t.days);
      if (!threshold) continue;
      if (await this.remind(m.id, m.memberId, threshold.kind, m.planName, m.endsOn, daysLeft)) {
        remindersCreated += 1;
      }
    }

    // Lapsed memberships: the ones just expired plus any recent ones that missed their reminder.
    const recent = await this.db
      .select({
        id: memberships.id,
        memberId: memberships.memberId,
        endsOn: memberships.endsOn,
        planName: plans.name,
      })
      .from(memberships)
      .innerJoin(plans, eq(plans.id, memberships.planId))
      .where(
        and(
          eq(memberships.status, 'EXPIRED'),
          lt(memberships.endsOn, day),
          gte(memberships.endsOn, addDays(day, -EXPIRED_REMINDER_WINDOW_DAYS))
        )
      );
    const lapsed = new Map(recent.map((m) => [m.id, m]));
    for (const e of expiredNow) {
      if (lapsed.has(e.id)) continue;
      const [full] = await this.db
        .select({ endsOn: memberships.endsOn, planName: plans.name })
        .from(memberships)
        .innerJoin(plans, eq(plans.id, memberships.planId))
        .where(eq(memberships.id, e.id))
        .limit(1);
      if (full) lapsed.set(e.id, { id: e.id, memberId: e.memberId, ...full });
    }
    for (const m of lapsed.values()) {
      if (await this.remind(m.id, m.memberId, 'EXPIRED', m.planName, m.endsOn, 0)) {
        remindersCreated += 1;
      }
    }

    return { asOf: day, expired: expiredNow.length, remindersCreated };
  }

  /** Records the reminder and sends the notifications in one transaction. True when newly created. */
  private async remind(
    membershipId: string,
    memberId: string,
    kind: ReminderKind,
    planName: string,
    endsOn: string,
    daysLeft: number
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(membershipReminders)
        .values({ membershipId, kind })
        .onConflictDoNothing()
        .returning({ membershipId: membershipReminders.membershipId });
      if (inserted.length === 0) return false;

      const [member] = await tx
        .select({ userId: members.userId, fullName: members.fullName, memberCode: members.memberCode })
        .from(members)
        .where(eq(members.id, memberId))
        .limit(1);
      if (!member) return true;

      const notifications = new NotificationService(tx);
      const expired = kind === 'EXPIRED';
      const type = expired ? ('MEMBERSHIP_EXPIRED' as const) : ('MEMBERSHIP_EXPIRING' as const);
      const dedupeKey = `mship-remind:${membershipId}:${kind}`;
      const data = { membershipId, memberId, kind, endsOn };

      if (member.userId) {
        await notifications.notifyUsers(
          [member.userId],
          {
            type,
            title: expired ? 'Your membership has expired' : `Your membership expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
            body: expired
              ? `Your ${planName} membership ended on ${endsOn}. Renew at the front desk to keep your member rates.`
              : `Your ${planName} membership ends on ${endsOn}. Renew at the front desk to keep your member rates.`,
            link: '/member',
            data,
          },
          dedupeKey
        );
      }
      await notifications.notifyRole(
        ['FRONT_DESK'],
        {
          type,
          title: expired
            ? `${member.fullName} (${member.memberCode}) has expired`
            : `${member.fullName} (${member.memberCode}) expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
          body: `${planName} membership ${expired ? 'ended' : 'ends'} on ${endsOn}. Follow up about renewal.`,
          link: `/members/${memberId}`,
          data,
        },
        dedupeKey
      );
      return true;
    });
  }
}

/**
 * Starts the recurring membership-expiry run, once per active club on every tick. Returns a function
 * that stops it; call that on shutdown so the timer never keeps the process alive. Overlapping runs
 * are skipped.
 */
export function startMembershipExpiryScheduler(
  job: JobService,
  log: Logger,
  intervalMs: number = MEMBERSHIP_EXPIRY_INTERVAL_MS
): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    job
      .runMembershipExpiryForAllClubs()
      .then((result) => {
        log.info({ clubs: result.clubs, failed: result.failed, expired: result.expired, remindersCreated: result.remindersCreated }, 'Membership expiry job completed');
        for (const club of result.perClub) if (club.error) log.error({ tenantId: club.tenantId, slug: club.slug, error: club.error }, 'Membership expiry job failed for a club');
      })
      .catch((err: unknown) => log.error({ err }, 'Membership expiry job failed'))
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
