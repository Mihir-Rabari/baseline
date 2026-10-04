import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type postgres from 'postgres';
import type { DatabaseInstance } from './client.js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * Bulk demo seed integrity and idempotency (rule T5).
 * Runs only when DATABASE_URL is set, in a disposable database on that server.
 * Imports are dynamic so loading the module never opens a connection.
 */
const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)('seedBulk (database)', () => {
  const databaseName = `bulk_seed_test_${randomUUID().replaceAll('-', '')}`;
  let admin: postgres.Sql | undefined;
  let client: postgres.Sql | undefined;
  let db: DatabaseInstance;
  let databaseCreated = false;

  // Validate before any DDL: teardown must never target the configured database.
  const validateDatabaseName = () => {
    if (!/^bulk_seed_test_[a-f0-9]{32}$/.test(databaseName)) {
      throw new Error('Invalid disposable seed database name');
    }
  };

  beforeAll(async () => {
    const { default: postgres } = await import('postgres');
    const { createDatabaseClient } = await import('./client.js');
    const { migrate } = await import('drizzle-orm/postgres-js/migrator');
    const { getEnv } = await import('@packages/config/env');
    validateDatabaseName();
    const adminUrl = new URL(databaseUrl!);
    adminUrl.pathname = '/postgres';
    admin = postgres(adminUrl.toString(), {
      max: 1,
      ssl: getEnv().DATABASE_SSL,
      connect_timeout: 10,
      onnotice: () => {},
    });
    await admin`CREATE DATABASE ${admin(databaseName)}`;
    databaseCreated = true;
    const isolatedUrl = new URL(databaseUrl!);
    isolatedUrl.pathname = `/${databaseName}`;
    const connection = createDatabaseClient({ connectionString: isolatedUrl.toString(), maxConnections: 1 });
    client = connection.sql;
    db = connection.db;
    await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
  });

  afterAll(async () => {
    try {
      await client?.end();
    } finally {
      try {
        if (admin && databaseCreated) {
          validateDatabaseName();
          await admin`DROP DATABASE ${admin(databaseName)}`;
        }
      } finally {
        await admin?.end();
      }
    }
  });

  it('creates ~450 member users, 10 courts and bookings that satisfy the DB constraints, and is idempotent', async () => {
    const { seedDomainIam } = await import('./seed.js');
    const { seedCourtOs } = await import('./seed-courtos.js');
    const { seedBulk } = await import('./seed-bulk.js');
    const schema = await import('./schema/index.js');
    const { count, like, eq } = await import('drizzle-orm');

    const counts = async () => ({
      users: (await db.select({ n: count() }).from(schema.users).where(like(schema.users.email, '%@baseline.test')))[0].n,
      members: (await db.select({ n: count() }).from(schema.members))[0].n,
      memberships: (await db.select({ n: count() }).from(schema.memberships))[0].n,
      courts: (await db.select({ n: count() }).from(schema.courts))[0].n,
      bookings: (await db.select({ n: count() }).from(schema.bookings))[0].n,
      occupancies: (await db.select({ n: count() }).from(schema.courtOccupancies))[0].n,
      payments: (await db.select({ n: count() }).from(schema.payments))[0].n,
    });

    await seedDomainIam(db);
    await seedCourtOs(db, { demoPassword: null });
    await expect(seedBulk(db, { password: '' })).rejects.toThrow(/BULK_SEED_PASSWORD/);

    await seedBulk(db, { password: 'bulk-test-secret-1', today: '2026-03-15' });
    const first = await counts();
    expect(first.users).toBe(450);
    expect(first.courts).toBe(10);
    expect(first.bookings).toBeGreaterThan(2000);
    expect(first.occupancies).toBeLessThanOrEqual(first.bookings); // cancelled bookings hold no slot
    expect(first.payments).toBeGreaterThan(0);

    const [sample] = await db.select().from(schema.users).where(eq(schema.users.email, 'bulk.user0001@baseline.test'));
    expect(sample.passwordHash).not.toContain('bulk-test-secret-1');

    // Every bulk user holds the MEMBER role and has a linked member profile.
    const memberRoles = await db.select({ n: count() }).from(schema.userRoles)
      .innerJoin(schema.users, eq(schema.users.id, schema.userRoles.userId))
      .where(like(schema.users.email, '%@baseline.test'));
    expect(memberRoles[0].n).toBe(450);

    await seedBulk(db, { password: 'a-different-secret-2', today: '2026-03-15' });
    expect(await counts()).toEqual(first);
    const [after] = await db.select().from(schema.users).where(eq(schema.users.email, 'bulk.user0001@baseline.test'));
    expect(after.passwordHash).toBe(sample.passwordHash);
  }, 120_000);
});
