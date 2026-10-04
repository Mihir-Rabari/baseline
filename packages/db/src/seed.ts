import { getDb, closeDatabase, type DatabaseInstance } from './client.js';
import {
  systemSettings,
  systemAuditLogs,
  users,
  roles,
  policies,
  policyStatements,
  rolePolicies,
  permissions,
} from './schema/index.js';
import { eq, sql } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import { seedCourtOs } from './seed-courtos.js';
import { runInTenant } from './tenant-scope.js';
import { DEFAULT_TENANT_ID } from './schema/tenants.js';
import { AppConfig, IamConfig, type PolicyDefinition, type RoleDefinition } from '@packages/config';
import { getEnv } from '@packages/config/env';
// Shared with the login path rather than reimplemented here. A local copy of the scrypt
// parameters would drift the moment they are tuned, and the seeded ROOT account would
// silently stop being able to authenticate.
import { hashPassword } from '@packages/shared/crypto';

export const BASELINE_PERMISSIONS = [
  // Users
  { id: 'users:read', namespace: 'users', action: 'read', description: 'View user accounts and profiles', isSystem: true },
  { id: 'users:create', namespace: 'users', action: 'create', description: 'Create new user accounts', isSystem: true },
  { id: 'users:update', namespace: 'users', action: 'update', description: 'Modify user accounts and status', isSystem: true },
  { id: 'users:delete', namespace: 'users', action: 'delete', description: 'Permanently delete user accounts', isSystem: true },

  // Roles
  { id: 'roles:read', namespace: 'roles', action: 'read', description: 'View IAM roles', isSystem: true },
  { id: 'roles:create', namespace: 'roles', action: 'create', description: 'Create new IAM roles', isSystem: true },
  { id: 'roles:update', namespace: 'roles', action: 'update', description: 'Modify IAM roles and attach policies', isSystem: true },
  { id: 'roles:delete', namespace: 'roles', action: 'delete', description: 'Delete IAM roles', isSystem: true },

  // Groups
  { id: 'groups:read', namespace: 'groups', action: 'read', description: 'View IAM groups', isSystem: true },
  { id: 'groups:create', namespace: 'groups', action: 'create', description: 'Create new IAM groups', isSystem: true },
  { id: 'groups:update', namespace: 'groups', action: 'update', description: 'Modify IAM groups and manage members', isSystem: true },
  { id: 'groups:delete', namespace: 'groups', action: 'delete', description: 'Delete IAM groups', isSystem: true },

  // Policies
  { id: 'policies:read', namespace: 'policies', action: 'read', description: 'View IAM policies and statements', isSystem: true },
  { id: 'policies:create', namespace: 'policies', action: 'create', description: 'Create new IAM policies', isSystem: true },
  { id: 'policies:update', namespace: 'policies', action: 'update', description: 'Modify IAM policies', isSystem: true },
  { id: 'policies:delete', namespace: 'policies', action: 'delete', description: 'Delete IAM policies', isSystem: true },

  // Permissions
  { id: 'permissions:read', namespace: 'permissions', action: 'read', description: 'Browse registered permissions catalog', isSystem: true },

  // Admin access
  { id: 'admin:access', namespace: 'admin', action: 'access', description: 'Access administrative dashboard & management interface', isSystem: true },

  // Self-Resource Permissions
  { id: 'profile:read:self', namespace: 'profile', action: 'read:self', description: 'Read own profile information', isSystem: true },
  { id: 'profile:update:self', namespace: 'profile', action: 'update:self', description: 'Update own profile information', isSystem: true },
  { id: 'notifications:read:self', namespace: 'notifications', action: 'read:self', description: 'View own notifications', isSystem: true },
  { id: 'notifications:update:self', namespace: 'notifications', action: 'update:self', description: 'Manage own notifications', isSystem: true },

  // AI agent (mirror of the baseline list in packages/iam/src/catalog/permission-catalog.ts)
  { id: 'agent:use', namespace: 'agent', action: 'use', description: 'Chat with the AI agent', isSystem: true },
  { id: 'agent:act', namespace: 'agent', action: 'act', description: 'Let the AI agent stage and execute write actions on your behalf', isSystem: true },

  // CourtOS domain permissions.
  // MIRROR of COURTOS_PERMISSION_NAMESPACES in packages/iam/src/catalog/permission-catalog.ts
  // (a parity test in packages/iam fails if they drift).
  ...(
    [
      ['members', ['read', 'create', 'update']],
      ['plans', ['read', 'update']],
      ['memberships', ['create', 'update']],
      ['courts', ['read', 'update']],
      ['bookings', ['read', 'create', 'cancel', 'override', 'read:self', 'create:self', 'cancel:self']],
      ['products', ['read', 'create', 'update']],
      ['inventory', ['read', 'adjust']],
      ['orders', ['read', 'create', 'update', 'read:self', 'create:self', 'cancel:self']],
      ['bar', ['read', 'manage', 'kitchen', 'settle']],
      ['shifts', ['read', 'read:all', 'manage', 'clock:self']],
      ['crm', ['read', 'manage']],
      ['invoices', ['read', 'create', 'update', 'read:self']],
      ['payments', ['read', 'create']],
      ['hr', ['read', 'manage']],
      ['leave', ['read', 'decide', 'read:self', 'create:self']],
      ['reports', ['read', 'share']],
    ] as Array<[string, string[]]>
  ).flatMap(([namespace, actions]) =>
    actions.map((action) => ({
      id: `${namespace}:${action}`,
      namespace,
      action,
      description: `Permission to ${action} ${namespace}`,
      isSystem: false,
    }))
  ),
];

