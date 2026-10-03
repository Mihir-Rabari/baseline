import { and, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { notifications, roles, userRoles, users, type NotificationType } from '@packages/db';
import type { DbExecutor } from './db-types.js';

export interface NotificationPayload {
  type: NotificationType;
  title: string;
  body?: string | null;
  link?: string | null;
  data?: Record<string, unknown>;
}

export type NotificationRow = typeof notifications.$inferSelect;

/** dedupe_key is varchar(128); a 36 char user id and a ':' are appended per recipient. */
const MAX_DEDUPE_KEY_LENGTH = 128 - 37;

export class NotificationService {
  constructor(private readonly db: DbExecutor) {}

  withExecutor(executor: DbExecutor): NotificationService {
    return new NotificationService(executor);
  }

  /**
   * Fans a notification out to every ACTIVE user holding any of `roleNames`, one row each.
   *
   * The `dedupe_key` column is globally unique, so the stored key is `<dedupeKey>:<userId>`.
   * Calling this twice with the same key therefore creates exactly one row per user
   * (`ON CONFLICT DO NOTHING`). Returns the rows actually created.
   */
  async notifyRole(
    roleNames: string[],
    payload: NotificationPayload,
    dedupeKey?: string
  ): Promise<NotificationRow[]> {
    if (roleNames.length === 0) return [];
    const recipients = await this.db
      .selectDistinct({ id: users.id })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(inArray(roles.name, roleNames), eq(users.status, 'ACTIVE')));
    return this.notifyUsers(
      recipients.map((r) => r.id),
      payload,
      dedupeKey
    );
  }

  async notifyUsers(
    userIds: string[],
    payload: NotificationPayload,
    dedupeKey?: string
  ): Promise<NotificationRow[]> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return [];
    if (dedupeKey !== undefined && dedupeKey.length > MAX_DEDUPE_KEY_LENGTH) {
      throw new RangeError(`dedupeKey must be at most ${MAX_DEDUPE_KEY_LENGTH} characters`);
    }
    return this.db
      .insert(notifications)
      .values(
        unique.map((userId) => ({
          userId,
          type: payload.type,
          title: payload.title,
          body: payload.body ?? null,
          link: payload.link ?? null,
          data: payload.data ?? null,
          dedupeKey: dedupeKey ? `${dedupeKey}:${userId}` : null,
        }))
      )
      .onConflictDoNothing({ target: notifications.dedupeKey })
      .returning();
  }

  async list(
    userId: string,
    opts: { unreadOnly: boolean; page: number; limit: number; order: 'asc' | 'desc' }
  ): Promise<{ rows: NotificationRow[]; total: number }> {
    const where = and(
      eq(notifications.userId, userId),
      opts.unreadOnly ? isNull(notifications.readAt) : undefined
    );
    const [rows, [totalRow]] = await Promise.all([
      this.db
        .select()
        .from(notifications)
        .where(where)
        .orderBy(
          opts.order === 'asc' ? sql`${notifications.createdAt} asc` : desc(notifications.createdAt),
          desc(notifications.id)
        )
        .limit(opts.limit)
        .offset((opts.page - 1) * opts.limit),
      this.db.select({ n: count() }).from(notifications).where(where),
    ]);
    return { rows, total: Number(totalRow?.n ?? 0) };
  }

  async unreadCount(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return Number(row?.n ?? 0);
  }

  /**
   * Marks one notification read. Scoped by owner in the WHERE clause, so another user's
   * notification is indistinguishable from a missing one (returns null -> 404).
   */
  async markRead(userId: string, id: string): Promise<NotificationRow | null> {
    const [updated] = await this.db
      .update(notifications)
      .set({ readAt: sql`coalesce(${notifications.readAt}, now())` })
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
      .returning();
    return updated ?? null;
  }

  async markAllRead(userId: string): Promise<number> {
    const updated = await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
      .returning({ id: notifications.id });
    return updated.length;
  }
}
