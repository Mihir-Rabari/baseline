import { describe, it, expect, beforeAll } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { getDb, users, roles, groups, policies, policyStatements } from '@packages/db';
import { AppConfig } from '@packages/config';
import { IamService } from './iam-service.js';
import { SystemRecordProtectedError, PrivilegeEscalationError, RootProtectedError } from '../errors.js';

/**
 * Integration coverage for IamService against a real Postgres instance.
 *
 * `iam-service.ts` is the most security-critical file in the codebase: it resolves
 * effective permissions and mediates every role/group/policy mutation. Nearly every
 * method here goes straight through Drizzle, so unit tests that fake the query builder
 * either don't compile against real query shapes or don't actually exercise the SQL.
 * These tests run against the `database` CI job's Postgres/Redis containers (seeded via
 * `pnpm db:seed`) and SKIP — never fail — when no database is reachable, so contributors
 * without Docker aren't blocked. See apps/api/src/test-support/database.ts for the same
 * pattern used by the API's security suite.
 */

let hasDatabase = false;
let db: ReturnType<typeof getDb>;

async function isDatabaseAvailable(): Promise<boolean> {
  try {
    await getDb().execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

// Generates a throwaway external user for a single test, so tests never depend on
// each other's mutations or on colliding with the seeded ROOT/ADMIN records.
async function createTestUser(
  overrides: Partial<{ identityType: 'ROOT' | 'EXTERNAL_USER'; status: 'ACTIVE' | 'SUSPENDED' | 'DISABLED' }> = {}
) {
  const [user] = await db
    .insert(users)
    .values({
      email: `iam-integration-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      name: 'Integration Test User',
      passwordHash: 'not-a-real-hash',
      status: overrides.status ?? 'ACTIVE',
      identityType: overrides.identityType ?? 'EXTERNAL_USER',
    })
    .returning();
  return user;
}

async function createTestPolicy(
  statements: { effect: 'allow' | 'deny'; actions: string[]; resources?: string[] }[]
) {
  const [policy] = await db
    .insert(policies)
    .values({
      name: `iam-integration-policy-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      description: 'Integration test policy',
      isSystem: false,
    })
    .returning();

  for (const stmt of statements) {
    await db.insert(policyStatements).values({
      policyId: policy.id,
      effect: stmt.effect,
      actions: stmt.actions,
      resources: stmt.resources ?? ['*'],
    });
  }

  return policy;
}

describe('IamService (integration)', () => {
  let service: IamService;

  beforeAll(async () => {
    hasDatabase = await isDatabaseAvailable();
    if (!hasDatabase) return;
    db = getDb();
    service = new IamService(db);
  });

  describe('assertCanGrantPolicy', () => {
    it('blocks an actor holding only policies:update from attaching an allow * policy', async (ctx) => {
      if (!hasDatabase) return ctx.skip();

      const limitedPolicy = await createTestPolicy([
        { effect: 'allow', actions: ['policies:update'], resources: ['*'] },
      ]);
      const actor = await createTestUser();
      await service.attachPolicyToUser(actor.id, limitedPolicy.id, 'system');

      const wildcardPolicy = await createTestPolicy([
        { effect: 'allow', actions: ['*'], resources: ['*'] },
      ]);

      await expect(service.assertCanGrantPolicy(wildcardPolicy.id, actor.id)).rejects.toBeInstanceOf(
        PrivilegeEscalationError
      );
    });

    it('allows an actor to grant a policy whose actions they already hold', async (ctx) => {
      if (!hasDatabase) return ctx.skip();

      const grantedPolicy = await createTestPolicy([
        { effect: 'allow', actions: ['users:read'], resources: ['*'] },
      ]);
      const actor = await createTestUser();
      await service.attachPolicyToUser(actor.id, grantedPolicy.id, 'system');

      const toGrant = await createTestPolicy([
        { effect: 'allow', actions: ['users:read'], resources: ['*'] },
      ]);

      await expect(service.assertCanGrantPolicy(toGrant.id, actor.id)).resolves.toBeUndefined();
    });

    it('allows a ROOT actor to grant any policy', async (ctx) => {
      if (!hasDatabase) return ctx.skip();

      const [root] = await db.select().from(users).where(eq(users.identityType, 'ROOT')).limit(1);
      expect(root, 'expected seed to have bootstrapped a ROOT user').toBeTruthy();

      const wildcardPolicy = await createTestPolicy([
        { effect: 'allow', actions: ['*'], resources: ['*'] },
      ]);

      await expect(service.assertCanGrantPolicy(wildcardPolicy.id, root.id)).resolves.toBeUndefined();
    });
  });

  describe('assertNotSystemRecord (via update/delete)', () => {
    it('rejects updating the seeded ADMIN role', async (ctx) => {
      if (!hasDatabase) return ctx.skip();

      const [adminRole] = await db
        .select()
        .from(roles)
        .where(eq(roles.name, AppConfig.iam.adminRoleName))
        .limit(1);
      expect(adminRole, 'expected seed to have created the ADMIN role').toBeTruthy();

      await expect(
        service.updateRole(adminRole.id, { name: 'Hijacked' }, 'system')
      ).rejects.toBeInstanceOf(SystemRecordProtectedError);
    });

    it('rejects deleting the seeded ADMIN role', async (ctx) => {
      if (!hasDatabase) return ctx.skip();

      const [adminRole] = await db
        .select()
        .from(roles)
        .where(eq(roles.name, AppConfig.iam.adminRoleName))
        .limit(1);

      await expect(service.deleteRole(adminRole.id, 'system')).rejects.toBeInstanceOf(
        SystemRecordProtectedError
      );
    });

    it('rejects updating the seeded AdministratorPolicy', async (ctx) => {
      if (!hasDatabase) return ctx.skip();

      const [adminPolicy] = await db
        .select()
        .from(policies)
        .where(eq(policies.name, AppConfig.iam.administratorPolicy))
        .limit(1);
      expect(adminPolicy, 'expected seed to have created AdministratorPolicy').toBeTruthy();

      await expect(
        service.updatePolicy(adminPolicy.id, { name: 'Hijacked' }, 'system')
      ).rejects.toBeInstanceOf(SystemRecordProtectedError);
    });

    it('allows updating a non-system role', async (ctx) => {
      if (!hasDatabase) return ctx.skip();

      const [role] = await db
        .insert(roles)
        .values({ name: `iam-integration-role-${Date.now()}`, description: 'temp', isSystem: false })
        .returning();

      const updated = await service.updateRole(role.id, { name: 'Renamed Role' }, 'system');
      expect(updated?.name).toBe('Renamed Role');
    });
  });

  describe('assertStatusChangeAllowed (via updateUserStatus)', () => {
    it('rejects suspending the ROOT identity', async (ctx) => {
      if (!hasDatabase) return ctx.skip();

      const [root] = await db.select().from(users).where(eq(users.identityType, 'ROOT')).limit(1);

      // Use a distinct actor so the self-suspension guard isn't what fires here.
      const otherActor = await createTestUser();

      await expect(
        service.updateUserStatus(root.id, 'SUSPENDED', otherActor.id)
      ).rejects.toBeInstanceOf(RootProtectedError);
    });

    it('rejects an actor suspending themselves', async (ctx) => {
      if (!hasDatabase) return ctx.skip();

      const actor = await createTestUser();

      await expect(
        service.updateUserStatus(actor.id, 'SUSPENDED', actor.id)
      ).rejects.toBeInstanceOf(RootProtectedError);
    });

    it('allows suspending a non-root, non-self user', async (ctx) => {
      if (!hasDatabase) return ctx.skip();

      const target = await createTestUser();
      const otherActor = await createTestUser();

      const updated = await service.updateUserStatus(target.id, 'SUSPENDED', otherActor.id);
      expect(updated?.status).toBe('SUSPENDED');
    });

    it('allows reactivating (ACTIVE) without restriction, even for self', async (ctx) => {
      if (!hasDatabase) return ctx.skip();

      const actor = await createTestUser({ status: 'SUSPENDED' });

      const updated = await service.updateUserStatus(actor.id, 'ACTIVE', actor.id);
      expect(updated?.status).toBe('ACTIVE');
    });
  });

  describe('getEffectivePermissions', () => {
    it('unions direct, role and group policies', async (ctx) => {
      if (!hasDatabase) return ctx.skip();

      const user = await createTestUser();

      const directPolicy = await createTestPolicy([
        { effect: 'allow', actions: ['users:read'], resources: ['*'] },
      ]);
      await service.attachPolicyToUser(user.id, directPolicy.id, 'system');

      const rolePolicy = await createTestPolicy([
        { effect: 'allow', actions: ['roles:read'], resources: ['*'] },
      ]);
      const [role] = await db
        .insert(roles)
        .values({ name: `iam-integration-role-${Date.now()}`, description: 'temp', isSystem: false })
        .returning();
      await service.attachPolicyToRole(role.id, rolePolicy.id, 'system');
      await service.assignRoleToUser(user.id, role.id, 'system');

      const groupPolicy = await createTestPolicy([
        { effect: 'allow', actions: ['groups:read'], resources: ['*'] },
      ]);
      const [group] = await db
        .insert(groups)
        .values({ name: `iam-integration-group-${Date.now()}`, description: 'temp', isSystem: false })
        .returning();
      await service.attachPolicyToGroup(group.id, groupPolicy.id, 'system');
      await service.addUserToGroup(user.id, group.id, 'system');

      const result = await service.getEffectivePermissions(user.id);

      expect(result.effectivePermissions).toContain('users:read');
      expect(result.effectivePermissions).toContain('roles:read');
      expect(result.effectivePermissions).toContain('groups:read');
      expect(result.allPolicies.map((p) => p.id).sort()).toEqual(
        [directPolicy.id, rolePolicy.id, groupPolicy.id].sort()
      );
    });

    it('denies take precedence over allow for the same action', async (ctx) => {
      if (!hasDatabase) return ctx.skip();

      const user = await createTestUser();

      const allowPolicy = await createTestPolicy([
        { effect: 'allow', actions: ['users:delete'], resources: ['*'] },
      ]);
      await service.attachPolicyToUser(user.id, allowPolicy.id, 'system');

      const denyPolicy = await createTestPolicy([
        { effect: 'deny', actions: ['users:delete'], resources: ['*'] },
      ]);
      await service.attachPolicyToUser(user.id, denyPolicy.id, 'system');

      const result = await service.getEffectivePermissions(user.id);

      expect(result.effectivePermissions).not.toContain('users:delete');
    });
  });
});