/**
 * Domain (CourtOS) policies and roles declared in `IamConfig`.
 *
 * Idempotent: the config is the source of truth, so statements of each declared policy
 * are replaced inside one transaction (a re-run yields identical row counts), and role
 * to policy links use `onConflictDoNothing`. ADMIN, AdministratorPolicy and
 * ExternalUserPolicy are handled by `runSeeds` above and skipped here.
 */
export async function seedDomainIam(db: DatabaseInstance): Promise<void> {
  const handledPolicies = new Set<string>([AppConfig.iam.administratorPolicy, AppConfig.iam.defaultExternalUserPolicy]);
  const handledRoles = new Set<string>([AppConfig.iam.adminRoleName, 'USER']);

  await db.transaction(async (tx) => {
    const policyIds = new Map<string, string>();

    for (const [name, def] of Object.entries(IamConfig.policies as Record<string, PolicyDefinition>)) {
      if (handledPolicies.has(name)) continue;

      let [policy] = await tx.select().from(policies).where(eq(policies.name, name)).limit(1);
      if (!policy) {
        [policy] = await tx
          .insert(policies)
          .values({ name, description: def.description, isSystem: def.isSystem ?? true })
          .returning();
      } else {
        await tx.update(policies).set({ description: def.description }).where(eq(policies.id, policy.id));
        await tx.delete(policyStatements).where(eq(policyStatements.policyId, policy.id));
      }

      for (const statement of def.statements) {
        await tx.insert(policyStatements).values({
          policyId: policy.id,
          effect: statement.effect,
          actions: statement.actions,
          resources: statement.resources ?? ['*'],
          conditions: statement.conditions ?? null,
        });
      }
      policyIds.set(name, policy.id);
    }

    for (const [name, def] of Object.entries(IamConfig.roles as Record<string, RoleDefinition>)) {
      if (handledRoles.has(name)) continue;

      let [role] = await tx.select().from(roles).where(eq(roles.name, name)).limit(1);
      if (!role) {
        [role] = await tx
          .insert(roles)
          .values({ name, description: def.description, isSystem: def.isSystem ?? true })
          .returning();
      }

      for (const policyName of def.policies) {
        let policyId = policyIds.get(policyName);
        if (!policyId) {
          const [existing] = await tx.select().from(policies).where(eq(policies.name, policyName)).limit(1);
          policyId = existing?.id;
        }
        if (!policyId) {
          throw new Error(`[DB] Role ${name} references unknown policy ${policyName}`);
        }
        await tx.insert(rolePolicies).values({ roleId: role.id, policyId }).onConflictDoNothing();
      }
    }
  });
  console.log('[DB] ✅ Synced CourtOS domain policies and roles.');
}

