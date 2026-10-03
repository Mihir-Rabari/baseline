import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import {
  bookings,
  courtOccupancies,
  courtTypes,
  courts,
  getDb,
  members,
  memberships,
  plans,
  policies,
  policyStatements,
  socialSessions,
  socialWindows,
  userPolicies,
  users,
  type DatabaseInstance,
} from '@packages/db';
import { IamConfig } from '@packages/config';

/**
 * Self-contained fixtures for court, pricing and availability tests. They never rely on the CourtOS
 * seed: every row is created here with unique names/codes, so tests pass on a freshly migrated
 * database and on a seeded one alike.
 *
 * Two ways to keep tests isolated:
 *  - `withRollback(fn)` runs everything inside a transaction that is always rolled back (service tests).
 *  - `FixtureTracker` records ids so committed fixtures can be removed afterwards (HTTP tests, where
 *    the app uses its own pooled connection and cannot see uncommitted rows).
 */

export function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

class RollbackSignal extends Error {}

/** Runs `fn` against a transaction and rolls it back no matter what; returns whatever `fn` returned. */
export async function withRollback<T>(fn: (db: DatabaseInstance) => Promise<T>): Promise<T> {
  let result!: T;
  try {
    await getDb().transaction(async (tx) => {
      result = await fn(tx as unknown as DatabaseInstance);
      throw new RollbackSignal();
    });
  } catch (error) {
    if (!(error instanceof RollbackSignal)) throw error;
  }
  return result;
}

export interface CourtTypeInput {
  baseRatePaise?: number;
  socialFeePaise?: number;
  trialFeePaise?: number;
  socialCapacity?: number;
}

export async function createCourtType(db: DatabaseInstance, input: CourtTypeInput = {}) {
  const suffix = uniqueSuffix();
  const [row] = await db
    .insert(courtTypes)
    .values({
      code: `T_${suffix}`.toUpperCase().slice(0, 32),
      name: `Test sport ${suffix}`,
      baseRatePaise: input.baseRatePaise ?? 60000,
      socialFeePaise: input.socialFeePaise ?? 14000,
      trialFeePaise: input.trialFeePaise ?? 19900,
      socialCapacity: input.socialCapacity ?? 4,
    })
    .returning();
  return row;
}

export async function createCourt(db: DatabaseInstance, courtTypeId: string, label = 'Court', sortOrder = 0) {
  const [row] = await db
    .insert(courts)
    .values({ courtTypeId, name: `${label} ${uniqueSuffix()}`, sortOrder })
    .returning();
  return row;
}

export interface PlanInput {
  code?: string;
  courtDiscountPct?: number;
  maxBookingsPerDay?: number;
  bookingHorizonDays?: number;
}

export async function createPlan(db: DatabaseInstance, input: PlanInput = {}) {
  const suffix = uniqueSuffix();
  const [row] = await db
    .insert(plans)
    .values({
      code: (input.code ?? `P_${suffix}`).slice(0, 32),
      name: input.code ?? `Plan ${suffix}`,
      monthlyFeePaise: 100000,
      courtDiscountPct: input.courtDiscountPct ?? 0,
      maxBookingsPerDay: input.maxBookingsPerDay ?? 2,
      bookingHorizonDays: input.bookingHorizonDays ?? 14,
    })
    .returning();
  return row;
}

export async function createMember(db: DatabaseInstance, input: { userId?: string; fullName?: string } = {}) {
  const suffix = uniqueSuffix();
  const [row] = await db
    .insert(members)
    .values({
      userId: input.userId,
      memberCode: `T-${suffix}`.slice(0, 16),
      fullName: input.fullName ?? `Test Member ${suffix}`,
      phone: `+91${Math.floor(Math.random() * 9e9 + 1e9)}`,
    })
    .returning();
  return row;
}

export async function createMembership(
  db: DatabaseInstance,
  input: { memberId: string; planId: string; startsOn: string; endsOn: string; status?: 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'REPLACED' }
) {
  const [row] = await db
    .insert(memberships)
    .values({
      memberId: input.memberId,
      planId: input.planId,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      status: input.status ?? 'ACTIVE',
    })
    .returning();
  return row;
}

export async function createSocialWindow(
  db: DatabaseInstance,
  input: { weekday: number; startsTime?: string; endsTime?: string }
) {
  const [row] = await db
    .insert(socialWindows)
    .values({ weekday: input.weekday, startsTime: input.startsTime ?? '18:00', endsTime: input.endsTime ?? '22:00' })
    .returning();
  return row;
}

