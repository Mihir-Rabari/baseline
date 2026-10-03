import { describe, it, expect } from 'vitest';
import { hashSessionToken, generateSessionToken, SessionManager } from './session-manager.js';
import type { DatabaseInstance } from '@packages/db';
import type { IRedisService } from '@packages/shared';

describe('SessionManager cache hits', () => {
  const iso = '2030-01-01T00:00:00.000Z';
  const cachedEntry = (status: string) => ({
    session: {
      id: 's1', userId: 'u1', tokenHash: 'h', userAgent: null, ipAddress: null,
      expiresAt: iso, revokedAt: null, createdAt: iso, updatedAt: iso,
    },
    user: {
      id: 'u1', email: 'a@b.c', name: 'A', status, identityType: 'EXTERNAL_USER',
      lastLoginAt: null, createdAt: iso, updatedAt: iso,
    },
  });
  const manager = (entry: unknown) =>
    new SessionManager({} as DatabaseInstance, {
      getJson: async () => entry,
      delete: async () => undefined,
    } as unknown as IRedisService);

  it('rehydrates JSON date strings into Date objects (regression: /auth/session 500 on cache hit)', async () => {
    const result = await manager(cachedEntry('ACTIVE')).validateSession('tok');

    expect(result.valid).toBe(true);
    expect(result.user?.createdAt).toBeInstanceOf(Date);
    expect(result.user?.createdAt.toISOString()).toBe(iso);
    expect(result.session?.expiresAt).toBeInstanceOf(Date);
    expect(result.user?.lastLoginAt).toBeNull();
  });

  it('still rejects a cached SUSPENDED entry', async () => {
    const result = await manager(cachedEntry('SUSPENDED')).validateSession('tok');
    expect(result.valid).toBe(false);
    expect(result.code).toBe('ACCOUNT_SUSPENDED');
  });
});

describe('Session Manager Primitives', () => {
  it('should generate secure 64-char hexadecimal session tokens', () => {
    const token1 = generateSessionToken();
    const token2 = generateSessionToken();

    expect(token1).toHaveLength(64);
    expect(token2).toHaveLength(64);
    expect(token1).not.toEqual(token2);
  });

  it('should deterministically produce SHA-256 token hashes', () => {
    const token = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    const hash1 = hashSessionToken(token);
    const hash2 = hashSessionToken(token);

    expect(hash1).toEqual(hash2);
    expect(hash1).toHaveLength(64);
  });
});