const AGENT_ACTIONS = ['agent:use', 'agent:act'];

/**
 * Upgrade path for databases seeded before the AI agent existed: the baseline policies are
 * only created when missing, so append the agent actions once (idempotent: a re-run finds them).
 */
async function ensureAgentActions(db: DatabaseInstance, policyId: string): Promise<void> {
  const existing = await db.select().from(policyStatements).where(eq(policyStatements.policyId, policyId));
  const granted = new Set(existing.filter((s) => s.effect === 'allow').flatMap((s) => s.actions as string[]));
  if (AGENT_ACTIONS.every((a) => granted.has(a))) return;
  await db.insert(policyStatements).values({
    policyId,
    effect: 'allow',
    actions: AGENT_ACTIONS.filter((a) => !granted.has(a)),
    resources: ['*'],
  });
}

/**
 * The IAM baseline every club starts with: AdministratorPolicy, ExternalUserPolicy, the ADMIN role and
 * the domain policies and roles (MEMBER, FRONT_DESK, BAR_STAFF, OWNER). Idempotent, and it writes into
 * whichever club the database handle is scoped to (the default club for seeds, a new club when the
 * platform operator creates one).
 */
export async function seedTenantIam(db: DatabaseInstance): Promise<void> {
  // 3. Baseline Policies Seed
  // 3a. AdministratorPolicy
  const adminPolicyName = AppConfig.iam.administratorPolicy;
  let [adminPolicy] = await db
    .select()
    .from(policies)
    .where(eq(policies.name, adminPolicyName))
    .limit(1);

  if (!adminPolicy) {
    [adminPolicy] = await db
      .insert(policies)
      .values({
        name: adminPolicyName,
        description: 'Full administrative access to manage users, roles, groups, and policies',
        isSystem: true,
      })
      .returning();

    await db.insert(policyStatements).values({
      policyId: adminPolicy.id,
      effect: 'allow',
      actions: ['admin:access', 'users:*', 'roles:*', 'groups:*', 'policies:*', 'permissions:*', 'agent:use', 'agent:act'],
      resources: ['*'],
    });
    console.log('[DB] ✅ Created baseline AdministratorPolicy.');
  } else {
    await ensureAgentActions(db, adminPolicy.id);
  }

  // 3b. ExternalUserPolicy
  const externalPolicyName = AppConfig.iam.defaultExternalUserPolicy;
  let [externalPolicy] = await db
    .select()
    .from(policies)
    .where(eq(policies.name, externalPolicyName))
    .limit(1);

  if (!externalPolicy) {
    [externalPolicy] = await db
      .insert(policies)
      .values({
        name: externalPolicyName,
        description: 'Default baseline policy granting external users self-resource permissions',
        isSystem: true,
      })
      .returning();

    await db.insert(policyStatements).values({
      policyId: externalPolicy.id,
      effect: 'allow',
      actions: [
        'profile:read:self',
        'profile:update:self',
        'notifications:read:self',
        'notifications:update:self',
        'agent:use',
        'agent:act',
      ],
      resources: ['*'],
    });
    console.log('[DB] ✅ Created baseline ExternalUserPolicy.');
  } else {
    await ensureAgentActions(db, externalPolicy.id);
  }

  // 4. Baseline Roles Seed (ADMIN)
  const adminRoleName = AppConfig.iam.adminRoleName;
  let [adminRole] = await db
    .select()
    .from(roles)
    .where(eq(roles.name, adminRoleName))
    .limit(1);

  if (!adminRole) {
    [adminRole] = await db
      .insert(roles)
      .values({
        name: adminRoleName,
        description: 'System Administrator role with AdministratorPolicy attached',
        isSystem: true,
      })
      .returning();

    if (adminPolicy) {
      await db.insert(rolePolicies).values({
        roleId: adminRole.id,
        policyId: adminPolicy.id,
      }).onConflictDoNothing();
    }
    console.log('[DB] ✅ Created baseline ADMIN role with AdministratorPolicy attached.');
  }

  // 4b. Domain policies and roles from IamConfig (MEMBER, FRONT_DESK, BAR_STAFF, OWNER)
  await seedDomainIam(db);
}

