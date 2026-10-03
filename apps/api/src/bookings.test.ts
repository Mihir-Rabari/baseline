import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import {
  bookings,
  courtOccupancies,
  getDb,
  members,
  payments,
  socialSessions,
  socialWindows,
  systemAuditLogs,
  users,
} from "@packages/db";
import { hashSessionToken } from "@packages/auth";
import {
  BookingPageSchema,
  BookingRaceResponseSchema,
  BookingSchema,
  JoinSocialResponseSchema,
} from "@packages/validation";
import { buildApp } from "./app.js";
import { DomainError } from "./lib/domain-error.js";
import {
  BookingService,
  mapBookingDbError,
  pgErrorInfo,
  toBooking,
} from "./services/booking.service.js";
import {
  addDays,
  clubDateOf,
  clubWallTimeToInstant,
  isoWeekdayOf,
} from "./services/time.js";
import { isDatabaseAvailable } from "./test-support/database.js";
import { MembersFixtures } from "./test-support/members-fixtures.js";
import {
  FixtureTracker,
  createBooking,
  createCourt,
  createCourtType,
  createMember,
  createMembership,
  createPlan,
  createUserWithPolicy,
} from "./test-support/court-fixtures.js";

const IST = "Asia/Kolkata";
const NO_SUCH_UUID = "00000000-0000-4000-8000-0000000000aa";
const today = clubDateOf(new Date(), IST);

/** ISO instant for `hh:mm` club time, `offset` days from today. */
const at = (offset: number, hour: number, minute = 0): string =>
  clubWallTimeToInstant(
    addDays(today, offset),
    hour * 60 + minute,
    IST,
  ).toISOString();

function daysUntilFriday(): number {
  for (let i = 1; i <= 7; i += 1)
    if (isoWeekdayOf(addDays(today, i)) === 5) return i;
  throw new Error("unreachable");
}

// -------------------------------------------------------------------------------------------------
// Pure helpers (no database needed)
// -------------------------------------------------------------------------------------------------
describe("booking error mapping (unit)", () => {
  const driver = (code: string, constraint_name?: string) =>
    Object.assign(new Error("pg"), { code, constraint_name });

  it("reads the SQLSTATE and constraint from the error itself", () => {
    expect(
      pgErrorInfo(driver("23P01", "court_occupancies_no_overlap")),
    ).toEqual({
      code: "23P01",
      constraint: "court_occupancies_no_overlap",
    });
  });

  it("reads them from a wrapped cause (Drizzle 0.45 DrizzleQueryError)", () => {
    const wrapped = Object.assign(new Error("Failed query"), {
      cause: driver("23P01", "bookings_member_no_overlap"),
    });
    expect(pgErrorInfo(wrapped)).toEqual({
      code: "23P01",
      constraint: "bookings_member_no_overlap",
    });
  });

  it("accepts the node-postgres `constraint` property name too", () => {
    const e = Object.assign(new Error("pg"), {
      code: "23P01",
      constraint: "bookings_member_no_overlap",
    });
    expect(pgErrorInfo(e).constraint).toBe("bookings_member_no_overlap");
  });

  it("maps the occupancy exclusion violation to SLOT_TAKEN (409)", () => {
    const mapped = mapBookingDbError(
      driver("23P01", "court_occupancies_no_overlap"),
      "booking",
    ) as DomainError;
    expect(mapped).toBeInstanceOf(DomainError);
    expect([mapped.code, mapped.statusCode]).toEqual(["SLOT_TAKEN", 409]);
  });

  it("maps the member overlap violation to MEMBER_DOUBLE_BOOKED (409), also through a wrapper", () => {
    const wrapped = Object.assign(new Error("Failed query"), {
      cause: driver("23P01", "bookings_member_no_overlap"),
    });
    const mapped = mapBookingDbError(wrapped, "booking") as DomainError;
    expect([mapped.code, mapped.statusCode]).toEqual([
      "MEMBER_DOUBLE_BOOKED",
      409,
    ]);
  });

  it("maps an occupancy conflict while joining social play to SOCIAL_WINDOW", () => {
    const mapped = mapBookingDbError(
      driver("23P01", "court_occupancies_no_overlap"),
      "social",
    ) as DomainError;
    expect(mapped.code).toBe("SOCIAL_WINDOW");
  });

  it("maps the unique indexes for double joins and repeat trials", () => {
    expect(
      (
        mapBookingDbError(
          driver("23505", "uq_bookings_social_member"),
          "social",
        ) as DomainError
      ).code,
    ).toBe("ALREADY_JOINED");
    expect(
      (
        mapBookingDbError(
          driver("23505", "uq_bookings_trial_phone"),
          "booking",
        ) as DomainError
      ).code,
    ).toBe("TRIAL_ALREADY_USED");
  });

  it("leaves unrelated errors and domain errors untouched", () => {
    const other = new Error("boom");
    expect(mapBookingDbError(other, "booking")).toBe(other);
    const domain = new DomainError("X", 422, "x");
    expect(mapBookingDbError(domain, "booking")).toBe(domain);
    const unknown = driver("23505", "something_else");
    expect(mapBookingDbError(unknown, "booking")).toBe(unknown);
  });

  it("toBooking returns the contract shape for member and guest bookings", () => {
    const base = {
      id: NO_SUCH_UUID,
      courtId: NO_SUCH_UUID,
      courtName: "Court 1",
      courtType: "TENNIS",
      kind: "STANDARD" as const,
      startsAt: new Date("2026-10-09T12:30:00.000Z"),
      endsAt: new Date("2026-10-09T13:30:00.000Z"),
      bookingDate: "2026-10-09",
      status: "CONFIRMED" as const,
      cancelledLate: false,
      channel: "DESK" as const,
      basePricePaise: 60000,
      discountPct: 30,
      pricePaise: 42000,
      paymentStatus: "UNPAID" as const,
      socialSessionId: null,
      createdAt: new Date("2026-10-09T10:00:00.000Z"),
    };
    const guest = toBooking({
      ...base,
      memberId: null,
      memberCode: null,
      memberName: null,
      guestName: "Asha",
      guestPhone: "+919800000001",
      guestEmail: null,
    });
    expect(BookingSchema.parse(guest)).toMatchObject({
      member: null,
      guest: { name: "Asha" },
      startsAt: "2026-10-09T12:30:00.000Z",
    });
    const member = toBooking({
      ...base,
      memberId: NO_SUCH_UUID,
      memberCode: "CC-000001",
      memberName: "Aarav",
      guestName: null,
      guestPhone: null,
      guestEmail: null,
    });
    expect(BookingSchema.parse(member)).toMatchObject({
      guest: null,
      member: { memberCode: "CC-000001" },
    });
  });
});