/** Inserts a CONFIRMED booking together with the court occupancy that actually holds the court. */
export async function createBooking(
  db: DatabaseInstance,
  input: {
    courtId: string;
    startsAt: Date;
    bookingDate: string;
    memberId?: string;
    guestName?: string;
    status?: 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
    cancelledLate?: boolean;
    socialSessionId?: string;
    kind?: 'STANDARD' | 'SOCIAL' | 'TRIAL';
    withOccupancy?: boolean;
  }
) {
  const endsAt = new Date(input.startsAt.getTime() + 60 * 60_000);
  const status = input.status ?? 'CONFIRMED';
  const [booking] = await db
    .insert(bookings)
    .values({
      courtId: input.courtId,
      kind: input.kind ?? 'STANDARD',
      memberId: input.memberId,
      guestName: input.memberId ? undefined : (input.guestName ?? 'Walk-in Guest'),
      guestPhone: input.memberId ? undefined : '+919800000000',
      socialSessionId: input.socialSessionId,
      startsAt: input.startsAt,
      endsAt,
      bookingDate: input.bookingDate,
      status,
      cancelledAt: status === 'CANCELLED' ? new Date() : undefined,
      cancelledLate: input.cancelledLate ?? false,
      basePricePaise: 60000,
      discountPct: 0,
      pricePaise: 60000,
    })
    .returning();

  const holdsCourt = input.withOccupancy ?? (status !== 'CANCELLED');
  if (holdsCourt && !input.socialSessionId) {
    await db.insert(courtOccupancies).values({
      courtId: input.courtId,
      startsAt: input.startsAt,
      endsAt,
      kind: 'BOOKING',
      bookingId: booking.id,
    });
  }
  return booking;
}

export async function createMaintenanceBlock(
  db: DatabaseInstance,
  input: { courtId: string; startsAt: Date; endsAt: Date; reason: string }
) {
  const [row] = await db
    .insert(courtOccupancies)
    .values({ courtId: input.courtId, startsAt: input.startsAt, endsAt: input.endsAt, kind: 'MAINTENANCE', reason: input.reason })
    .returning();
  return row;
}

export async function createSocialSession(
  db: DatabaseInstance,
  input: { courtId: string; startsAt: Date; capacity: number; participants?: number }
) {
  const endsAt = new Date(input.startsAt.getTime() + 60 * 60_000);
  const [session] = await db
    .insert(socialSessions)
    .values({ courtId: input.courtId, startsAt: input.startsAt, endsAt, capacity: input.capacity })
    .returning();
  await db.insert(courtOccupancies).values({
    courtId: input.courtId,
    startsAt: input.startsAt,
    endsAt,
    kind: 'SOCIAL',
    socialSessionId: session.id,
  });
  return session;
}

type PolicyKey = 'MemberPolicy' | 'FrontDeskPolicy' | 'BarStaffPolicy' | 'OwnerPolicy';

/** A throwaway ACTIVE user with a copy of one of the CourtOS role policies attached directly. */
export async function createUserWithPolicy(db: DatabaseInstance, policy: PolicyKey, status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE') {
  const suffix = uniqueSuffix();
  const [user] = await db
    .insert(users)
    .values({
      email: `court-test-${suffix}-${randomUUID().slice(0, 4)}@example.com`,
      name: `Court Test ${policy}`,
      passwordHash: 'not-a-real-hash',
      status,
    })
    .returning();

  const definition = IamConfig.policies[policy];
  const [policyRow] = await db
    .insert(policies)
    .values({ name: `court-test-${policy}-${suffix}`, description: 'court test policy', isSystem: false })
    .returning();
  for (const statement of definition.statements) {
    await db.insert(policyStatements).values({
      policyId: policyRow.id,
      effect: statement.effect,
      actions: [...statement.actions],
      resources: [...(statement.resources ?? ['*'])],
    });
  }
  await db.insert(userPolicies).values({ userId: user.id, policyId: policyRow.id });
  return { user, policyId: policyRow.id };
}

/** Records committed fixture ids and removes them (children first) when `cleanup` runs. */
export class FixtureTracker {
  courtTypeIds: string[] = [];
  courtIds: string[] = [];
  planIds: string[] = [];
  memberIds: string[] = [];
  userIds: string[] = [];
  policyIds: string[] = [];

  async cleanup(db: DatabaseInstance): Promise<void> {
    if (this.courtIds.length) {
      await db.delete(bookings).where(inArray(bookings.courtId, this.courtIds)); // occupancies cascade
      await db.delete(courtOccupancies).where(inArray(courtOccupancies.courtId, this.courtIds));
      await db.delete(socialSessions).where(inArray(socialSessions.courtId, this.courtIds));
      await db.delete(courts).where(inArray(courts.id, this.courtIds));
    }
    if (this.memberIds.length) await db.delete(members).where(inArray(members.id, this.memberIds)); // memberships cascade
    if (this.planIds.length) await db.delete(plans).where(inArray(plans.id, this.planIds));
    if (this.courtTypeIds.length) await db.delete(courtTypes).where(inArray(courtTypes.id, this.courtTypeIds));
    if (this.userIds.length) await db.delete(users).where(inArray(users.id, this.userIds)); // sessions, user_policies cascade
    if (this.policyIds.length) await db.delete(policies).where(inArray(policies.id, this.policyIds)); // statements cascade
  }
}
