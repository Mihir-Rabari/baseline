import { fileURLToPath } from 'node:url';
import { eq, inArray, like, sql } from 'drizzle-orm';
import { hashPassword } from '@packages/shared/crypto';
import { getEnv } from '@packages/config/env';
import { closeDatabase, getDb, type DatabaseInstance } from './client.js';
import {
  bookings,
  courtOccupancies,
  courts,
  courtTypes,
  members,
  membershipEvents,
  memberships,
  payments,
  plans,
  roles,
  userRoles,
  users,
} from './schema/index.js';
import {
  BULK_DEFAULTS,
  BULK_EMAIL_DOMAIN,
  EXTRA_COURTS,
  generateBookings,
  generateUsers,
  type BulkOptions,
} from './seed-bulk-data.js';

/**
 * Bulk demo dataset: ~450 member logins with profiles and membership history, 10 courts, and
 * a few thousand bookings with matching payments (past 60 days and next 14).
 *
 * Idempotent: users are keyed on email, members on member_code, bookings are skipped when the
 * bulk members already have any. Requires the base seed (`pnpm db:seed`) for plans, court
 * types and the MEMBER role. Every bulk user shares one password so you can sign in as any of
 * them; it is read from BULK_SEED_PASSWORD or SEED_DEMO_PASSWORD and never printed.
 */

const log = (message: string) => console.log(`[DB] ${message}`);
const CHUNK = 500;

