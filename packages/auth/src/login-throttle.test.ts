import { describe, it, expect, beforeEach } from 'vitest';
import { LoginThrottle } from './login-throttle.js';
import type { IRedisService } from '@packages/shared';

/**
 * Minimal in-memory stand-in for the Redis service.
 *
 * Only the four methods LoginThrottle actually calls are implemented; the rest throw so
 * that a future change reaching for an unmocked method fails loudly instead of silently
 * returning undefined.
 */
function createFakeRedis(): IRedisService & { store: Map<string, string> } {
  const store = new Map<string, string>();

  return {
    store,
    async get(key) {
      return store.get(key) ?? null;
    },
    async set(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      return store.delete(key);
    },
    async exists(key) {
      return store.has(key);
    },
    connect: async () => {
      throw new Error('not implemented in fake');
    },
    getJson: async () => {
      throw new Error('not implemented in fake');
    },
    setJson: async () => {
      throw new Error('not implemented in fake');
    },
    healthCheck: async () => {
      throw new Error('not implemented in fake');
    },
    disconnect: async () => {
      throw new Error('not implemented in fake');
    },
    getClient: () => {
      throw new Error('not implemented in fake');
    },
  } as unknown as IRedisService & { store: Map<string, string> };
}

const CONFIG = { maxAttempts: 3, lockoutSeconds: 900, windowSeconds: 900 };

describe('LoginThrottle', () => {
  let redis: ReturnType<typeof createFakeRedis>;
  let throttle: LoginThrottle;

  beforeEach(() => {
    redis = createFakeRedis();
    throttle = new LoginThrottle(redis, CONFIG);
  });

  it('is unlocked before any failures', async () => {
    expect(await throttle.check('user@example.com')).toEqual({
      locked: false,
      retryAfterSeconds: 0,
    });
  });

  it('stays unlocked below the attempt threshold', async () => {
    await throttle.recordFailure('user@example.com');
    await throttle.recordFailure('user@example.com');

    expect((await throttle.check('user@example.com')).locked).toBe(false);
  });

  it('locks out on the configured attempt', async () => {
    await throttle.recordFailure('user@example.com');
    await throttle.recordFailure('user@example.com');
    const third = await throttle.recordFailure('user@example.com');

    expect(third.locked).toBe(true);
    expect(third.retryAfterSeconds).toBe(CONFIG.lockoutSeconds);

    const state = await throttle.check('user@example.com');
    expect(state.locked).toBe(true);
    expect(state.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('treats the identifier case-insensitively', async () => {
    await throttle.recordFailure('User@Example.com');
    await throttle.recordFailure('user@example.com');
    await throttle.recordFailure('USER@EXAMPLE.COM');

    expect((await throttle.check('user@example.com')).locked).toBe(true);
  });

  it('counts each identifier separately', async () => {
    await throttle.recordFailure('a@example.com');
    await throttle.recordFailure('a@example.com');
    await throttle.recordFailure('a@example.com');

    expect((await throttle.check('a@example.com')).locked).toBe(true);
    expect((await throttle.check('b@example.com')).locked).toBe(false);
  });

  it('clears the counter after a successful login', async () => {
    await throttle.recordFailure('user@example.com');
    await throttle.recordFailure('user@example.com');
    await throttle.recordSuccess('user@example.com');

    // The two earlier failures must not carry over, so a third failure alone should
    // not trip a threshold of three.
    const next = await throttle.recordFailure('user@example.com');
    expect(next.locked).toBe(false);
  });

  it('lifts the lockout once the deadline passes', async () => {
    await throttle.recordFailure('user@example.com');
    await throttle.recordFailure('user@example.com');
    await throttle.recordFailure('user@example.com');
    expect((await throttle.check('user@example.com')).locked).toBe(true);

    // Rewind the stored deadline into the past rather than waiting 15 minutes.
    redis.store.set('login:locked:user@example.com', String(Date.now() - 1000));

    expect((await throttle.check('user@example.com')).locked).toBe(false);
  });

  it('degrades to no-lockout when Redis is unavailable', async () => {
    // A cache outage must not become an authentication outage. The per-IP rate limiter
    // still applies in that situation.
    const offline = new LoginThrottle(undefined, CONFIG);

    await offline.recordFailure('user@example.com');
    await offline.recordFailure('user@example.com');
    await offline.recordFailure('user@example.com');

    expect((await offline.check('user@example.com')).locked).toBe(false);
  });

  it('degrades to no-lockout when Redis throws', async () => {
    const broken = new LoginThrottle(
      { get: async () => { throw new Error('connection reset'); } } as unknown as IRedisService,
      CONFIG
    );

    expect((await broken.check('user@example.com')).locked).toBe(false);
  });
});
