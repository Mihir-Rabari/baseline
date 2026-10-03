import { and, asc, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  bookings,
  memberCheckins,
  members,
  membershipEvents,
  memberships,
  plans,
  users,
  type DatabaseInstance,
  type MembershipEventType,
} from '@packages/db';
import type {
  CheckinResponse,
  CreateMemberRequest,
  Member,
  MemberLookupItem,
  MemberListQuery,
  MemberTimelineItem,
  Membership,
  Plan,
  RenewMembershipResponse,
  UpdatePlanRequest,
  UpsertMyMemberRequest,
  CreateMemberResponse,
} from '@packages/validation';
import { getEnv } from '@packages/config/env';
import { DomainError } from '../lib/domain-error.js';
import { addDays, ageOn, clubDateOf, diffDays } from '../lib/club-date.js';
import type { DbExecutor } from './db-types.js';
import { InvoiceService } from './invoice.service.js';
import { PaymentService } from './payment.service.js';

/** A membership term is 30 days: starts_on .. starts_on + 29 (BR-09). */
export const MEMBERSHIP_TERM_DAYS = 30;
/** `expiryState` turns EXPIRING_SOON when this many days or fewer are left. */
export const EXPIRING_SOON_DAYS = 7;

type MemberRow = typeof members.$inferSelect;
type MembershipRow = typeof memberships.$inferSelect;
type PlanRow = typeof plans.$inferSelect;
type Tx = Parameters<Parameters<DatabaseInstance['transaction']>[0]>[0];
type PaymentMethodInput = CreateMemberRequest['paymentMethod'];

export interface MembershipServiceOptions {
  /** Overridable so tests can inject a failing collaborator or a fixed clock. */
  payments?: PaymentService;
  invoices?: InvoiceService;
  clock?: () => Date;
  timeZone?: string;
}

export function planToDto(row: PlanRow): Plan {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    monthlyFeePaise: row.monthlyFeePaise,
    courtDiscountPct: row.courtDiscountPct,
    shopDiscountPct: row.shopDiscountPct,
    barDiscountPct: row.barDiscountPct,
    maxBookingsPerDay: row.maxBookingsPerDay,
    bookingHorizonDays: row.bookingHorizonDays,
    minAge: row.minAge,
    maxAge: row.maxAge,
    isActive: row.isActive,
  };
}

/** Derived at read time from `ends_on` and the club date; never stored. */
export function deriveExpiry(
  status: MembershipRow['status'],
  endsOn: string,
  today: string
): { daysLeft: number; expiryState: Membership['expiryState'] } {
  const raw = diffDays(endsOn, today);
  const daysLeft = Math.max(0, raw);
  if (status !== 'ACTIVE' || raw < 0) return { daysLeft, expiryState: 'EXPIRED' };
  return { daysLeft, expiryState: raw <= EXPIRING_SOON_DAYS ? 'EXPIRING_SOON' : 'OK' };
}

function pgCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, '\\$&')}%`;
}

function formatMemberCode(n: string | number): string {
  return `CC-${String(n).padStart(6, '0')}`;
}

export class MembershipService {
  private readonly payments: PaymentService;
  private readonly invoices: InvoiceService;
  private readonly clock: () => Date;
  private readonly timeZone: string;

  constructor(
    private readonly db: DatabaseInstance,
    options: MembershipServiceOptions = {}
  ) {
    this.payments = options.payments ?? new PaymentService(db);
    this.invoices = options.invoices ?? new InvoiceService(db);
    this.clock = options.clock ?? (() => new Date());
    this.timeZone = options.timeZone ?? getEnv().CLUB_TIMEZONE;
  }

  /** The club-local calendar date right now. */
  today(): string {
    return clubDateOf(this.clock(), this.timeZone);
  }

  // ---------------------------------------------------------------- plans

  async listPlans(): Promise<Plan[]> {
    const rows = await this.db.select().from(plans).orderBy(asc(plans.sortOrder), asc(plans.code));
    return rows.map(planToDto);
  }

  async updatePlan(id: string, patch: UpdatePlanRequest): Promise<Plan> {
    const values = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined)
    ) as Partial<typeof plans.$inferInsert>;
    if (Object.keys(values).length === 0) {
      const [existing] = await this.db.select().from(plans).where(eq(plans.id, id)).limit(1);
      if (!existing) throw new DomainError('NOT_FOUND', 404, 'Plan not found');
      return planToDto(existing);
    }
    const [row] = await this.db
      .update(plans)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(plans.id, id))
      .returning();
    if (!row) throw new DomainError('NOT_FOUND', 404, 'Plan not found');
    return planToDto(row);
  }

  // ------------------------------------------------------------- read side

  /**
   * Builds contract `Member` objects. The "current" membership is the ACTIVE one if any,
   * otherwise the one that ended last. `daysLeft`/`expiryState` are derived from `today`.
   */
  async toMemberDtos(rows: MemberRow[], executor: DbExecutor = this.db): Promise<Member[]> {
    if (rows.length === 0) return [];
    const today = this.today();
    const ids = rows.map((r) => r.id);
    const termRows = await executor
      .select({ membership: memberships, plan: plans })
      .from(memberships)
      .innerJoin(plans, eq(plans.id, memberships.planId))
      .where(inArray(memberships.memberId, ids));

    const current = new Map<string, { membership: MembershipRow; plan: PlanRow }>();
    for (const term of termRows) {
      const prev = current.get(term.membership.memberId);
      if (!prev || MembershipService.isBetterCurrent(term.membership, prev.membership)) {
        current.set(term.membership.memberId, term);
      }
    }

    const pendingIds = [...current.values()]
      .map((c) => c.membership.pendingPlanId)
      .filter((v): v is string => !!v);
    const pending = new Map<string, PlanRow>();
    if (pendingIds.length > 0) {
      const pendingRows = await executor.select().from(plans).where(inArray(plans.id, pendingIds));
      for (const p of pendingRows) pending.set(p.id, p);
    }

    return rows.map((row) => {
      const cur = current.get(row.id);
      let membership: Membership | null = null;
      let entitlements = {
        courtDiscountPct: 0,
        shopDiscountPct: 0,
        barDiscountPct: 0,
        maxBookingsPerDay: 0,
        bookingHorizonDays: 0,
      };
      if (cur) {
        const { daysLeft, expiryState } = deriveExpiry(cur.membership.status, cur.membership.endsOn, today);
        const pendingPlan = cur.membership.pendingPlanId ? pending.get(cur.membership.pendingPlanId) : undefined;
        membership = {
          id: cur.membership.id,
          status: cur.membership.status,
          plan: { id: cur.plan.id, code: cur.plan.code, name: cur.plan.name },
          startsOn: cur.membership.startsOn,
          endsOn: cur.membership.endsOn,
          daysLeft,
          expiryState,
          cancelAtPeriodEnd: cur.membership.cancelAtPeriodEnd,
          pendingPlan: pendingPlan ? { code: pendingPlan.code, name: pendingPlan.name } : null,
        };
        if (expiryState !== 'EXPIRED') {
          entitlements = {
            courtDiscountPct: cur.plan.courtDiscountPct,
            shopDiscountPct: cur.plan.shopDiscountPct,
            barDiscountPct: cur.plan.barDiscountPct,
            maxBookingsPerDay: cur.plan.maxBookingsPerDay,
            bookingHorizonDays: cur.plan.bookingHorizonDays,
          };
        }
      }
      return {
        id: row.id,
        memberCode: row.memberCode,
        fullName: row.fullName,
        phone: row.phone,
        email: row.email,
        dateOfBirth: row.dateOfBirth,
        photoUrl: null,
        hasLogin: row.userId !== null,
        membership,
        entitlements,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  private static isBetterCurrent(candidate: MembershipRow, incumbent: MembershipRow): boolean {
    const candActive = candidate.status === 'ACTIVE';
    const incActive = incumbent.status === 'ACTIVE';
    if (candActive !== incActive) return candActive;
    if (candidate.endsOn !== incumbent.endsOn) return candidate.endsOn > incumbent.endsOn;
    return candidate.createdAt > incumbent.createdAt;
  }

  async getMember(id: string, executor: DbExecutor = this.db): Promise<Member> {
    const [row] = await executor.select().from(members).where(eq(members.id, id)).limit(1);
    if (!row) throw new DomainError('NOT_FOUND', 404, 'Member not found');
    return (await this.toMemberDtos([row], executor))[0]!;
  }

  async getMemberByUserId(userId: string): Promise<Member> {
    const [row] = await this.db.select().from(members).where(eq(members.userId, userId)).limit(1);
    if (!row) throw new DomainError('NOT_A_MEMBER', 404, 'No member profile exists for this account yet');
    return (await this.toMemberDtos([row]))[0]!;
  }

  private searchCondition(q: string): SQL {
    const pattern = likePattern(q);
    return sql`(${members.fullName} ilike ${pattern} or ${members.phone} ilike ${pattern} or ${members.memberCode} ilike ${pattern})`;
  }

  async list(query: MemberListQuery): Promise<{ rows: Member[]; total: number }> {
    const today = this.today();
    const soonLimit = addDays(today, EXPIRING_SOON_DAYS);
    const conditions: SQL[] = [];
    if (query.q) conditions.push(this.searchCondition(query.q));

    // The member's current membership: ACTIVE first, else the one that ended last.
    const currentId = sql`(select m2.id from memberships m2 where m2.member_id = ${members.id}
      order by (m2.status = 'ACTIVE') desc, m2.ends_on desc, m2.created_at desc limit 1)`;
    if (query.status === 'NONE') {
      conditions.push(sql`not exists (select 1 from memberships mx where mx.member_id = ${members.id})`);
    } else if (query.status === 'ACTIVE') {
      conditions.push(
        sql`exists (select 1 from memberships mc where mc.id = ${currentId} and mc.status = 'ACTIVE' and mc.ends_on >= ${today})`
      );
    } else if (query.status === 'EXPIRING_SOON') {
      conditions.push(
        sql`exists (select 1 from memberships mc where mc.id = ${currentId} and mc.status = 'ACTIVE' and mc.ends_on >= ${today} and mc.ends_on <= ${soonLimit})`
      );
    } else if (query.status === 'EXPIRED') {
      conditions.push(
        sql`exists (select 1 from memberships mc where mc.id = ${currentId} and (mc.status <> 'ACTIVE' or mc.ends_on < ${today}))`
      );
    }
    if (query.planCode) {
      conditions.push(
        sql`exists (select 1 from memberships mc join plans pc on pc.id = mc.plan_id where mc.id = ${currentId} and pc.code = ${query.planCode})`
      );
    }
    const where = conditions.length ? and(...conditions) : undefined;

    const sortColumn =
      query.sort === 'fullName' ? members.fullName : query.sort === 'memberCode' ? members.memberCode : members.createdAt;
    const direction = query.order === 'asc' ? asc : desc;

    const [rows, [totalRow]] = await Promise.all([
      this.db
        .select()
        .from(members)
        .where(where)
        .orderBy(direction(sortColumn), desc(members.id))
        .limit(query.limit)
        .offset((query.page - 1) * query.limit),
      this.db.select({ n: count() }).from(members).where(where),
    ]);
    return { rows: await this.toMemberDtos(rows), total: Number(totalRow?.n ?? 0) };
  }

  async lookup(q: string, limit: number): Promise<MemberLookupItem[]> {
    const rows = await this.db
      .select()
      .from(members)
      .where(this.searchCondition(q))
      .orderBy(asc(members.fullName), asc(members.id))
      .limit(limit);
    const dtos = await this.toMemberDtos(rows);
    return dtos.map((m) => ({
      id: m.id,
      memberCode: m.memberCode,
      fullName: m.fullName,
      phone: m.phone,
      planCode: m.membership?.plan.code ?? null,
      expiryState: m.membership?.expiryState ?? 'NONE',
      barDiscountPct: m.entitlements.barDiscountPct,
      shopDiscountPct: m.entitlements.shopDiscountPct,
    }));
  }

  /** UNION of check-ins, bookings, shop orders, bar tabs, invoices and membership events, newest first. */
  async timeline(
    memberId: string,
    page: number,
    limit: number
  ): Promise<{ rows: MemberTimelineItem[]; total: number }> {
    const [exists] = await this.db.select({ id: members.id }).from(members).where(eq(members.id, memberId)).limit(1);
    if (!exists) throw new DomainError('NOT_FOUND', 404, 'Member not found');

    const union = sql`
      select 'CHECKIN'::text as type, c.checked_in_at as at, 'Checked in'::text as title,
             null::text as detail, null::bigint as amount, null::text as link
        from member_checkins c where c.member_id = ${memberId}
      union all
      select 'BOOKING', b.starts_at, 'Court booking', ct.name || ' (' || b.status || ')',
             b.price_paise::bigint, '/bookings/' || b.id
        from bookings b join courts ct on ct.id = b.court_id where b.member_id = ${memberId}
      union all
      select 'ORDER', o.created_at, 'Shop order ' || o.order_number, o.status,
             o.total_paise::bigint, '/orders/' || o.id
        from orders o where o.member_id = ${memberId}
      union all
      select 'TAB', coalesce(t.settled_at, t.opened_at), 'Bar tab #' || t.tab_number, t.status,
             t.total_paise::bigint, '/bar/tabs/' || t.id
        from tabs t where t.member_id = ${memberId}
      union all
      select 'INVOICE', i.created_at, 'Invoice ' || i.invoice_number, i.status,
             i.total_paise::bigint, '/invoices/' || i.id
        from invoices i where i.member_id = ${memberId}
      union all
      select 'MEMBERSHIP', e.created_at, 'Membership ' || lower(e.type), e.note, null, null
        from membership_events e where e.member_id = ${memberId}`;

    const [rows, totals] = await Promise.all([
      this.db.execute<{
        type: MemberTimelineItem['type'];
        at_ms: string;
        title: string;
        detail: string | null;
        amount: string | null;
        link: string | null;
      }>(sql`select type, (extract(epoch from at) * 1000)::bigint as at_ms, title, detail, amount, link
             from (${union}) u order by at desc, type asc, title asc
             limit ${limit} offset ${(page - 1) * limit}`),
      this.db.execute<{ n: string }>(sql`select count(*) as n from (${union}) u`),
    ]);

    return {
      rows: [...rows].map((r) => {
        const item: MemberTimelineItem = {
          type: r.type,
          at: new Date(Number(r.at_ms)).toISOString(),
          title: r.title,
          detail: r.detail,
        };
        if (r.amount !== null) item.amountPaise = Number(r.amount);
        if (r.link !== null) item.link = r.link;
        return item;
      }),
      total: Number(totals[0]?.n ?? 0),
    };
  }

  // ------------------------------------------------------------ write side

  async checkin(memberId: string, actorUserId: string | null, bookingId?: string): Promise<CheckinResponse> {
    const [memberRow] = await this.db.select().from(members).where(eq(members.id, memberId)).limit(1);
    if (!memberRow) throw new DomainError('NOT_FOUND', 404, 'Member not found');
    if (bookingId) {
      const [booking] = await this.db
        .select({ id: bookings.id })
        .from(bookings)
        .where(and(eq(bookings.id, bookingId), eq(bookings.memberId, memberId)))
        .limit(1);
      if (!booking) throw new DomainError('NOT_FOUND', 404, 'Booking not found for this member');
    }
    const [row] = await this.db
      .insert(memberCheckins)
      .values({ memberId, checkedInBy: actorUserId, bookingId: bookingId ?? null })
      .returning();
    const [member] = await this.toMemberDtos([memberRow]);
    return { id: row.id, checkedInAt: row.checkedInAt.toISOString(), member: member! };
  }

  /**
   * Registers a member and sells the first term in ONE transaction: member, membership,
   * PAID invoice and payment row either all exist afterwards or none do.
   */
  async register(input: CreateMemberRequest, actorUserId: string | null): Promise<CreateMemberResponse> {
    const { memberId, sale } = await this.db.transaction((tx) => this.registerInTransaction(tx, input, actorUserId));
    return { member: await this.getMember(memberId), invoice: sale.invoice, payment: sale.payment };
  }

  /**
   * The body of {@link register} for a caller that already holds a transaction (lead conversion):
   * member, membership, PAID invoice and payment commit or roll back with the caller's other writes.
   * Build the response with `getMember(memberId, tx)`.
   */
  async registerInTransaction(
    tx: Tx,
    input: CreateMemberRequest,
    actorUserId: string | null
  ): Promise<{
    memberId: string;
    sale: { invoice: CreateMemberResponse['invoice']; payment: CreateMemberResponse['payment'] };
  }> {
    // Serialise concurrent registrations of the same phone so duplicates cannot both pass the check.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`member-phone:${input.phone}`}))`);

    const [plan] = await tx.select().from(plans).where(eq(plans.id, input.planId)).limit(1);
    if (!plan) throw new DomainError('NOT_FOUND', 404, 'Plan not found');
    if (!plan.isActive) throw new DomainError('PLAN_INACTIVE', 422, 'This plan is not available');
    const startsOn = input.startsOn ?? this.today();
    this.assertAgeEligible(plan, input.dateOfBirth ?? null, startsOn);

    let [member] = await tx.select().from(members).where(eq(members.phone, input.phone)).limit(1);
    if (member) {
      const [active] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(eq(memberships.memberId, member.id), eq(memberships.status, 'ACTIVE')))
        .limit(1);
      if (active) {
        throw new DomainError(
          'MEMBER_HAS_ACTIVE_MEMBERSHIP',
          409,
          'A member with this phone number already has an active membership'
        );
      }
    } else {
      const seq = await tx.execute<{ n: string }>(sql`select nextval('member_code_seq') as n`);
      [member] = await tx
        .insert(members)
        .values({
          memberCode: formatMemberCode(seq[0]!.n),
          fullName: input.fullName,
          phone: input.phone,
          email: input.email ?? null,
          dateOfBirth: input.dateOfBirth ?? null,
          createdBy: actorUserId,
        })
        .returning();
    }

    const sale = await this.sellTerm(tx, {
      member,
      plan,
      startsOn,
      method: input.paymentMethod,
      actorUserId,
      eventType: 'CREATED',
    });
    return { memberId: member.id, sale };
  }

  async renew(
    memberId: string,
    method: PaymentMethodInput,
    actorUserId: string | null
  ): Promise<RenewMembershipResponse> {
    const sale = await this.db.transaction(async (tx) => {
      // Lock the member row so two concurrent renewals queue instead of double-charging.
      const [member] = await tx.select().from(members).where(eq(members.id, memberId)).for('update').limit(1);
      if (!member) throw new DomainError('NOT_FOUND', 404, 'Member not found');

      const terms = await tx.select().from(memberships).where(eq(memberships.memberId, memberId));
      if (terms.length === 0) {
        throw new DomainError('NO_MEMBERSHIP_TO_RENEW', 422, 'This member has no membership to renew');
      }
      const latest = terms.reduce((best, t) => (MembershipService.isBetterCurrent(t, best) ? t : best));

      const today = this.today();
      const nextPlanId = latest.pendingPlanId ?? latest.planId;
      const [plan] = await tx.select().from(plans).where(eq(plans.id, nextPlanId)).limit(1);
      if (!plan) throw new DomainError('NOT_FOUND', 404, 'Plan not found');
      if (!plan.isActive) throw new DomainError('PLAN_INACTIVE', 422, 'This plan is not available');

      // Renewal starts the day after the current term ends, or today when it has already lapsed.
      const stillRunning = latest.status === 'ACTIVE' && latest.endsOn >= today;
      const startsOn = stillRunning ? addDays(latest.endsOn, 1) : today > latest.endsOn ? today : addDays(latest.endsOn, 1);
      this.assertAgeEligible(plan, member.dateOfBirth, startsOn);

      if (latest.status === 'ACTIVE') {
        await tx
          .update(memberships)
          .set({ status: 'REPLACED', updatedAt: new Date() })
          .where(eq(memberships.id, latest.id));
      }
      return this.sellTerm(tx, {
        member,
        plan,
        startsOn,
        method,
        actorUserId,
        eventType: 'RENEWED',
        fromPlanId: latest.planId,
      });
    });

    return { member: await this.getMember(memberId), invoice: sale.invoice, payment: sale.payment };
  }

  /** Creates or updates the caller's own profile (PUT /me/member). */
  async upsertOwnProfile(userId: string, input: UpsertMyMemberRequest): Promise<Member> {
    const run = async (): Promise<string> =>
      this.db.transaction(async (tx) => {
        const [existing] = await tx.select().from(members).where(eq(members.userId, userId)).for('update').limit(1);
        if (existing) {
          const dob = input.dateOfBirth ?? existing.dateOfBirth;
          await this.assertCurrentPlanAgeEligible(tx, existing.id, dob);
          await tx
            .update(members)
            .set({
              fullName: input.fullName,
              phone: input.phone,
              dateOfBirth: dob,
              updatedAt: new Date(),
            })
            .where(eq(members.id, existing.id));
          return existing.id;
        }
        const [user] = await tx.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
        const seq = await tx.execute<{ n: string }>(sql`select nextval('member_code_seq') as n`);
        const [created] = await tx
          .insert(members)
          .values({
            userId,
            memberCode: formatMemberCode(seq[0]!.n),
            fullName: input.fullName,
            phone: input.phone,
            email: user?.email ?? null,
            dateOfBirth: input.dateOfBirth ?? null,
            createdBy: userId,
          })
          .returning({ id: members.id });
        return created.id;
      });

    let id: string;
    try {
      id = await run();
    } catch (error) {
      // Two simultaneous first-time PUTs: the loser hits the unique user_id and retries as an update.
      if (pgCode(error) !== '23505') throw error;
      id = await run();
    }
    return this.getMember(id);
  }

  // --------------------------------------------------------------- helpers

  private assertAgeEligible(plan: PlanRow, dateOfBirth: string | null, onDate: string): void {
    if (plan.maxAge === null && plan.minAge === null) return;
    if (dateOfBirth === null) {
      throw new DomainError('JUNIOR_AGE_INVALID', 422, `A date of birth is required for the ${plan.name} plan`, [
        { field: 'dateOfBirth', message: 'Required for an age-restricted plan', code: 'REQUIRED' },
      ]);
    }
    const age = ageOn(dateOfBirth, onDate);
    if ((plan.maxAge !== null && age > plan.maxAge) || (plan.minAge !== null && age < plan.minAge)) {
      throw new DomainError('JUNIOR_AGE_INVALID', 422, `Date of birth is not valid for the ${plan.name} plan`, [
        { field: 'dateOfBirth', message: `Age ${age} is outside the allowed range`, code: 'AGE_RANGE' },
      ]);
    }
  }

  private async assertCurrentPlanAgeEligible(tx: Tx, memberId: string, dob: string | null): Promise<void> {
    const rows = await tx
      .select({ plan: plans })
      .from(memberships)
      .innerJoin(plans, eq(plans.id, memberships.planId))
      .where(and(eq(memberships.memberId, memberId), eq(memberships.status, 'ACTIVE')))
      .limit(1);
    if (rows[0]) this.assertAgeEligible(rows[0].plan, dob, this.today());
  }

  /** Invoice, membership row, event and payment for one term. Runs inside the caller's transaction. */
  private async sellTerm(
    tx: Tx,
    args: {
      member: MemberRow;
      plan: PlanRow;
      startsOn: string;
      method: PaymentMethodInput;
      actorUserId: string | null;
      eventType: MembershipEventType;
      fromPlanId?: string;
    }
  ): Promise<{ invoice: CreateMemberResponse['invoice']; payment: CreateMemberResponse['payment'] }> {
    const { member, plan, startsOn } = args;
    const endsOn = addDays(startsOn, MEMBERSHIP_TERM_DAYS - 1);
    if (plan.monthlyFeePaise <= 0) {
      throw new DomainError('PLAN_FEE_INVALID', 422, 'This plan has no fee set, so it cannot be sold');
    }

    const invoice = await this.invoices.withExecutor(tx).createPaidMembershipInvoice({
      memberId: member.id,
      description: `${plan.name} membership, ${MEMBERSHIP_TERM_DAYS} days`,
      amountPaise: plan.monthlyFeePaise,
      issueDate: this.today(),
      createdBy: args.actorUserId,
    });

    let membershipId: string;
    try {
      const [row] = await tx
        .insert(memberships)
        .values({ memberId: member.id, planId: plan.id, status: 'ACTIVE', startsOn, endsOn, invoiceId: invoice.id })
        .returning({ id: memberships.id });
      membershipId = row.id;
    } catch (error) {
      if (pgCode(error) === '23505') {
        throw new DomainError('MEMBER_HAS_ACTIVE_MEMBERSHIP', 409, 'This member already has an active membership');
      }
      throw error;
    }

    await tx.insert(membershipEvents).values({
      membershipId,
      memberId: member.id,
      type: args.eventType,
      fromPlanId: args.fromPlanId ?? null,
      toPlanId: plan.id,
      actorUserId: args.actorUserId,
    });

    // The payments row is the last step: it is what the owner dashboard counts as revenue.
    const payment = await this.payments.withExecutor(tx).record({
      source: 'MEMBERSHIP',
      sourceId: membershipId,
      amountPaise: plan.monthlyFeePaise,
      method: args.method,
      memberId: member.id,
      receivedBy: args.actorUserId,
    });
    return { invoice, payment: { id: payment.id, amountPaise: payment.amountPaise, method: args.method } };
  }
}
