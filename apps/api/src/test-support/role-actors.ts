import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { DEFAULT_TENANT_ID, getDb, roles, userRoles } from '@packages/db';

export type RoleName = 'OWNER' | 'FRONT_DESK' | 'BAR_STAFF' | 'MEMBER';
export interface Actor {
  id: string;
  cookie: string;
}

let ipCounter = 0;
/** A distinct client address per call, so route rate limits never couple unrelated tests. */
export const nextIp = () => `10.${40 + ((ipCounter >> 16) & 15)}.${(ipCounter >> 8) & 255}.${ipCounter++ & 255}`;

/** Signs up a fresh user and gives it exactly one role. Remember to delete `actor.id` afterwards. */
export async function makeActor(app: FastifyInstance, roleName: RoleName, tag: string): Promise<Actor> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    remoteAddress: nextIp(),
    payload: { email: `${tag}-${randomUUID()}@example.com`, password: 'Password123!', name: `${tag} ${roleName}` },
  });
  if (res.statusCode !== 201) throw new Error(`signup failed: ${res.statusCode} ${res.body}`);
  const id = res.json().user.id as string;
  const db = getDb();
  const [role] = await db.select().from(roles).where(and(eq(roles.tenantId, DEFAULT_TENANT_ID), eq(roles.name, roleName))).limit(1);
  await db.delete(userRoles).where(eq(userRoles.userId, id));
  await db.insert(userRoles).values({ userId: id, roleId: role.id });
  return { id, cookie: `app_session=${res.cookies.find((c) => c.name === 'app_session')!.value}` };
}

/** Whether the four CourtOS roles exist in this database (they come from the seed). */
export async function rolesSeeded(): Promise<boolean> {
  const rows = await getDb().select({ name: roles.name }).from(roles);
  const names = new Set(rows.map((row) => row.name));
  return (['OWNER', 'FRONT_DESK', 'BAR_STAFF', 'MEMBER'] as const).every((name) => names.has(name));
}