/** Seeds the default club. Scoped to it, so the run stays idempotent however many other clubs exist. */
export function runSeeds(): Promise<void> {
  return runInTenant(DEFAULT_TENANT_ID, runSeedsInScope);
}

async function runSeedsInScope(): Promise<void> {
  console.log('[DB] Seeding foundational system records & IAM bootstrap...');
  const db = getDb();
  const env = getEnv();

  try {
    // 1. Foundational System Settings
    const foundationalSettings = [
      {
        key: 'system_initialized',
        value: { initialized: true, timestamp: new Date().toISOString(), phase: 'phase_2' },
        description: 'Phase 2 foundation and IAM initialization marker',
      },
      {
        key: 'application_metadata',
        value: {
          name: AppConfig.name,
          version: AppConfig.version,
          environment: env.NODE_ENV,
        },
        description: 'Global application metadata and runtime configuration',
      },
      {
        key: 'storage_buckets',
        value: { defaultBucket: env.S3_BUCKET, configured: true },
        description: 'Default S3 / MinIO storage configuration state',
      },
    ];

    for (const setting of foundationalSettings) {
      await db
        .insert(systemSettings)
        .values(setting)
        .onConflictDoUpdate({
          target: [systemSettings.tenantId, systemSettings.key],
          set: {
            value: setting.value,
            description: setting.description,
            updatedAt: sql`NOW()`,
          },
        });
    }

    // 2. Baseline Permissions Registry Seed
    for (const p of BASELINE_PERMISSIONS) {
      await db
        .insert(permissions)
        .values({
          id: p.id,
          namespace: p.namespace,
          action: p.action,
          description: p.description,
          isSystem: p.isSystem ?? true,
        })
        .onConflictDoNothing();
    }
    console.log(`[DB] ✅ Registered ${BASELINE_PERMISSIONS.length} baseline permissions.`);

    // 3-4b. Baseline policies and roles (AdministratorPolicy, ExternalUserPolicy, ADMIN, domain roles)
    await seedTenantIam(db);

    // 4c. CourtOS demo data (plans, courts, products, menu, members, demo users)
    await seedCourtOs(db, { demoPassword: env.SEED_DEMO_PASSWORD });

    // 5. ROOT Account Bootstrap (Idempotent)
    const [existingRoot] = await db
      .select()
      .from(users)
      .where(eq(users.identityType, 'ROOT'))
      .limit(1);

    if (!existingRoot) {
      const rootEmail = env.INITIAL_ROOT_EMAIL.toLowerCase().trim();
      const rootPassword = env.INITIAL_ROOT_PASSWORD;
      const rootPasswordHash = await hashPassword(rootPassword);

      const [newRoot] = await db
        .insert(users)
        .values({
          email: rootEmail,
          name: 'Root Administrator',
          passwordHash: rootPasswordHash,
          status: 'ACTIVE',
          identityType: 'ROOT',
        })
        .returning();

      console.log(`[DB] 👑 Bootstrapped ROOT Account: ${newRoot.email}`);

      // Record audit event for root bootstrap
      await db.insert(systemAuditLogs).values({
        action: 'ROOT_BOOTSTRAP',
        actor: 'seed_runner',
        details: {
          rootUserId: newRoot.id,
          email: newRoot.email,
          timestamp: new Date().toISOString(),
        },
        status: 'success',
      });
    } else {
      console.log(`[DB] ℹ️ Root account already exists (${existingRoot.email}). Preserving credentials.`);
    }

    // Audit log for seed execution
    await db.insert(systemAuditLogs).values({
      action: 'SYSTEM_SEED_PHASE_2',
      actor: 'seed_runner',
      details: {
        timestamp: new Date().toISOString(),
        rootExists: true,
        permissionsCount: BASELINE_PERMISSIONS.length,
      },
      status: 'success',
    });

    console.log('[DB] ✅ Phase 2 seed executed successfully.');
  } catch (error) {
    console.error('[DB] ❌ Database seed failed:', error);
    throw error;
  } finally {
    await closeDatabase();
  }
}

// Allow direct execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runSeeds()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
