import crypto from 'node:crypto';
import { eq, and, isNull, gt } from 'drizzle-orm';
import type { DatabaseInstance } from '@packages/db';
import { sessions, users } from '@packages/db';
import type { IRedisService } from '@packages/shared';
import type { AuthUser, AuthSession, SessionValidationResult, UserStatus, IdentityType } from '../types.js';
import {
  InvalidCredentialsError,
  AccountSuspendedError,
  AccountDisabledError,
} from '../errors.js';

export interface SessionManagerConfig {
  sessionTtlSeconds?: number;
}

export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export class SessionManager {
  private ttlSeconds: number;

  constructor(
    private db: DatabaseInstance,
    private redis?: IRedisService,
    config?: SessionManagerConfig
  ) {
    this.ttlSeconds = config?.sessionTtlSeconds ?? 7 * 24 * 60 * 60; // 7 days default
  }

  /**
   * Creates a new server-side session for an authenticated user.
   * Returns the raw sessionToken to be sent via secure HTTP-only cookie.
   */
  public async createSession(params: {
    userId: string;
    userAgent?: string;
    ipAddress?: string;
    ttlSeconds?: number;
  }): Promise<{ sessionToken: string; session: AuthSession; user: AuthUser }> {
    const rawToken = generateSessionToken();
    const tokenHash = hashSessionToken(rawToken);
    const ttl = params.ttlSeconds ?? this.ttlSeconds;
    const expiresAt = new Date(Date.now() + ttl * 1000);

    // 1. Fetch user to verify active status
    const [userRecord] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, params.userId))
      .limit(1);

    if (!userRecord) {
      throw new InvalidCredentialsError('User not found');
    }

    if (userRecord.status === 'SUSPENDED') {
      throw new AccountSuspendedError();
    }
    if (userRecord.status === 'DISABLED') {
      throw new AccountDisabledError();
    }

    // 2. Insert session into database
    const [sessionRecord] = await this.db
      .insert(sessions)
      .values({
        userId: params.userId,
        tokenHash,
        userAgent: params.userAgent || null,
        ipAddress: params.ipAddress || null,
        expiresAt,
      })
      .returning();

    // 3. Update user last login timestamp
    await this.db
      .update(users)
      .set({ lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, params.userId));

    const authUser: AuthUser = {
      id: userRecord.id,
      email: userRecord.email,
      name: userRecord.name,
      status: userRecord.status as UserStatus,
      identityType: userRecord.identityType as IdentityType,
      lastLoginAt: userRecord.lastLoginAt,
      createdAt: userRecord.createdAt,
      updatedAt: userRecord.updatedAt,
    };

    const authSession: AuthSession = {
      id: sessionRecord.id,
      userId: sessionRecord.userId,
      tokenHash: sessionRecord.tokenHash,
      userAgent: sessionRecord.userAgent,
      ipAddress: sessionRecord.ipAddress,
      expiresAt: sessionRecord.expiresAt,
      revokedAt: sessionRecord.revokedAt,
      createdAt: sessionRecord.createdAt,
      updatedAt: sessionRecord.updatedAt,
    };

    // 4. Cache session in Redis if available
    if (this.redis) {
      const cacheKey = `session:${tokenHash}`;
      await this.redis.setJson(
        cacheKey,
        { session: authSession, user: authUser },
        ttl
      );
    }

    return {
      sessionToken: rawToken,
      session: authSession,
      user: authUser,
    };
  }

  /**
   * Validates a session token, returning the user and session or error reason.
   */
  public async validateSession(token: string): Promise<SessionValidationResult> {
    if (!token || typeof token !== 'string') {
      return { valid: false, error: 'Missing session token', code: 'UNAUTHORIZED' };
    }

    const tokenHash = hashSessionToken(token);
    const cacheKey = `session:${tokenHash}`;

    // 1. Try Redis cache first
    if (this.redis) {
      try {
        const cached = await this.redis.getJson<{ session: AuthSession; user: AuthUser }>(cacheKey);
        if (cached && cached.session && cached.user) {
          const now = new Date();
          const expiresAt = new Date(cached.session.expiresAt);

          if (now > expiresAt) {
            await this.redis.delete(cacheKey);
            return { valid: false, error: 'Session expired', code: 'SESSION_EXPIRED' };
          }

          if (cached.user.status === 'SUSPENDED') {
            return { valid: false, error: 'Account suspended', code: 'ACCOUNT_SUSPENDED' };
          }
          if (cached.user.status === 'DISABLED') {
            return { valid: false, error: 'Account disabled', code: 'ACCOUNT_DISABLED' };
          }

          return {
            valid: true,
            user: cached.user,
            session: cached.session,
          };
        }
      } catch {
        // Fallback to database on cache error
      }
    }

    // 2. Query PostgreSQL Database
    const now = new Date();
    const records = await this.db
      .select({
        session: sessions,
        user: users,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, now)
        )
      )
      .limit(1);

    if (records.length === 0) {
      return { valid: false, error: 'Invalid or expired session', code: 'INVALID_SESSION' };
    }

    const { session: s, user: u } = records[0];

    if (u.status === 'SUSPENDED') {
      return { valid: false, error: 'Account suspended', code: 'ACCOUNT_SUSPENDED' };
    }
    if (u.status === 'DISABLED') {
      return { valid: false, error: 'Account disabled', code: 'ACCOUNT_DISABLED' };
    }

    const authUser: AuthUser = {
      id: u.id,
      email: u.email,
      name: u.name,
      status: u.status as UserStatus,
      identityType: u.identityType as IdentityType,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    };

    const authSession: AuthSession = {
      id: s.id,
      userId: s.userId,
      tokenHash: s.tokenHash,
      userAgent: s.userAgent,
      ipAddress: s.ipAddress,
      expiresAt: s.expiresAt,
      revokedAt: s.revokedAt,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };

    // Re-populate Redis cache
    if (this.redis) {
      const remainingSeconds = Math.max(
        1,
        Math.floor((authSession.expiresAt.getTime() - Date.now()) / 1000)
      );
      await this.redis.setJson(
        cacheKey,
        { session: authSession, user: authUser },
        remainingSeconds
      );
    }

    return {
      valid: true,
      user: authUser,
      session: authSession,
    };
  }

  /**
   * Revokes an active session (e.g. on logout).
   */
  public async revokeSession(token: string): Promise<boolean> {
    if (!token) return false;

    const tokenHash = hashSessionToken(token);
    const cacheKey = `session:${tokenHash}`;

    // 1. Remove from Redis
    if (this.redis) {
      await this.redis.delete(cacheKey);
    }

    // 2. Mark revoked in Database
    const result = await this.db
      .update(sessions)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)))
      .returning();

    return result.length > 0;
  }

  /**
   * Revokes all active sessions for a user (e.g. on password reset or account suspension).
   */
  public async revokeAllUserSessions(userId: string): Promise<void> {
    // 1. Find all active sessions to delete from cache
    const activeSessions = await this.db
      .select({ tokenHash: sessions.tokenHash })
      .from(sessions)
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));

    if (this.redis && activeSessions.length > 0) {
      await Promise.allSettled(
        activeSessions.map((s) => this.redis!.delete(`session:${s.tokenHash}`))
      );
    }

    // 2. Mark all revoked in Database
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  }
}
