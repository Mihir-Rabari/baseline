import { getDb, closeDatabase } from './client.js';
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
import { AppConfig } from '@packages/config';
import { getEnv } from '@packages/config/env';
// Shared with the login path rather than reimplemented here. A local copy of the scrypt
// parameters would drift the moment they are tuned, and the seeded ROOT account would
// silently stop being able to authenticate.
import { hashPassword } from '@packages/shared/crypto';

const BASELINE_PERMISSIONS = [
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
];

export async function runSeeds(): Promise<void> {
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
          target: systemSettings.key,
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
        actions: ['admin:access', 'users:*', 'roles:*', 'groups:*', 'policies:*', 'permissions:*'],
        resources: ['*'],
      });
      console.log('[DB] ✅ Created baseline AdministratorPolicy.');
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
        ],
        resources: ['*'],
      });
      console.log('[DB] ✅ Created baseline ExternalUserPolicy.');
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
