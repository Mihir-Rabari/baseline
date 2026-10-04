import { describe, it, expect } from 'vitest';

/**
 * Seed idempotency for the CourtOS roles and policies (rule T5).
 * Runs only when DATABASE_URL is set in the real environment and the schema is migrated,
 * like the other database-backed tests. Imports are dynamic so that merely loading the
 * module never reads .env or opens a connection.
 */
const databaseUrl = process.env.DATABASE_URL;

describe('baseline permission registry (agent)', () => {
  it('registers agent:use and agent:act exactly once as system permissions', async () => {
    const { BASELINE_PERMISSIONS } = await import('./seed.js');
    for (const id of ['agent:use', 'agent:act']) {
      const matches = BASELINE_PERMISSIONS.filter((p) => p.id === id);
      expect(matches, id).toHaveLength(1);
      expect(matches[0].namespace).toBe('agent');
      expect(matches[0].isSystem).toBe(true);
    }
    const ids = BASELINE_PERMISSIONS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe.skipIf(!databaseUrl)('seedDomainIam (database)', () => {
  it('creates MEMBER, FRONT_DESK, BAR_STAFF and OWNER and yields identical row counts on re-run', async () => {
    const { getDb, closeDatabase } = await import('./client.js');
    const { seedDomainIam } = await import('./seed.js');
    const { roles, policies, policyStatements, rolePolicies } = await import('./schema/index.js');
    const { count } = await import('drizzle-orm');

    const db = getDb();
    const counts = async () => ({
      roles: (await db.select({ n: count() }).from(roles))[0].n,
      policies: (await db.select({ n: count() }).from(policies))[0].n,
      statements: (await db.select({ n: count() }).from(policyStatements))[0].n,
      links: (await db.select({ n: count() }).from(rolePolicies))[0].n,
    });

    try {
      await seedDomainIam(db);
      const first = await counts();
      await seedDomainIam(db);
      const second = await counts();
      expect(second).toEqual(first);

      const names = (await db.select({ name: roles.name }).from(roles)).map((r) => r.name);
      expect(names).toEqual(expect.arrayContaining(['MEMBER', 'FRONT_DESK', 'BAR_STAFF', 'OWNER']));
    } finally {
      await closeDatabase();
    }
  });
});
