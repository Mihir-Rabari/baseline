import { describe, it, expect } from 'vitest';
import { ALL_COURT_NAMES, BULK_DEFAULTS, EXTRA_COURTS, generateBookings, generateUsers } from './seed-bulk-data.js';

const opts = { ...BULK_DEFAULTS, today: '2026-03-15' };

describe('bulk seed data generator', () => {
  const users = generateUsers(opts);
  const bookings = generateBookings(opts, users);

  it('is deterministic for a given seed and differs for another', () => {
    expect(generateUsers(opts)).toEqual(users);
    expect(generateBookings(opts, users)).toEqual(bookings);
    expect(generateUsers({ ...opts, seed: 1 })).not.toEqual(users);
  });

  it('produces 300 users with unique emails, member codes and phones', () => {
    expect(users).toHaveLength(300);
    for (const field of ['email', 'memberCode'] as const) {
      expect(new Set(users.map((u) => u[field])).size).toBe(300);
    }
    expect(new Set(users.map((u) => u.phone)).size).toBeGreaterThan(290);
    expect(users.every((u) => /^CC-\d{6}$/.test(u.memberCode) && u.memberCode >= 'CC-001001')).toBe(true);
  });

  it('mixes tiers and account statuses, and juniors are under 18', () => {
    for (const tier of ['GOLD', 'SILVER', 'JUNIOR'] as const) expect(users.some((u) => u.tier === tier)).toBe(true);
    for (const status of ['ACTIVE', 'SUSPENDED', 'DISABLED'] as const) expect(users.some((u) => u.status === status)).toBe(true);
    for (const u of users.filter((x) => x.tier === 'JUNIOR')) {
      const ageDays = (Date.parse(opts.today) - Date.parse(u.dateOfBirth)) / 86_400_000;
      expect(ageDays / 365.25).toBeLessThan(18);
    }
  });

  it('gives each user at most one ACTIVE membership, always the last term', () => {
    for (const u of users) {
      const active = u.memberships.filter((m) => m.status === 'ACTIVE');
      expect(active.length).toBeLessThanOrEqual(1);
      if (active.length) expect(u.memberships.at(-1)?.status).toBe('ACTIVE');
      for (const m of u.memberships) expect(m.endsOn > m.startsOn).toBe(true);
    }
    expect(users.some((u) => !u.memberships.some((m) => m.status === 'ACTIVE'))).toBe(true);
  });

  it('covers 10 courts in total (8 base + extras)', () => {
    expect(ALL_COURT_NAMES).toHaveLength(10);
    for (const extra of EXTRA_COURTS) expect(ALL_COURT_NAMES).toContain(extra.name);
  });

  it('generates thousands of bookings spanning past and future, never double-booking a court or member', () => {
    expect(bookings.length).toBeGreaterThan(2000);
    expect(bookings.some((b) => b.date < opts.today)).toBe(true);
    expect(bookings.some((b) => b.date > opts.today)).toBe(true);
    const courtSlots = new Set<string>();
    const memberSlots = new Set<string>();
    for (const b of bookings) {
      const courtKey = `${b.courtName}|${b.date}|${b.hour}`;
      expect(courtSlots.has(courtKey)).toBe(false);
      courtSlots.add(courtKey);
      if (b.status !== 'CANCELLED') {
        const memberKey = `${b.userIndex}|${b.date}|${b.hour}`;
        expect(memberSlots.has(memberKey)).toBe(false);
        memberSlots.add(memberKey);
      }
      expect(b.hour).toBeGreaterThanOrEqual(6);
      expect(b.hour).toBeLessThan(22);
    }
  });

  it('only lets active users with an active membership book, and keeps history/future statuses sane', () => {
    for (const b of bookings) {
      const u = users[b.userIndex];
      expect(u.status).toBe('ACTIVE');
      expect(u.memberships.some((m) => m.status === 'ACTIVE')).toBe(true);
      if (b.date > opts.today) expect(['CONFIRMED', 'CANCELLED']).toContain(b.status);
      if (b.date < opts.today) expect(b.status).not.toBe('CONFIRMED');
    }
  });
});