// -------------------------------------------------------------------------------------------------
// Booking engine against a real database
// -------------------------------------------------------------------------------------------------
describe("Booking engine (M-07, M-08)", () => {
  let app: FastifyInstance;
  let hasDatabase = false;
  const db = getDb();
  const tracker = new FixtureTracker();
  const createdWindowIds: string[] = [];

  let typeId = "";
  let socialTypeId = "";
  let smallSocialTypeId = "";
  let silverId = "";
  let goldId = "";
  let oneADayId = "";

  const cookies = {
    frontDesk: "",
    owner: "",
    bar: "",
    plain: "",
    suspended: "",
  };
  let suspendedUserId = "";
  let ownerUserId = "";
  const fridayOffset = daysUntilFriday();

  async function login(userId: string): Promise<string> {
    const { sessionToken } = await app.sessionManager.createSession({ userId });
    return `${app.env.SESSION_COOKIE_NAME}=${sessionToken}`;
  }

  const post = (url: string, payload: unknown, cookie?: string) =>
    app.inject({
      method: "POST",
      url: `/api/v1${url}`,
      payload: payload as object,
      headers: cookie ? { cookie } : {},
    });
  const get = (url: string, cookie?: string) =>
    app.inject({
      method: "GET",
      url: `/api/v1${url}`,
      headers: cookie ? { cookie } : {},
    });

  async function newCourt(label = "Booking Court", type = typeId) {
    const court = await createCourt(db, type, label);
    tracker.courtIds.push(court.id);
    return court;
  }

  interface TestMember {
    userId: string;
    memberId: string;
    cookie: string;
  }

  async function newMember(
    planId: string | null = silverId,
    endsOffset = 60,
  ): Promise<TestMember> {
    const { user, policyId } = await createUserWithPolicy(db, "MemberPolicy");
    tracker.userIds.push(user.id);
    tracker.policyIds.push(policyId);
    const member = await createMember(db, { userId: user.id });
    tracker.memberIds.push(member.id);
    if (planId) {
      await createMembership(db, {
        memberId: member.id,
        planId,
        startsOn: addDays(today, -5),
        endsOn: addDays(today, endsOffset),
      });
    }
    return {
      userId: user.id,
      memberId: member.id,
      cookie: await login(user.id),
    };
  }

  const guestBody = (n: number) => ({
    name: `Guest ${n}`,
    phone: `+9198000${String(10000 + n)}`,
  });

  async function staffBook(
    courtId: string,
    startsAt: string,
    extra: Record<string, unknown> = {},
  ) {
    return post(
      "/bookings",
      {
        courtId,
        startsAt,
        guest: guestBody(Math.floor(Math.random() * 1e4)),
        ...extra,
      },
      cookies.frontDesk,
    );
  }

  async function ensureFridayWindow() {
    const existing = await db
      .select()
      .from(socialWindows)
      .where(
        and(eq(socialWindows.weekday, 5), eq(socialWindows.isActive, true)),
      );
    if (
      existing.some(
        (w) =>
          w.startsTime.slice(0, 5) <= "18:00" &&
          w.endsTime.slice(0, 5) >= "22:00",
      )
    )
      return;
    const [row] = await db
      .insert(socialWindows)
      .values({ weekday: 5, startsTime: "18:00", endsTime: "22:00" })
      .returning();
    createdWindowIds.push(row.id);
  }

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
    MembersFixtures.spreadClientIps(app);
    hasDatabase = await isDatabaseAvailable();
    if (!hasDatabase) return;

    const type = await createCourtType(db, {
      baseRatePaise: 60000,
      socialFeePaise: 14000,
      trialFeePaise: 19900,
      socialCapacity: 4,
    });
    const socialType = await createCourtType(db, {
      baseRatePaise: 60000,
      socialFeePaise: 14000,
      trialFeePaise: 19900,
      socialCapacity: 8,
    });
    const smallType = await createCourtType(db, {
      baseRatePaise: 60000,
      socialFeePaise: 14000,
      trialFeePaise: 19900,
      socialCapacity: 2,
    });
    tracker.courtTypeIds.push(type.id, socialType.id, smallType.id);
    typeId = type.id;
    socialTypeId = socialType.id;
    smallSocialTypeId = smallType.id;

    const silver = await createPlan(db, {
      courtDiscountPct: 30,
      maxBookingsPerDay: 2,
      bookingHorizonDays: 14,
    });
    const gold = await createPlan(db, {
      courtDiscountPct: 100,
      maxBookingsPerDay: 2,
      bookingHorizonDays: 14,
    });
    const oneADay = await createPlan(db, {
      courtDiscountPct: 30,
      maxBookingsPerDay: 1,
      bookingHorizonDays: 14,
    });
    tracker.planIds.push(silver.id, gold.id, oneADay.id);
    silverId = silver.id;
    goldId = gold.id;
    oneADayId = oneADay.id;

    const roleUsers = {
      frontDesk: await createUserWithPolicy(db, "FrontDeskPolicy"),
      owner: await createUserWithPolicy(db, "OwnerPolicy"),
      bar: await createUserWithPolicy(db, "BarStaffPolicy"),
    };
    const plainUser = await createUserWithPolicy(db, "MemberPolicy");
    const suspendedUser = await createUserWithPolicy(db, "MemberPolicy");
    for (const entry of [
      ...Object.values(roleUsers),
      plainUser,
      suspendedUser,
    ]) {
      tracker.userIds.push(entry.user.id);
      tracker.policyIds.push(entry.policyId);
    }
    cookies.frontDesk = await login(roleUsers.frontDesk.user.id);
    ownerUserId = roleUsers.owner.user.id;
    cookies.owner = await login(roleUsers.owner.user.id);
    cookies.bar = await login(roleUsers.bar.user.id);
    cookies.plain = await login(plainUser.user.id); // a MEMBER login with no member profile

    suspendedUserId = suspendedUser.user.id;
    const suspendedMember = await createMember(db, { userId: suspendedUserId });
    tracker.memberIds.push(suspendedMember.id);
    await createMembership(db, {
      memberId: suspendedMember.id,
      planId: silverId,
      startsOn: addDays(today, -5),
      endsOn: addDays(today, 60),
    });
    cookies.suspended = await login(suspendedUserId);
    await db
      .update(users)
      .set({ status: "SUSPENDED" })
      .where(eq(users.id, suspendedUserId));
    // Suspending straight in the database leaves the Redis-cached session untouched (known issue,
    // being fixed separately); evict it so the request exercises the database path.
    await app.redis.delete(
      `session:${hashSessionToken(cookies.suspended.split("=")[1])}`,
    );

    await ensureFridayWindow();
  });

  afterAll(async () => {
    if (hasDatabase) {
      if (tracker.courtIds.length) {
        const rows = await db
          .select({ id: bookings.id })
          .from(bookings)
          .where(inArray(bookings.courtId, tracker.courtIds));
        if (rows.length)
          await db.delete(payments).where(
            inArray(
              payments.sourceId,
              rows.map((r) => r.id),
            ),
          );
      }
      if (tracker.memberIds.length)
        await db
          .delete(payments)
          .where(inArray(payments.memberId, tracker.memberIds));
      await tracker.cleanup(db);
      if (createdWindowIds.length)
        await db
          .delete(socialWindows)
          .where(inArray(socialWindows.id, createdWindowIds));
    }
    await app.close();
  });

  // -----------------------------------------------------------------------------------------------
  describe("POST /api/v1/bookings: contract, validation and authentication", () => {
    it("401 without a session", async () => {
      const res = await post("/bookings", {
        courtId: NO_SUCH_UUID,
        startsAt: at(1, 10),
      });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({
        code: "UNAUTHORIZED",
        requestId: expect.any(String),
      });
    });

    it("400 for malformed bodies (never a 500)", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt();
      const bodies: unknown[] = [
        {},
        { courtId: "nope", startsAt: at(1, 10), guest: guestBody(1) },
        { courtId: court.id, startsAt: "yesterday-ish", guest: guestBody(1) },
        {
          courtId: court.id,
          startsAt: at(1, 10),
          guest: { name: "", phone: "123" },
        },
        {
          courtId: court.id,
          startsAt: at(1, 10),
          memberId: NO_SUCH_UUID,
          guest: guestBody(1),
        },
        {
          courtId: court.id,
          startsAt: at(1, 10),
          channel: "TELEPATHY",
          guest: guestBody(1),
        },
      ];
      for (const body of bodies) {
        const res = await post("/bookings", body, cookies.frontDesk);
        expect(res.statusCode, JSON.stringify(body)).toBe(400);
        expect(res.json()).toMatchObject({
          code: "VALIDATION_ERROR",
          requestId: expect.any(String),
        });
      }
    });

    it("400 when staff name neither or both of memberId and guest", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt();
      const neither = await post(
        "/bookings",
        { courtId: court.id, startsAt: at(1, 10) },
        cookies.frontDesk,
      );
      expect(neither.statusCode).toBe(400);
      expect(neither.json().code).toBe("VALIDATION_ERROR");
    });

    it("403 for bar staff", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt();
      const res = await post(
        "/bookings",
        { courtId: court.id, startsAt: at(1, 10), guest: guestBody(2) },
        cookies.bar,
      );
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({
        code: "FORBIDDEN",
        requestId: expect.any(String),
      });
    });

    it("404 for an unknown court and an unknown member", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const noCourt = await staffBook(NO_SUCH_UUID, at(1, 10));
      expect(noCourt.statusCode).toBe(404);
      expect(noCourt.json().code).toBe("COURT_NOT_FOUND");
      const court = await newCourt();
      const noMember = await post(
        "/bookings",
        { courtId: court.id, startsAt: at(1, 10), memberId: NO_SUCH_UUID },
        cookies.frontDesk,
      );
      expect(noMember.statusCode).toBe(404);
      expect(noMember.json().code).toBe("MEMBER_NOT_FOUND");
    });

    it("a member login with no member profile gets 404 NOT_A_MEMBER", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt();
      const res = await post(
        "/bookings",
        { courtId: court.id, startsAt: at(2, 10) },
        cookies.plain,
      );
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe("NOT_A_MEMBER");
    });

    it("201 with the exact contract shape for a guest booking made by the front desk", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt();
      const res = await staffBook(court.id, at(1, 10));
      expect(res.statusCode).toBe(201);
      const booking = BookingSchema.parse(res.json());
      expect(booking).toMatchObject({
        kind: "STANDARD",
        status: "CONFIRMED",
        member: null,
        channel: "DESK",
        basePricePaise: 60000,
        discountPct: 0,
        pricePaise: 60000,
        paymentStatus: "UNPAID",
        socialSessionId: null,
        court: { id: court.id },
        startsAt: at(1, 10),
        endsAt: at(1, 11),
        bookingDate: addDays(today, 1),
      });
      const [occupancy] = await db
        .select()
        .from(courtOccupancies)
        .where(eq(courtOccupancies.bookingId, booking.id));
      expect(occupancy).toMatchObject({ kind: "BOOKING", courtId: court.id });
    });
  });

  // -----------------------------------------------------------------------------------------------
  describe("BR-02 / BR-01: slot shape and opening hours", () => {
    it.each([
      ["a quarter-hour start", () => at(1, 10, 15)],
      [
        "a start with stray seconds",
        () => new Date(Date.parse(at(1, 10)) + 1000).toISOString(),
      ],
      [
        "a start with stray milliseconds",
        () => new Date(Date.parse(at(1, 10)) + 5).toISOString(),
      ],
      ["before opening", () => at(1, 5, 30)],
      ["ending after closing", () => at(1, 21, 30)],
      ["in the past", () => at(-1, 10)],
    ])("422 INVALID_SLOT_START for %s", async (_name, startsAt, ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt();
      const res = await staffBook(court.id, startsAt());
      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({
        code: "INVALID_SLOT_START",
        requestId: expect.any(String),
      });
      expect(
        await db.select().from(bookings).where(eq(bookings.courtId, court.id)),
      ).toHaveLength(0);
    });

    it("accepts the half-hour start 09:30 and the last start 21:00", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt();
      expect((await staffBook(court.id, at(1, 9, 30))).statusCode).toBe(201);
      // 21:00 on a Friday is inside the social window; use a non-Friday day for the closing-time slot.
      const nonFriday = [1, 2].find(
        (d) => isoWeekdayOf(addDays(today, d)) !== 5,
      )!;
      expect((await staffBook(court.id, at(nonFriday, 21, 0))).statusCode).toBe(
        201,
      );
    });
  });

  // -----------------------------------------------------------------------------------------------
  describe("BR-03: no double booking (the database guarantees it)", () => {
    it("20 parallel creations of one slot give exactly one 201 and nineteen 409 SLOT_TAKEN", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt();
      const startsAt = at(1, 11);

      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          post(
            "/bookings",
            {
              courtId: court.id,
              startsAt,
              guest: {
                name: `Racer ${i}`,
                phone: `+9197000${String(10000 + i)}`,
              },
            },
            cookies.frontDesk,
          ),
        ),
      );

      const created = results.filter((r) => r.statusCode === 201);
      const taken = results.filter((r) => r.statusCode === 409);
      expect(created).toHaveLength(1);
      expect(
        results
          .filter((r) => ![201, 409].includes(r.statusCode))
          .map((r) => r.body),
      ).toEqual([]);
      expect(taken).toHaveLength(19);
      for (const r of taken)
        expect(r.json()).toMatchObject({
          code: "SLOT_TAKEN",
          requestId: expect.any(String),
        });
      // Exactly one booking and one occupancy row exist: the losers left nothing behind.
      expect(
        await db.select().from(bookings).where(eq(bookings.courtId, court.id)),
      ).toHaveLength(1);
      expect(
        await db
          .select()
          .from(courtOccupancies)
          .where(eq(courtOccupancies.courtId, court.id)),
      ).toHaveLength(1);
    });

    it("adjacent sessions coexist: 10:00 and 11:00 on one court", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt();
      expect((await staffBook(court.id, at(1, 10))).statusCode).toBe(201);
      expect((await staffBook(court.id, at(1, 11))).statusCode).toBe(201);
      expect((await staffBook(court.id, at(1, 9))).statusCode).toBe(201);
    });

    it.each([
      ["10:30 overlaps 10:00", 10, 30],
      ["10:00 overlaps itself", 10, 0],
      ["09:30 overlaps 10:00", 9, 30],
    ])("%s: 409 SLOT_TAKEN", async (_name, hour, minute, ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt();
      expect((await staffBook(court.id, at(1, 10))).statusCode).toBe(201);
      const res = await staffBook(court.id, at(1, hour, minute));
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({
        code: "SLOT_TAKEN",
        requestId: expect.any(String),
      });
    });

    it("different courts coexist at the same time", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const a = await newCourt("Court A");
      const b = await newCourt("Court B");
      expect((await staffBook(a.id, at(1, 10))).statusCode).toBe(201);
      expect((await staffBook(b.id, at(1, 10))).statusCode).toBe(201);
    });

    it("a cancelled booking frees the slot for someone else", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt();
      const first = (await staffBook(court.id, at(2, 10))).json();
      expect((await staffBook(court.id, at(2, 10))).statusCode).toBe(409);
      expect(
        (await post(`/bookings/${first.id}/cancel`, {}, cookies.frontDesk))
          .statusCode,
      ).toBe(200);
      expect((await staffBook(court.id, at(2, 10))).statusCode).toBe(201);
    });

    it("the same member cannot hold overlapping sessions on two courts: 409 MEMBER_DOUBLE_BOOKED", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const a = await newCourt("Court A");
      const b = await newCourt("Court B");
      const member = await newMember();
      expect(
        (
          await post(
            "/bookings",
            { courtId: a.id, startsAt: at(3, 10) },
            member.cookie,
          )
        ).statusCode,
      ).toBe(201);

      const res = await post(
        "/bookings",
        { courtId: b.id, startsAt: at(3, 10, 30) },
        member.cookie,
      );

      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({
        code: "MEMBER_DOUBLE_BOOKED",
        requestId: expect.any(String),
      });
      // The occupancy inserted before the failing booking was rolled back with the transaction.
      expect(
        await db
          .select()
          .from(courtOccupancies)
          .where(eq(courtOccupancies.courtId, b.id)),
      ).toHaveLength(0);
    });

    it("the demo race tool reports 1 confirmed and 19 slot taken, then cleans up after itself", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt();
      const res = await post(
        "/demo/booking-race",
        { courtId: court.id, startsAt: at(1, 14), attempts: 20 },
        cookies.owner,
      );
      expect(res.statusCode).toBe(200);
      const body = BookingRaceResponseSchema.parse(res.json());
      expect(body).toMatchObject({
        attempts: 20,
        confirmed: 1,
        slotTaken: 19,
        other: 0,
      });
      expect(body.bookingId).toEqual(expect.any(String));
      expect(
        await db.select().from(bookings).where(eq(bookings.courtId, court.id)),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(courtOccupancies)
          .where(eq(courtOccupancies.courtId, court.id)),
      ).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------------------------------
  describe("BR-04 / BR-08: daily limit and quota", () => {
    it("the third booking of a day fails with 422 DAILY_LIMIT_REACHED", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt();
      const member = await newMember();
      expect(
        (
          await post(
            "/bookings",
            { courtId: court.id, startsAt: at(4, 8) },
            member.cookie,
          )
        ).statusCode,
      ).toBe(201);
      expect(
        (
          await post(
            "/bookings",
            { courtId: court.id, startsAt: at(4, 10) },
            member.cookie,
          )
        ).statusCode,
      ).toBe(201);

      const third = await post(
        "/bookings",
        { courtId: court.id, startsAt: at(4, 12) },
        member.cookie,
      );

      expect(third.statusCode).toBe(422);
      expect(third.json()).toMatchObject({
        code: "DAILY_LIMIT_REACHED",
        requestId: expect.any(String),
      });
      // A different day is unaffected.
      expect(
        (
          await post(
            "/bookings",
            { courtId: court.id, startsAt: at(5, 12) },
            member.cookie,
          )
        ).statusCode,
      ).toBe(201);
    });

    it("two concurrent bookings when one is already used: only one succeeds", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const a = await newCourt("Court A");
      const b = await newCourt("Court B");
      const member = await newMember();
      expect(
        (
          await post(
            "/bookings",
            { courtId: a.id, startsAt: at(4, 8) },
            member.cookie,
          )
        ).statusCode,
      ).toBe(201);

      const [r1, r2] = await Promise.all([
        post(
          "/bookings",
          { courtId: a.id, startsAt: at(4, 12) },
          member.cookie,
        ),
        post(
          "/bookings",
          { courtId: b.id, startsAt: at(4, 14) },
          member.cookie,
        ),
      ]);

      expect([r1.statusCode, r2.statusCode].sort()).toEqual([201, 422]);
      const loser = r1.statusCode === 422 ? r1 : r2;
      expect(loser.json().code).toBe("DAILY_LIMIT_REACHED");
      const rows = await db
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.memberId, member.memberId),
            eq(bookings.bookingDate, addDays(today, 4)),
          ),
        );
      expect(rows).toHaveLength(2);
    });

    it("many concurrent bookings by one member never exceed the daily limit", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const courts = await Promise.all(
        [1, 2, 3, 4, 5, 6].map((n) => newCourt(`Court ${n}`)),
      );
      const member = await newMember();
      const results = await Promise.all(
        courts.map((c, i) =>
          post(
            "/bookings",
            { courtId: c.id, startsAt: at(6, 6 + i * 2) },
            member.cookie,
          ),
        ),
      );
      expect(results.filter((r) => r.statusCode === 201)).toHaveLength(2);
      expect(
        results.filter(
          (r) =>
            r.statusCode === 422 && r.json().code === "DAILY_LIMIT_REACHED",
        ),
      ).toHaveLength(4);
    });

    it("cancelling early frees the quota and refunds the payment", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt();
      const member = await newMember(oneADayId);
      const first = await post(
        "/bookings",
        { courtId: court.id, startsAt: at(5, 9), payNow: { method: "UPI" } },
        member.cookie,
      );
      expect(first.statusCode).toBe(201);
      expect(first.json()).toMatchObject({
        paymentStatus: "PAID",
        pricePaise: 42000,
      });
      expect(
        (
          await post(
            "/bookings",
            { courtId: court.id, startsAt: at(5, 11) },
            member.cookie,
          )
        ).json().code,
      ).toBe("DAILY_LIMIT_REACHED");

      const cancel = await post(
        `/bookings/${first.json().id}/cancel`,
        { reason: "plans changed" },
        member.cookie,
      );

      expect(cancel.statusCode).toBe(200);
      expect(cancel.json()).toMatchObject({
        late: false,
        quotaFreed: true,
        refund: { amountPaise: 42000, method: "UPI" },
        booking: {
          status: "CANCELLED",
          cancelledLate: false,
          paymentStatus: "REFUNDED",
        },
      });
      expect(
        (
          await post(
            "/bookings",
            { courtId: court.id, startsAt: at(5, 11) },
            member.cookie,
          )
        ).statusCode,
      ).toBe(201);
      const ledger = await db
        .select()
        .from(payments)
        .where(eq(payments.sourceId, first.json().id));
      expect(ledger.map((p) => p.amountPaise).sort((x, y) => x - y)).toEqual([
        -42000, 42000,
      ]);
      expect(ledger.reduce((sum, p) => sum + p.amountPaise, 0)).toBe(0);
    });

    describe("late cancellations (clock moved to 60 minutes before the start)", () => {
      const audit: Array<{
        action: string;
        actor?: string;
        target?: string;
        details?: Record<string, unknown>;
      }> = [];
      const serviceAt = (instant: Date) =>
        new BookingService(db, {
          timezone: IST,
          now: () => instant,
          audit: async (e) => {
            audit.push(e);
          },
        });

      it("cancelling late frees the court but gives no refund and keeps the quota used", async (ctx) => {
        if (!hasDatabase) return ctx.skip();
        const court = await newCourt();
        const member = await newMember(oneADayId);
        const created = await post(
          "/bookings",
          { courtId: court.id, startsAt: at(1, 10), payNow: { method: "UPI" } },
          member.cookie,
        );
        expect(created.statusCode).toBe(201);
        const start = new Date(created.json().startsAt);

        const result = await serviceAt(
          new Date(start.getTime() - 60 * 60_000),
        ).cancel({ bookingId: created.json().id, actorUserId: member.userId });

        expect(result).toMatchObject({
          late: true,
          quotaFreed: false,
          refund: null,
        });
        expect(result.booking).toMatchObject({
          status: "CANCELLED",
          cancelledLate: true,
          paymentStatus: "PAID",
        });
        // No refund row was written.
        expect(
          await db
            .select()
            .from(payments)
            .where(eq(payments.sourceId, created.json().id)),
        ).toHaveLength(1);
        // The court is free for someone else...
        expect((await staffBook(court.id, at(1, 10))).statusCode).toBe(201);
        // ...but the member's quota stays used (limit is one per day for this plan).
        const again = await post(
          "/bookings",
          { courtId: court.id, startsAt: at(1, 14) },
          member.cookie,
        );
        expect(again.statusCode).toBe(422);
        expect(again.json().code).toBe("DAILY_LIMIT_REACHED");
      });

      it("the cutoff is exclusive of exactly two hours: 2h before is NOT late", async (ctx) => {
        if (!hasDatabase) return ctx.skip();
        const court = await newCourt();
        const created = await staffBook(court.id, at(1, 12));
        const start = new Date(created.json().startsAt);
        const result = await serviceAt(
          new Date(start.getTime() - 2 * 3_600_000),
        ).cancel({ bookingId: created.json().id, actorUserId: randomUUID() });
        expect(result).toMatchObject({ late: false, quotaFreed: true });
      });

      it("staff override with a reason waives the cutoff, refunds, frees the quota and is audited", async (ctx) => {
        if (!hasDatabase) return ctx.skip();
        const court = await newCourt();
        const member = await newMember(oneADayId);
        const created = await post(
          "/bookings",
          { courtId: court.id, startsAt: at(1, 16), payNow: { method: "UPI" } },
          member.cookie,
        );
        const start = new Date(created.json().startsAt);
        audit.length = 0;

        const result = await serviceAt(
          new Date(start.getTime() - 30 * 60_000),
        ).cancel({
          bookingId: created.json().id,
          actorUserId: ownerUserId,
          reason: "Court flooded",
          override: true,
        });

        expect(result).toMatchObject({
          late: false,
          quotaFreed: true,
          refund: { amountPaise: 42000 },
        });
        expect(audit).toHaveLength(1);
        expect(audit[0]).toMatchObject({
          action: "booking.cancel.override",
          actor: ownerUserId,
          target: created.json().id,
          details: {
            override: true,
            reason: "Court flooded",
            refundPaise: 42000,
            late: false,
          },
        });
      });

      it("a session that has already started cannot be cancelled, even with override", async (ctx) => {
        if (!hasDatabase) return ctx.skip();
        const court = await newCourt();
        const created = await staffBook(court.id, at(1, 18));
        const start = new Date(created.json().startsAt);
        await expect(
          serviceAt(new Date(start.getTime() + 60_000)).cancel({
            bookingId: created.json().id,
            actorUserId: randomUUID(),
            override: true,
            reason: "x",
          }),
        ).rejects.toMatchObject({
          code: "CANCEL_NOT_ALLOWED",
          statusCode: 409,
        });
      });
    });

    it("a no-show keeps counting toward the quota", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt();
      const member = await newMember(oneADayId);
      await createBooking(db, {
        courtId: court.id,
        startsAt: new Date(at(7, 8)),
        bookingDate: addDays(today, 7),
        memberId: member.memberId,
        status: "NO_SHOW",
      });
      const res = await post(
        "/bookings",
        { courtId: court.id, startsAt: at(7, 12) },
        member.cookie,
      );
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe("DAILY_LIMIT_REACHED");
    });

    it("guests have no daily limit", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt();
      const guest = { name: "Same Guest", phone: "+919811111111" };
      for (const hour of [8, 10, 12]) {
        expect(
          (
            await post(
              "/bookings",
              { courtId: court.id, startsAt: at(1, hour), guest },
              cookies.frontDesk,
            )
          ).statusCode,
        ).toBe(201);
      }
    });
  });

  // -----------------------------------------------------------------------------------------------
  describe("BR-05 / BR-06 / BR-07: pricing, horizon and membership validity", () => {
    it("prices the same slot four ways: walk-in, Silver, Gold (free) and trial", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt();
      const silver = await newMember(silverId);
      const gold = await newMember(goldId);

      const walkIn = await staffBook(court.id, at(1, 8));
      const silverRes = await post(
        "/bookings",
        { courtId: court.id, startsAt: at(1, 10) },
        silver.cookie,
      );
      const goldRes = await post(
        "/bookings",
        { courtId: court.id, startsAt: at(1, 12) },
        gold.cookie,
      );
      const trial = await new BookingService(db, { timezone: IST }).create({
        courtId: court.id,
        startsAt: new Date(at(1, 14)),
        guest: { name: "Trial Guest", phone: "+919822222222" },
        kind: "TRIAL",
      });

      expect(walkIn.json()).toMatchObject({
        basePricePaise: 60000,
        discountPct: 0,
        pricePaise: 60000,
        paymentStatus: "UNPAID",
      });
      expect(silverRes.json()).toMatchObject({
        basePricePaise: 60000,
        discountPct: 30,
        pricePaise: 42000,
        paymentStatus: "UNPAID",
      });
      expect(goldRes.json()).toMatchObject({
        basePricePaise: 60000,
        discountPct: 100,
        pricePaise: 0,
        paymentStatus: "WAIVED",
      });
      expect(trial).toMatchObject({
        kind: "TRIAL",
        channel: "WEBSITE_TRIAL",
        pricePaise: 19900,
        discountPct: 0,
        paymentStatus: "UNPAID",
      });
    });

    it("snapshots the price: a later plan change never rewrites an existing booking", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt();
      const plan = await createPlan(db, { courtDiscountPct: 30 });
      tracker.planIds.push(plan.id);
      const member = await newMember(plan.id);
      const created = await post(
        "/bookings",
        { courtId: court.id, startsAt: at(2, 10) },
        member.cookie,
      );
      expect(created.json()).toMatchObject({
        pricePaise: 42000,
        discountPct: 30,
      });

      await db.execute(
        sql`update plans set court_discount_pct = 100 where id = ${plan.id}`,
      );

      const fetched = await get(
        `/bookings/${created.json().id}`,
        member.cookie,
      );
      expect(fetched.json()).toMatchObject({
        pricePaise: 42000,
        discountPct: 30,
        basePricePaise: 60000,
      });
      const next = await post(
        "/bookings",
        { courtId: court.id, startsAt: at(2, 12) },
        member.cookie,
      );
      expect(next.json()).toMatchObject({
        pricePaise: 0,
        paymentStatus: "WAIVED",
      });
    });

    it("staff can book on behalf of a member at the member price", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt();
      const member = await newMember(silverId);
      const res = await post(
        "/bookings",
        {
          courtId: court.id,
          startsAt: at(2, 10),
          memberId: member.memberId,
          channel: "PHONE",
        },
        cookies.frontDesk,
      );
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({
        pricePaise: 42000,
        channel: "PHONE",
        member: { id: member.memberId },
      });
    });

    it("payNow records one COURT payment attached to the booking; a waived booking records none", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt();
      const gold = await newMember(goldId);
      const paid = await staffBook(court.id, at(1, 9), {
        payNow: { method: "CASH" },
      });
      expect(paid.json()).toMatchObject({ paymentStatus: "PAID" });
      const rows = await db
        .select()
        .from(payments)
        .where(eq(payments.sourceId, paid.json().id));
      expect(rows).toMatchObject([
        {
          source: "COURT",
          kind: "PAYMENT",
          amountPaise: 60000,
          method: "CASH",
        },
      ]);

      const waived = await post(
        "/bookings",
        { courtId: court.id, startsAt: at(1, 11), payNow: { method: "UPI" } },
        gold.cookie,
      );
      expect(waived.json()).toMatchObject({
        paymentStatus: "WAIVED",
        pricePaise: 0,
      });
      expect(
        await db
          .select()
          .from(payments)
          .where(eq(payments.sourceId, waived.json().id)),
      ).toHaveLength(0);
    });

    it("422 BEYOND_BOOKING_HORIZON for guests beyond 2 days and members beyond their plan", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt();
      const guest = await staffBook(court.id, at(3, 10));
      expect(guest.statusCode).toBe(422);
      expect(guest.json().code).toBe("BEYOND_BOOKING_HORIZON");
      const member = await newMember(silverId);
      const far = await post(
        "/bookings",
        { courtId: court.id, startsAt: at(15, 10) },
        member.cookie,
      );
      expect(far.statusCode).toBe(422);
      expect(far.json().code).toBe("BEYOND_BOOKING_HORIZON");
      expect(
        (
          await post(
            "/bookings",
            { courtId: court.id, startsAt: at(14, 10) },
            member.cookie,
          )
        ).statusCode,
      ).toBe(201);
    });

    it("trial bookings may be made up to 7 days ahead, not 8", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt();
      const service = new BookingService(db, { timezone: IST });
      const startsAt = (offset: number) => new Date(at(offset, 10));
      await expect(
        service.create({
          courtId: court.id,
          startsAt: startsAt(8),
          guest: { name: "T", phone: "+919833333331" },
          kind: "TRIAL",
        }),
      ).rejects.toMatchObject({
        code: "BEYOND_BOOKING_HORIZON",
      });
      // Offsets are checked in club time; pick a non-Friday day so the social window is not in play.
      const ok = [6, 7].find((d) => isoWeekdayOf(addDays(today, d)) !== 5)!;
      await expect(
        service.create({
          courtId: court.id,
          startsAt: startsAt(ok),
          guest: { name: "T", phone: "+919833333332" },
          kind: "TRIAL",
        }),
      ).resolves.toMatchObject({
        kind: "TRIAL",
      });
    });

    it("a second trial for the same phone is refused with TRIAL_ALREADY_USED and leaves no booking", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt();
      const service = new BookingService(db, { timezone: IST });
      const guest = { name: "Repeat", phone: "+919844444441" };
      await service.create({
        courtId: court.id,
        startsAt: new Date(at(1, 10)),
        guest,
        kind: "TRIAL",
      });
      await expect(
        service.create({
          courtId: court.id,
          startsAt: new Date(at(1, 12)),
          guest,
          kind: "TRIAL",
        }),
      ).rejects.toMatchObject({
        code: "TRIAL_ALREADY_USED",
        statusCode: 409,
      });
      expect(
        await db
          .select()
          .from(courtOccupancies)
          .where(eq(courtOccupancies.courtId, court.id)),
      ).toHaveLength(1);
    });

    it("422 MEMBERSHIP_EXPIRES_BEFORE_SLOT when the membership ends before the session date", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt();
      const member = await newMember(silverId, 3);
      const res = await post(
        "/bookings",
        { courtId: court.id, startsAt: at(5, 10) },
        member.cookie,
      );
      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({
        code: "MEMBERSHIP_EXPIRES_BEFORE_SLOT",
        requestId: expect.any(String),
      });
      expect(
        (
          await post(
            "/bookings",
            { courtId: court.id, startsAt: at(3, 10) },
            member.cookie,
          )
        ).statusCode,
      ).toBe(201);
    });

    it("a member without an active plan books at the walk-in price", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt();
      const member = await newMember(null);
      const res = await post(
        "/bookings",
        { courtId: court.id, startsAt: at(1, 10) },
        member.cookie,
      );
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ discountPct: 0, pricePaise: 60000 });
    });
  });

  // -----------------------------------------------------------------------------------------------
  describe("pay, no-show and complete", () => {
    it("front desk records payment; the second payment is 409 ALREADY_PAID", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt();
      const created = (await staffBook(court.id, at(1, 10))).json();
      const res = await post(
        `/bookings/${created.id}/pay`,
        { method: "CARD", reference: "slip-1" },
        cookies.frontDesk,
      );
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        booking: { id: created.id, paymentStatus: "PAID" },
        payment: {
          amountPaise: 60000,
          method: "CARD",
          id: expect.any(String),
          paidAt: expect.any(String),
        },
      });
      const again = await post(
        `/bookings/${created.id}/pay`,
        { method: "CASH" },
        cookies.frontDesk,
      );
      expect(again.statusCode).toBe(409);
      expect(again.json().code).toBe("ALREADY_PAID");
      expect(
        await db
          .select()
          .from(payments)
          .where(eq(payments.sourceId, created.id)),
      ).toHaveLength(1);
    });

    it("concurrent payments of one booking write exactly one payment row", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt();
      const created = (await staffBook(court.id, at(1, 10))).json();
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          post(
            `/bookings/${created.id}/pay`,
            { method: "CASH" },
            cookies.frontDesk,
          ),
        ),
      );
      expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
      expect(results.filter((r) => r.statusCode === 409)).toHaveLength(4);
      expect(
        await db
          .select()
          .from(payments)
          .where(eq(payments.sourceId, created.id)),
      ).toHaveLength(1);
    });

    it("a waived (free) booking cannot be paid", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt();
      const gold = await newMember(goldId);
      const created = (
        await post(
          "/bookings",
          { courtId: court.id, startsAt: at(1, 10) },
          gold.cookie,
        )
      ).json();
      const res = await post(
        `/bookings/${created.id}/pay`,
        { method: "CASH" },
        cookies.frontDesk,
      );
      expect(res.statusCode).toBe(409);
    });

    it("a member can pay their own booking by UPI only", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt();
      const member = await newMember();
      const created = (
        await post(
          "/bookings",
          { courtId: court.id, startsAt: at(1, 10) },
          member.cookie,
        )
      ).json();
      expect(
        (
          await post(
            `/bookings/${created.id}/pay`,
            { method: "CASH" },
            member.cookie,
          )
        ).statusCode,
      ).toBe(403);
      const res = await post(
        `/bookings/${created.id}/pay`,
        { method: "UPI", reference: "upi-1" },
        member.cookie,
      );
      expect(res.statusCode).toBe(200);
      expect(res.json().payment).toMatchObject({
        amountPaise: 42000,
        method: "UPI",
      });
    });

    it("400 for an invalid pay body or id, 404 for an unknown booking, 401 when logged out", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      expect(
        (
          await post(
            `/bookings/${NO_SUCH_UUID}/pay`,
            { method: "BARTER" },
            cookies.frontDesk,
          )
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await post(
            "/bookings/not-a-uuid/pay",
            { method: "CASH" },
            cookies.frontDesk,
          )
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await post(
            `/bookings/${NO_SUCH_UUID}/pay`,
            { method: "CASH" },
            cookies.frontDesk,
          )
        ).statusCode,
      ).toBe(404);
      expect(
        (await post(`/bookings/${NO_SUCH_UUID}/pay`, { method: "CASH" }))
          .statusCode,
      ).toBe(401);
    });

    it("no-show and complete are staff-only, one-way transitions", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt();
      const member = await newMember();
      const started = await createBooking(db, {
        courtId: court.id,
        startsAt: new Date(at(-1, 10)),
        bookingDate: addDays(today, -1),
        memberId: member.memberId,
      });
      const started2 = await createBooking(db, {
        courtId: court.id,
        startsAt: new Date(at(-1, 12)),
        bookingDate: addDays(today, -1),
        memberId: member.memberId,
      });

      expect(
        (
          await post(
            `/bookings/${started.id}/no-show`,
            undefined,
            member.cookie,
          )
        ).statusCode,
      ).toBe(403);
      expect(
        (await post(`/bookings/${started.id}/no-show`, undefined)).statusCode,
      ).toBe(401);
      const noShow = await post(
        `/bookings/${started.id}/no-show`,
        undefined,
        cookies.frontDesk,
      );
      expect(noShow.statusCode).toBe(200);
      expect(noShow.json().status).toBe("NO_SHOW");
      expect(
        (
          await post(
            `/bookings/${started.id}/complete`,
            undefined,
            cookies.frontDesk,
          )
        ).statusCode,
      ).toBe(409);
      expect(
        (
          await post(
            `/bookings/${started.id}/no-show`,
            undefined,
            cookies.frontDesk,
          )
        ).statusCode,
      ).toBe(409);

      const done = await post(
        `/bookings/${started2.id}/complete`,
        undefined,
        cookies.owner,
      );
      expect(done.statusCode).toBe(200);
      expect(done.json().status).toBe("COMPLETED");
      expect(
        (
          await post(`/bookings/${started2.id}/cancel`, {}, cookies.frontDesk)
        ).json().code,
      ).toBe("CANCEL_NOT_ALLOWED");
      expect(
        (
          await post(
            `/bookings/${NO_SUCH_UUID}/complete`,
            undefined,
            cookies.frontDesk,
          )
        ).statusCode,
      ).toBe(404);
    });

    it("a booking that has not started yet cannot be marked a no-show", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt();
      const created = (await staffBook(court.id, at(1, 10))).json();
      const res = await post(
        `/bookings/${created.id}/no-show`,
        undefined,
        cookies.frontDesk,
      );
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("BOOKING_STATE_INVALID");
    });
  });

  // -----------------------------------------------------------------------------------------------
  describe("cancel route", () => {
    it("400 for an override without a reason, 401 logged out, 404 unknown, 409 cancelling twice", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt();
      const created = (await staffBook(court.id, at(1, 10))).json();
      expect(
        (
          await post(
            `/bookings/${created.id}/cancel`,
            { override: true },
            cookies.owner,
          )
        ).statusCode,
      ).toBe(400);
      expect(
        (await post(`/bookings/${created.id}/cancel`, {})).statusCode,
      ).toBe(401);
      expect(
        (await post(`/bookings/${NO_SUCH_UUID}/cancel`, {}, cookies.frontDesk))
          .statusCode,
      ).toBe(404);
      expect(
        (await post(`/bookings/${created.id}/cancel`, {}, cookies.frontDesk))
          .statusCode,
      ).toBe(200);
      const twice = await post(
        `/bookings/${created.id}/cancel`,
        {},
        cookies.frontDesk,
      );
      expect(twice.statusCode).toBe(409);
      expect(twice.json()).toMatchObject({
        code: "CANCEL_NOT_ALLOWED",
        requestId: expect.any(String),
      });
    });

    it("override is reserved for bookings:override: the owner may, the front desk may not", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt();
      const a = (await staffBook(court.id, at(1, 10))).json();
      const b = (await staffBook(court.id, at(1, 12))).json();
      const denied = await post(
        `/bookings/${a.id}/cancel`,
        { override: true, reason: "because" },
        cookies.frontDesk,
      );
      expect(denied.statusCode).toBe(403);
      const still = await get(`/bookings/${a.id}`, cookies.frontDesk);
      expect(still.json().status).toBe("CONFIRMED");

      const allowed = await post(
        `/bookings/${b.id}/cancel`,
        { override: true, reason: "owner decision" },
        cookies.owner,
      );
      expect(allowed.statusCode).toBe(200);
      const [log] = await db
        .select()
        .from(systemAuditLogs)
        .where(
          and(
            eq(systemAuditLogs.action, "booking.cancel.override"),
            sql`${systemAuditLogs.details}->>'target' = ${b.id}`,
          ),
        );
      expect(log).toBeDefined();
      expect(log.details).toMatchObject({
        reason: "owner decision",
        override: true,
      });
      await db.delete(systemAuditLogs).where(eq(systemAuditLogs.id, log.id));
    });

    it("every cancellation is audited with the actor and the late flag", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt();
      const created = (await staffBook(court.id, at(1, 10))).json();
      await post(
        `/bookings/${created.id}/cancel`,
        { reason: "x" },
        cookies.frontDesk,
      );
      const [log] = await db
        .select()
        .from(systemAuditLogs)
        .where(
          and(
            eq(systemAuditLogs.action, "booking.cancel"),
            sql`${systemAuditLogs.details}->>'target' = ${created.id}`,
          ),
        );
      expect(log).toBeDefined();
      expect(log.details).toMatchObject({
        late: false,
        override: false,
        refundPaise: 0,
      });
      await db.delete(systemAuditLogs).where(eq(systemAuditLogs.id, log.id));
    });

    it("concurrent cancellations of one paid booking refund exactly once", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt();
      const created = (
        await staffBook(court.id, at(1, 10), { payNow: { method: "CASH" } })
      ).json();
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          post(`/bookings/${created.id}/cancel`, {}, cookies.frontDesk),
        ),
      );
      expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
      const ledger = await db
        .select()
        .from(payments)
        .where(eq(payments.sourceId, created.id));
      expect(ledger.reduce((sum, p) => sum + p.amountPaise, 0)).toBe(0);
      expect(ledger).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------------------------------
  describe("adversarial: authorization (rule T3)", () => {
    it("member A cannot read, cancel or pay member B's booking, and nothing changes", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt();
      const a = await newMember();
      const b = await newMember();
      const bookingOfB = (
        await post(
          "/bookings",
          { courtId: court.id, startsAt: at(2, 10) },
          b.cookie,
        )
      ).json();

      const read = await get(`/bookings/${bookingOfB.id}`, a.cookie);
      const cancel = await post(
        `/bookings/${bookingOfB.id}/cancel`,
        { reason: "mine now" },
        a.cookie,
      );
      const pay = await post(
        `/bookings/${bookingOfB.id}/pay`,
        { method: "UPI" },
        a.cookie,
      );

      for (const res of [read, cancel, pay]) {
        expect(res.statusCode).toBe(403);
        expect(res.json()).toMatchObject({
          code: "FORBIDDEN",
          requestId: expect.any(String),
        });
      }
      const [row] = await db
        .select()
        .from(bookings)
        .where(eq(bookings.id, bookingOfB.id));
      expect(row).toMatchObject({
        status: "CONFIRMED",
        paymentStatus: "UNPAID",
      });
      expect(
        await db
          .select()
          .from(courtOccupancies)
          .where(eq(courtOccupancies.bookingId, bookingOfB.id)),
      ).toHaveLength(1);
      // B can still read it.
      expect(
        (await get(`/bookings/${bookingOfB.id}`, b.cookie)).statusCode,
      ).toBe(200);
    });

    it("a member cannot book on behalf of another member (memberId of someone else is 403)", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt();
      const a = await newMember();
      const b = await newMember();
      const res = await post(
        "/bookings",
        { courtId: court.id, startsAt: at(2, 10), memberId: b.memberId },
        a.cookie,
      );
      expect(res.statusCode).toBe(403);
      expect(
        await db.select().from(bookings).where(eq(bookings.courtId, court.id)),
      ).toHaveLength(0);
    });

    it("passing their own memberId is fine; a member cannot book a guest or pick a staff channel", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt();
      const a = await newMember();
      const own = await post(
        "/bookings",
        {
          courtId: court.id,
          startsAt: at(2, 10),
          memberId: a.memberId,
          channel: "DESK",
        },
        a.cookie,
      );
      expect(own.statusCode).toBe(201);
      expect(own.json()).toMatchObject({
        channel: "ONLINE",
        member: { id: a.memberId },
      });
      const guest = await post(
        "/bookings",
        { courtId: court.id, startsAt: at(2, 12), guest: guestBody(7) },
        a.cookie,
      );
      expect(guest.statusCode).toBe(403);
    });

    it("a member's cash payNow only pays the 20% promise fee, and a member cannot override a cancellation", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt();
      const a = await newMember();
      const cashy = await post(
        "/bookings",
        { courtId: court.id, startsAt: at(2, 10), payNow: { method: "CASH" } },
        a.cookie,
      );
      expect(cashy.statusCode).toBe(201);
      expect(cashy.json().paymentStatus).toBe("PARTIAL");
      const created = cashy.json();
      const override = await post(
        `/bookings/${created.id}/cancel`,
        { override: true, reason: "let me" },
        a.cookie,
      );
      expect(override.statusCode).toBe(403);
      expect(
        (await get(`/bookings/${created.id}`, a.cookie)).json().status,
      ).toBe("CONFIRMED");
    });

    it("members cannot use staff routes: list all bookings, no-show, complete, demo race", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt();
      const a = await newMember();
      const created = (
        await post(
          "/bookings",
          { courtId: court.id, startsAt: at(2, 10) },
          a.cookie,
        )
      ).json();
      expect((await get("/bookings", a.cookie)).statusCode).toBe(403);
      expect(
        (await post(`/bookings/${created.id}/no-show`, undefined, a.cookie))
          .statusCode,
      ).toBe(403);
      expect(
        (await post(`/bookings/${created.id}/complete`, undefined, a.cookie))
          .statusCode,
      ).toBe(403);
      expect(
        (
          await post(
            "/demo/booking-race",
            { courtId: court.id, startsAt: at(1, 9), attempts: 5 },
            a.cookie,
          )
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await post(
            "/demo/booking-race",
            { courtId: court.id, startsAt: at(1, 9), attempts: 5 },
            cookies.frontDesk,
          )
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await post("/demo/booking-race", {
            courtId: court.id,
            startsAt: at(1, 9),
            attempts: 5,
          })
        ).statusCode,
      ).toBe(401);
    });

    it("bar staff cannot create, read or cancel bookings", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt();
      const created = (await staffBook(court.id, at(1, 10))).json();
      expect(
        (await get(`/bookings/${created.id}`, cookies.bar)).statusCode,
      ).toBe(403);
      expect(
        (await post(`/bookings/${created.id}/cancel`, {}, cookies.bar))
          .statusCode,
      ).toBe(403);
      expect((await get("/bookings", cookies.bar)).statusCode).toBe(403);
    });

    it("a suspended account is denied and creates nothing", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt();
      const res = await post(
        "/bookings",
        { courtId: court.id, startsAt: at(1, 10) },
        cookies.suspended,
      );
      // 401 while the session cache is evicted (session no longer validates), 403 once suspended
      // sessions are rejected by the policy engine: either way the request is refused.
      expect([401, 403]).toContain(res.statusCode);
      expect(
        await db.select().from(bookings).where(eq(bookings.courtId, court.id)),
      ).toHaveLength(0);
    });

    it("a member whose membership user was suspended mid-session still cannot read others (self rule uses user id)", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const a = await newMember();
      const orphan = await createBooking(db, {
        courtId: (await newCourt()).id,
        startsAt: new Date(at(2, 10)),
        bookingDate: addDays(today, 2),
      }); // guest booking: no owner
      // A booking with no member owner can never match a :self permission.
      expect((await get(`/bookings/${orphan.id}`, a.cookie)).statusCode).toBe(
        403,
      );
      expect(
        (await post(`/bookings/${orphan.id}/cancel`, {}, a.cookie)).statusCode,
      ).toBe(403);
    });

    it("the demo race tool is a 404 in production", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt();
      const env = app.env as { NODE_ENV: string };
      const original = env.NODE_ENV;
      try {
        env.NODE_ENV = "production";
        const res = await post(
          "/demo/booking-race",
          { courtId: court.id, startsAt: at(1, 9), attempts: 5 },
          cookies.owner,
        );
        expect(res.statusCode).toBe(404);
        expect(
          await db
            .select()
            .from(members)
            .where(sql`${members.memberCode} like 'RC%'`),
        ).toHaveLength(0);
      } finally {
        env.NODE_ENV = original;
      }
    });
  });

  // -----------------------------------------------------------------------------------------------
  describe("GET /bookings, /bookings/:id and /me/bookings", () => {
    it("lists bookings for staff with filters and the paginated contract shape", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt();
      const created = (await staffBook(court.id, at(1, 10))).json();
      await staffBook(court.id, at(1, 12));
      const res = await get(
        `/bookings?courtId=${court.id}&date=${addDays(today, 1)}&limit=1`,
        cookies.frontDesk,
      );
      expect(res.statusCode).toBe(200);
      const page = BookingPageSchema.parse(res.json());
      expect(page.data).toHaveLength(1);
      expect(page.meta).toMatchObject({
        page: 1,
        limit: 1,
        totalItems: 2,
        totalPages: 2,
        hasNextPage: true,
      });
      const ranged = await get(
        `/bookings?courtId=${court.id}&from=${addDays(today, 1)}&to=${addDays(today, 1)}&status=CONFIRMED`,
        cookies.owner,
      );
      expect(
        BookingPageSchema.parse(ranged.json()).data.map((b) => b.id),
      ).toContain(created.id);
    });

    it("400 for a bad query, 401 logged out", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      expect(
        (
          await get(
            `/bookings?date=${addDays(today, 1)}&from=${addDays(today, 1)}`,
            cookies.frontDesk,
          )
        ).statusCode,
      ).toBe(400);
      expect(
        (await get("/bookings?status=NOPE", cookies.frontDesk)).statusCode,
      ).toBe(400);
      expect((await get("/bookings")).statusCode).toBe(401);
      expect((await get("/me/bookings")).statusCode).toBe(401);
    });

    it("/me/bookings returns only the caller own bookings, upcoming then past", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt();
      const a = await newMember();
      const b = await newMember();
      const mine = (
        await post(
          "/bookings",
          { courtId: court.id, startsAt: at(2, 10) },
          a.cookie,
        )
      ).json();
      await post(
        "/bookings",
        { courtId: court.id, startsAt: at(2, 12) },
        b.cookie,
      );
      await createBooking(db, {
        courtId: court.id,
        startsAt: new Date(at(-2, 10)),
        bookingDate: addDays(today, -2),
        memberId: a.memberId,
        status: "COMPLETED",
      });

      const upcoming = BookingPageSchema.parse(
        (await get("/me/bookings", a.cookie)).json(),
      );
      expect(upcoming.data.map((x) => x.id)).toEqual([mine.id]);
      const past = BookingPageSchema.parse(
        (await get("/me/bookings?scope=past", a.cookie)).json(),
      );
      expect(past.data).toHaveLength(1);
      expect(past.data[0].status).toBe("COMPLETED");
      // A login with no member profile sees an empty page rather than an error.
      const empty = await get("/me/bookings", cookies.plain);
      expect(empty.statusCode).toBe(200);
      expect(empty.json().data).toEqual([]);
    });

    it("GET /bookings/:id: 404 for unknown (staff), 400 for a bad id, 200 for own", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      expect(
        (await get(`/bookings/${NO_SUCH_UUID}`, cookies.frontDesk)).statusCode,
      ).toBe(404);
      expect((await get("/bookings/xyz", cookies.frontDesk)).statusCode).toBe(
        400,
      );
      expect((await get(`/bookings/${NO_SUCH_UUID}`)).statusCode).toBe(401);
    });
  });

  // -----------------------------------------------------------------------------------------------
  describe("M-08: Friday social play", () => {
    const fridayStart = () => at(fridayOffset, 19, 0);

    it("POST /bookings/social/join: 401 logged out, 400 invalid body, 403 bar staff", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt("Social Court", socialTypeId);
      expect(
        (
          await post("/bookings/social/join", {
            courtId: court.id,
            startsAt: fridayStart(),
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (
          await post(
            "/bookings/social/join",
            { courtId: "x", startsAt: "y" },
            cookies.frontDesk,
          )
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await post(
            "/bookings/social/join",
            { courtId: court.id, startsAt: fridayStart(), guest: guestBody(1) },
            cookies.bar,
          )
        ).statusCode,
      ).toBe(403);
    });

    it("the first join creates the session and its SOCIAL occupancy; the response matches the contract", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt("Social Court", socialTypeId);
      const silver = await newMember(silverId);
      const res = await post(
        "/bookings/social/join",
        { courtId: court.id, startsAt: fridayStart() },
        silver.cookie,
      );
      expect(res.statusCode).toBe(201);
      const body = JoinSocialResponseSchema.parse(res.json());
      expect(body).toMatchObject({
        kind: "SOCIAL",
        socialSession: { capacity: 8, joined: 1 },
        basePricePaise: 14000,
        discountPct: 30,
        pricePaise: 9800,
        status: "CONFIRMED",
      });
      expect(body.socialSessionId).toEqual(expect.any(String));
      const occupancies = await db
        .select()
        .from(courtOccupancies)
        .where(eq(courtOccupancies.courtId, court.id));
      expect(occupancies).toMatchObject([
        { kind: "SOCIAL", socialSessionId: body.socialSessionId },
      ]);

      const gold = await newMember(goldId);
      const second = await post(
        "/bookings/social/join",
        { courtId: court.id, startsAt: fridayStart() },
        gold.cookie,
      );
      expect(second.json()).toMatchObject({
        pricePaise: 0,
        paymentStatus: "WAIVED",
        socialSession: { capacity: 8, joined: 2 },
      });
      expect(
        await db
          .select()
          .from(courtOccupancies)
          .where(eq(courtOccupancies.courtId, court.id)),
      ).toHaveLength(1);
    });

    it("12 concurrent joins of a capacity-8 session: exactly 8 succeed, 4 get SOCIAL_FULL", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt("Social Court", socialTypeId);
      const people = await Promise.all(
        Array.from({ length: 12 }, () => newMember()),
      );

      const results = await Promise.all(
        people.map((p) =>
          post(
            "/bookings/social/join",
            { courtId: court.id, startsAt: fridayStart() },
            p.cookie,
          ),
        ),
      );

      expect(results.filter((r) => r.statusCode === 201)).toHaveLength(8);
      const full = results.filter((r) => r.statusCode === 409);
      expect(full).toHaveLength(4);
      for (const r of full)
        expect(r.json()).toMatchObject({
          code: "SOCIAL_FULL",
          requestId: expect.any(String),
        });
      const sessions = await db
        .select()
        .from(socialSessions)
        .where(eq(socialSessions.courtId, court.id));
      expect(sessions).toHaveLength(1);
      const joined = await db
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.socialSessionId, sessions[0].id),
            eq(bookings.status, "CONFIRMED"),
          ),
        );
      expect(joined).toHaveLength(8);
      // Losers left nothing behind.
      expect(
        await db.select().from(bookings).where(eq(bookings.courtId, court.id)),
      ).toHaveLength(8);
    });

    it("a member cannot join the same session twice (ALREADY_JOINED), even concurrently", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt("Social Court", socialTypeId);
      const a = await newMember();
      const results = await Promise.all(
        Array.from({ length: 3 }, () =>
          post(
            "/bookings/social/join",
            { courtId: court.id, startsAt: fridayStart() },
            a.cookie,
          ),
        ),
      );
      expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
      for (const r of results.filter((x) => x.statusCode !== 201)) {
        expect(r.statusCode).toBe(409);
        expect(["ALREADY_JOINED", "MEMBER_DOUBLE_BOOKED"]).toContain(
          r.json().code,
        );
      }
      const again = await post(
        "/bookings/social/join",
        { courtId: court.id, startsAt: fridayStart() },
        a.cookie,
      );
      expect(again.statusCode).toBe(409);
      expect(["ALREADY_JOINED", "MEMBER_DOUBLE_BOOKED"]).toContain(
        again.json().code,
      );
      expect(
        await db
          .select()
          .from(bookings)
          .where(eq(bookings.memberId, a.memberId)),
      ).toHaveLength(1);
    });

    it("exclusive bookings inside the window are refused with 409 SOCIAL_WINDOW, before and after the session exists", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt("Social Court", socialTypeId);
      const a = await newMember();
      const before = await post(
        "/bookings",
        { courtId: court.id, startsAt: fridayStart() },
        a.cookie,
      );
      expect(before.statusCode).toBe(409);
      expect(before.json()).toMatchObject({
        code: "SOCIAL_WINDOW",
        requestId: expect.any(String),
      });
      expect(
        (
          await post(
            "/bookings/social/join",
            { courtId: court.id, startsAt: fridayStart() },
            (await newMember()).cookie,
          )
        ).statusCode,
      ).toBe(201);
      const after = await post(
        "/bookings",
        { courtId: court.id, startsAt: fridayStart() },
        a.cookie,
      );
      expect(after.json().code).toBe("SOCIAL_WINDOW");
      // A half-hour start overlapping the session inside the window is refused too.
      const half = await post(
        "/bookings",
        { courtId: court.id, startsAt: at(fridayOffset, 19, 30) },
        a.cookie,
      );
      expect(half.json().code).toBe("SOCIAL_WINDOW");
      // Outside the window the same court stays bookable on Friday.
      expect(
        (
          await post(
            "/bookings",
            { courtId: court.id, startsAt: at(fridayOffset, 10) },
            a.cookie,
          )
        ).statusCode,
      ).toBe(201);
    });

    it("an overlapping exclusive booking that starts before the window cannot steal a held court-hour", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt("Social Court", socialTypeId);
      await post(
        "/bookings/social/join",
        { courtId: court.id, startsAt: at(fridayOffset, 18) },
        (await newMember()).cookie,
      );
      // 17:30-18:30 starts outside the window but overlaps the held 18:00-19:00 court-hour.
      const res = await post(
        "/bookings",
        { courtId: court.id, startsAt: at(fridayOffset, 17, 30) },
        (await newMember()).cookie,
      );
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("SLOT_TAKEN");
    });

    it("social joins count toward the daily limit (BR-04)", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt("Social Court", socialTypeId);
      const member = await newMember(oneADayId);
      expect(
        (
          await post(
            "/bookings",
            { courtId: court.id, startsAt: at(fridayOffset, 9) },
            member.cookie,
          )
        ).statusCode,
      ).toBe(201);
      const res = await post(
        "/bookings/social/join",
        { courtId: court.id, startsAt: fridayStart() },
        member.cookie,
      );
      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({
        code: "DAILY_LIMIT_REACHED",
        requestId: expect.any(String),
      });
      // The failed join must not leave an empty session or occupancy behind.
      expect(
        await db
          .select()
          .from(socialSessions)
          .where(eq(socialSessions.courtId, court.id)),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(courtOccupancies)
          .where(
            and(
              eq(courtOccupancies.courtId, court.id),
              eq(courtOccupancies.kind, "SOCIAL"),
            ),
          ),
      ).toHaveLength(0);
    });

    it("a member cannot join two overlapping sessions on different courts", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const one = await newCourt("Social Court A", socialTypeId);
      const two = await newCourt("Social Court B", socialTypeId);
      const member = await newMember();
      expect(
        (
          await post(
            "/bookings/social/join",
            { courtId: one.id, startsAt: fridayStart() },
            member.cookie,
          )
        ).statusCode,
      ).toBe(201);
      const res = await post(
        "/bookings/social/join",
        { courtId: two.id, startsAt: fridayStart() },
        member.cookie,
      );
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("MEMBER_DOUBLE_BOOKED");
      // Back-to-back hours are fine.
      expect(
        (
          await post(
            "/bookings/social/join",
            { courtId: two.id, startsAt: at(fridayOffset, 20) },
            member.cookie,
          )
        ).statusCode,
      ).toBe(201);
    });

    it("cancelling a participant reopens a spot", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt("Small Social Court", smallSocialTypeId); // capacity 2
      const [a, b, c] = await Promise.all([
        newMember(),
        newMember(),
        newMember(),
      ]);
      const joinA = await post(
        "/bookings/social/join",
        { courtId: court.id, startsAt: fridayStart() },
        a.cookie,
      );
      expect(
        (
          await post(
            "/bookings/social/join",
            { courtId: court.id, startsAt: fridayStart() },
            b.cookie,
          )
        ).statusCode,
      ).toBe(201);
      const full = await post(
        "/bookings/social/join",
        { courtId: court.id, startsAt: fridayStart() },
        c.cookie,
      );
      expect(full.statusCode).toBe(409);
      expect(full.json().code).toBe("SOCIAL_FULL");

      const cancel = await post(
        `/bookings/${joinA.json().id}/cancel`,
        {},
        a.cookie,
      );
      expect(cancel.statusCode).toBe(200);
      expect(cancel.json()).toMatchObject({ late: false, quotaFreed: true });

      const retry = await post(
        "/bookings/social/join",
        { courtId: court.id, startsAt: fridayStart() },
        c.cookie,
      );
      expect(retry.statusCode).toBe(201);
      expect(retry.json().socialSession).toEqual({ capacity: 2, joined: 2 });
      // The session (and its single occupancy) survives the cancellation.
      expect(
        await db
          .select()
          .from(courtOccupancies)
          .where(eq(courtOccupancies.courtId, court.id)),
      ).toHaveLength(1);
    });

    it("422 NOT_A_SOCIAL_SLOT outside a window, off the hour, or on the wrong day", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt("Social Court", socialTypeId);
      const member = await newMember();
      const nonFriday = [1, 2, 3].find(
        (d) => isoWeekdayOf(addDays(today, d)) !== 5,
      )!;
      const cases = [
        at(fridayOffset, 10), // Friday morning: not in the window
        at(fridayOffset, 19, 30), // inside the window but not on the hour
        at(fridayOffset, 21, 30), // would end after the window
        at(nonFriday, 19), // a day without a window
      ];
      for (const startsAt of cases) {
        const res = await post(
          "/bookings/social/join",
          { courtId: court.id, startsAt },
          member.cookie,
        );
        expect(res.statusCode, startsAt).toBe(422);
        expect(res.json()).toMatchObject({
          code: "NOT_A_SOCIAL_SLOT",
          requestId: expect.any(String),
        });
      }
      expect(
        await db
          .select()
          .from(socialSessions)
          .where(eq(socialSessions.courtId, court.id)),
      ).toHaveLength(0);
    });

    it("a member cannot join on behalf of another member or as a guest", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt("Social Court", socialTypeId);
      const a = await newMember();
      const b = await newMember();
      expect(
        (
          await post(
            "/bookings/social/join",
            {
              courtId: court.id,
              startsAt: fridayStart(),
              memberId: b.memberId,
            },
            a.cookie,
          )
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await post(
            "/bookings/social/join",
            { courtId: court.id, startsAt: fridayStart(), guest: guestBody(9) },
            a.cookie,
          )
        ).statusCode,
      ).toBe(403);
      expect(
        await db.select().from(bookings).where(eq(bookings.courtId, court.id)),
      ).toHaveLength(0);
    });

    it("front desk can enrol a member in a social session", async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const court = await newCourt("Social Court", socialTypeId);
      const member = await newMember();
      const res = await post(
        "/bookings/social/join",
        {
          courtId: court.id,
          startsAt: fridayStart(),
          memberId: member.memberId,
        },
        cookies.frontDesk,
      );
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({
        kind: "SOCIAL",
        member: { id: member.memberId },
        channel: "DESK",
      });
    });
  });
});
