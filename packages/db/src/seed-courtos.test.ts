import { describe, it, expect } from 'vitest';

/**
 * CourtOS demo seed idempotency (rule T5, task M-03).
 * Runs only when DATABASE_URL is set and the schema is migrated, like the other
 * database-backed tests. Imports are dynamic so loading the module never opens a connection.
 */
const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)('seedCourtOs (database)', () => {
  it('seeds the expected rows and yields identical per-table counts on a second run', async () => {
    const { getDb, closeDatabase } = await import('./client.js');
    const { seedDomainIam } = await import('./seed.js');
    const { seedCourtOs } = await import('./seed-courtos.js');
    const schema = await import('./schema/index.js');
    const { count, eq, like, inArray } = await import('drizzle-orm');

    const db = getDb();
    const tables = {
      plans: schema.plans,
      courtTypes: schema.courtTypes,
      courts: schema.courts,
      socialWindows: schema.socialWindows,
      systemSettings: schema.systemSettings,
      products: schema.products,
      menuItems: schema.menuItems,
      barTables: schema.barTables,
      employees: schema.employees,
      members: schema.members,
      memberships: schema.memberships,
      membershipEvents: schema.membershipEvents,
    };
    const counts = async () => {
      const out: Record<string, number> = {};
      for (const [name, table] of Object.entries(tables)) {
        out[name] = (await db.select({ n: count() }).from(table))[0].n;
      }
      // Other suites share this database and create users concurrently, so count only the demo users.
      const demoUsers = db.select({ id: schema.users.id }).from(schema.users).where(like(schema.users.email, '%@courtos.test'));
      out.demoUsers = (await demoUsers).length;
      out.demoUserRoles = (
        await db.select({ n: count() }).from(schema.userRoles).where(inArray(schema.userRoles.userId, demoUsers))
      )[0].n;
      return out;
    };

    try {
      await seedDomainIam(db);
      await seedCourtOs(db, { demoPassword: 'test-only-demo-secret-1' });
      const first = await counts();
      const [ownerBefore] = await db.select().from(schema.users).where(eq(schema.users.email, 'owner@courtos.test'));

      // Second run, with a different password: counts identical and credentials untouched.
      await seedCourtOs(db, { demoPassword: 'a-different-secret-2' });
      const second = await counts();
      expect(second).toEqual(first);
      const [ownerAfter] = await db.select().from(schema.users).where(eq(schema.users.email, 'owner@courtos.test'));
      expect(ownerAfter.passwordHash).toBe(ownerBefore.passwordHash);
      expect(ownerAfter.passwordHash).not.toContain('test-only-demo-secret-1');

      // Without a password the demo users are skipped (no error) and nothing changes.
      await seedCourtOs(db, { demoPassword: undefined });
      expect(await counts()).toEqual(first);

      expect(first.plans).toBe(3);
      expect(first.courtTypes).toBe(4);
      expect(first.courts).toBe(8);
      expect(first.socialWindows).toBe(1);
      expect(first.products).toBe(30);
      expect(first.menuItems).toBe(25);
      expect(first.barTables).toBe(10);
      expect(first.employees).toBe(5);
      expect(first.demoUsers).toBe(4);
      expect(first.demoUserRoles).toBe(4);
      expect(first.members).toBe(40);
      expect(first.memberships).toBe(40);

      const lowStock = (await db.select().from(schema.products)).filter((p) => p.stockQty <= p.reorderLevel);
      expect(lowStock).toHaveLength(3);
      expect(lowStock.some((p) => p.stockQty === 1)).toBe(true);

      const keys = (await db.select({ key: schema.systemSettings.key }).from(schema.systemSettings)).map((r) => r.key);
      expect(keys).toEqual(
        expect.arrayContaining(['club.hours', 'booking.cancel_cutoff_hours', 'tax.rates', 'shop.delivery_fee_paise'])
      );
    } finally {
      await closeDatabase();
    }
  });

  it('skips demo users without a password instead of failing', async () => {
    const { getDb, closeDatabase } = await import('./client.js');
    const { seedCourtOs } = await import('./seed-courtos.js');
    const { users } = await import('./schema/index.js');
    const { count, like } = await import('drizzle-orm');
    const db = getDb();
    try {
      const before = (await db.select({ n: count() }).from(users).where(like(users.email, '%@courtos.test')))[0].n;
      await expect(seedCourtOs(db, { demoPassword: '' })).resolves.toBeUndefined();
      const after = (await db.select({ n: count() }).from(users).where(like(users.email, '%@courtos.test')))[0].n;
      expect(after).toBe(before);
    } finally {
      await closeDatabase();
    }
  });
});