function chunk<T>(rows: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** Instant for a club-local wall-clock time, resolved against the club timezone. */
export function clubWallTimeToInstant(date: string, hour: number, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const asUtc = Date.UTC(y, m - 1, d, hour, 0, 0);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(new Date(asUtc));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const shown = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return new Date(asUtc - (shown - asUtc));
}

function clubToday(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
}

export interface SeedBulkOptions extends Partial<BulkOptions> {
  password?: string | null;
  timeZone?: string;
}

export interface SeedBulkResult {
  users: number;
  members: number;
  memberships: number;
  courts: number;
  bookings: number;
  payments: number;
}

export async function seedBulk(db: DatabaseInstance, options: SeedBulkOptions = {}): Promise<SeedBulkResult> {
  const timeZone = options.timeZone ?? process.env.CLUB_TIMEZONE ?? 'Asia/Kolkata';
  const opts: BulkOptions = { ...BULK_DEFAULTS, today: clubToday(timeZone), ...options };
  const password = options.password?.trim();
  if (!password) throw new Error('Set BULK_SEED_PASSWORD (or SEED_DEMO_PASSWORD) so the bulk users can sign in.');

  const [memberRole] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, 'MEMBER')).limit(1);
  if (!memberRole) throw new Error('[DB] Role MEMBER not found; run `pnpm db:seed` first.');
  const planRows = await db.select({ id: plans.id, code: plans.code, courtDiscountPct: plans.courtDiscountPct }).from(plans);
  const plan = new Map(planRows.map((p) => [p.code, p]));
  for (const code of ['GOLD', 'SILVER', 'JUNIOR']) if (!plan.has(code)) throw new Error(`[DB] Plan ${code} missing; run \`pnpm db:seed\` first.`);

  // 1. Extra courts (10 in total with the base seed).
  const typeRows = await db.select({ id: courtTypes.id, code: courtTypes.code, baseRatePaise: courtTypes.baseRatePaise }).from(courtTypes);
  const typeByCode = new Map(typeRows.map((t) => [t.code, t]));
  const existingCourts = await db.select({ name: courts.name }).from(courts);
  let sortOrder = existingCourts.length;
  for (const extra of EXTRA_COURTS) {
    const type = typeByCode.get(extra.type);
    if (!type) throw new Error(`[DB] Court type ${extra.type} missing; run \`pnpm db:seed\` first.`);
    await db.insert(courts).values({ courtTypeId: type.id, name: extra.name, sortOrder: ++sortOrder }).onConflictDoNothing({ target: courts.name });
  }
  const courtRows = await db.select({ id: courts.id, name: courts.name, courtTypeId: courts.courtTypeId }).from(courts);
  const courtByName = new Map(courtRows.map((c) => [c.name, c]));
  const rateByType = new Map(typeRows.map((t) => [t.id, t.baseRatePaise]));

  // 2. Users, MEMBER role, member profiles.
  const generated = generateUsers(opts);
  const existingUsers = new Map(
    (await db.select({ id: users.id, email: users.email }).from(users).where(like(users.email, `%@${BULK_EMAIL_DOMAIN}`))).map((u) => [u.email, u.id]),
  );
  const missingUsers = generated.filter((u) => !existingUsers.has(u.email));
  if (missingUsers.length) {
    const passwordHash = await hashPassword(password); // one hash shared by all demo users
    for (const part of chunk(missingUsers)) {
      const rows = await db
        .insert(users)
        .values(part.map((u) => ({ email: u.email, name: u.name, passwordHash, status: u.status, identityType: 'EXTERNAL_USER' as const })))
        .onConflictDoNothing({ target: users.email })
        .returning({ id: users.id, email: users.email });
      for (const r of rows) existingUsers.set(r.email, r.id);
    }
  }
  const userIds = generated.map((u) => {
    const id = existingUsers.get(u.email);
    if (!id) throw new Error(`[DB] Bulk user ${u.email} was not created`);
    return id;
  });
  for (const part of chunk(userIds)) {
    await db.insert(userRoles).values(part.map((userId) => ({ userId, roleId: memberRole.id }))).onConflictDoNothing();
  }

  const codes = generated.map((u) => u.memberCode);
  const existingMembers = new Map<string, string>();
  for (const part of chunk(codes)) {
    for (const m of await db.select({ id: members.id, code: members.memberCode }).from(members).where(inArray(members.memberCode, part))) existingMembers.set(m.code, m.id);
  }
  const newMembers = generated.map((u, i) => ({ u, i })).filter(({ u }) => !existingMembers.has(u.memberCode));
  for (const part of chunk(newMembers)) {
    const rows = await db
      .insert(members)
      .values(part.map(({ u, i }) => ({ memberCode: u.memberCode, fullName: u.name, phone: u.phone, email: u.email, dateOfBirth: u.dateOfBirth, userId: userIds[i] })))
      .onConflictDoNothing({ target: members.memberCode })
      .returning({ id: members.id, code: members.memberCode });
    for (const r of rows) existingMembers.set(r.code, r.id);
  }
  const memberIds = generated.map((u) => {
    const id = existingMembers.get(u.memberCode);
    if (!id) throw new Error(`[DB] Member ${u.memberCode} was not created`);
    return id;
  });
  await db.execute(sql`SELECT setval('member_code_seq', GREATEST((SELECT last_value FROM member_code_seq), (SELECT COALESCE(MAX(SUBSTRING(member_code FROM 4)::bigint), 0) FROM members)))`);

  // 3. Memberships (only for members that have none) with a CREATED event each.
  const haveTerms = new Set<string>();
  for (const part of chunk(memberIds)) {
    for (const r of await db.select({ memberId: memberships.memberId }).from(memberships).where(inArray(memberships.memberId, part))) haveTerms.add(r.memberId);
  }
  let membershipCount = 0;
  for (const part of chunk(generated.map((u, i) => ({ u, i })).filter(({ i }) => !haveTerms.has(memberIds[i])))) {
    const termRows = part.flatMap(({ u, i }) =>
      u.memberships.map((t) => ({ memberId: memberIds[i], planId: plan.get(u.tier)!.id, status: t.status, startsOn: t.startsOn, endsOn: t.endsOn })),
    );
    const inserted = await db.insert(memberships).values(termRows).returning({ id: memberships.id, memberId: memberships.memberId, planId: memberships.planId });
    membershipCount += inserted.length;
    await db.insert(membershipEvents).values(inserted.map((m) => ({ membershipId: m.id, memberId: m.memberId, type: 'CREATED' as const, toPlanId: m.planId, note: 'Bulk demo seed' })));
  }

  // 4. Bookings + occupancies + payments, unless the bulk members already have bookings.
  let bookingCount = 0;
  let paymentCount = 0;
  const [{ n: existingBookings }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(bookings)
    .where(inArray(bookings.memberId, memberIds.slice(0, 50)));
  if (existingBookings === 0) {
    const methods = ['UPI', 'UPI', 'CARD', 'CASH'] as const;
    for (const part of chunk(generateBookings(opts, generated), 400)) {
      const rows = part.map((b) => {
        const court = courtByName.get(b.courtName);
        if (!court) throw new Error(`[DB] Court ${b.courtName} missing`);
        const base = rateByType.get(court.courtTypeId) ?? 0;
        const discountPct = plan.get(generated[b.userIndex].tier)!.courtDiscountPct;
        const startsAt = clubWallTimeToInstant(b.date, b.hour, timeZone);
        return {
          b,
          court,
          row: {
            courtId: court.id,
            memberId: memberIds[b.userIndex],
            startsAt,
            endsAt: new Date(startsAt.getTime() + 3_600_000),
            bookingDate: b.date,
            status: b.status,
            cancelledAt: b.status === 'CANCELLED' ? new Date(startsAt.getTime() - (b.cancelledLate ? 3_600_000 : 86_400_000)) : null,
            cancelledLate: b.cancelledLate,
            cancelReason: b.status === 'CANCELLED' ? 'Plans changed' : null,
            basePricePaise: base,
            discountPct,
            pricePaise: Math.round((base * (100 - discountPct)) / 100),
            paymentStatus: b.paymentStatus,
            channel: b.channel,
          },
        };
      });
      const inserted = await db.insert(bookings).values(rows.map((r) => r.row)).returning({ id: bookings.id });
      bookingCount += inserted.length;
      const live = rows.map((r, idx) => ({ ...r, id: inserted[idx].id })).filter((r) => r.b.status !== 'CANCELLED');
      if (live.length) {
        await db.insert(courtOccupancies).values(live.map((r) => ({ courtId: r.court.id, startsAt: r.row.startsAt, endsAt: r.row.endsAt, kind: 'BOOKING' as const, bookingId: r.id })));
      }
      const paid = rows
        .map((r, idx) => ({ ...r, id: inserted[idx].id }))
        .filter((r) => r.b.paymentStatus === 'PAID' && r.row.pricePaise > 0);
      if (paid.length) {
        await db.insert(payments).values(
          paid.map((r, idx) => ({ source: 'COURT' as const, sourceId: r.id, kind: 'PAYMENT' as const, amountPaise: r.row.pricePaise, method: methods[idx % methods.length], memberId: r.row.memberId, paidAt: r.row.startsAt })),
        );
        paymentCount += paid.length;
      }
    }
  }

  const result = { users: userIds.length, members: memberIds.length, memberships: membershipCount, courts: courtRows.length, bookings: bookingCount, payments: paymentCount };
  log(`✅ Bulk demo data ready: ${result.users} users/members, ${result.courts} courts, ${result.bookings} bookings, ${result.payments} payments (${result.memberships} memberships added).`);
  return result;
}


if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const env = getEnv();
  seedBulk(getDb(), { password: process.env.BULK_SEED_PASSWORD ?? env.SEED_DEMO_PASSWORD })
    .then(async () => {
      await closeDatabase();
      process.exit(0);
    })
    .catch(async (error) => {
      console.error('[DB] ❌ Bulk seed failed:', error instanceof Error ? error.message : error);
      await closeDatabase().catch(() => undefined);
      process.exit(1);
    });
}
