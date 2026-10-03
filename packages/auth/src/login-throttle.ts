import type { IRedisService } from '@packages/shared';

export interface LoginThrottleConfig {
  /** Failed attempts permitted before the account is locked. */
  maxAttempts: number;
  /** How long a lockout lasts, in seconds. */
  lockoutSeconds: number;
  /** Window over which failed attempts accumulate, in seconds. */
  windowSeconds: number;
}

export interface LockoutState {
  locked: boolean;
  /** Seconds until the lockout lifts. Only meaningful when `locked` is true. */
  retryAfterSeconds: number;
}

/**
 * Per-identifier failed-login throttle.
 *
 * Rate limiting by IP alone does not stop credential stuffing distributed across many
 * source addresses, so attempts are also counted per login identifier. Counters live in
 * Redis and expire on their own; there is no cleanup job.
 *
 * When Redis is unavailable the throttle degrades to "no lockout" rather than locking
 * everyone out. That is deliberate: the global rate limiter still applies, and a cache
 * outage should not become an authentication outage.
 */
export class LoginThrottle {
  constructor(
    private redis: IRedisService | undefined,
    private config: LoginThrottleConfig
  ) {}

  private attemptsKey(identifier: string): string {
    return `login:attempts:${identifier.toLowerCase()}`;
  }

  private lockKey(identifier: string): string {
    return `login:locked:${identifier.toLowerCase()}`;
  }

  /**
   * Reports whether the identifier is currently locked out.
   */
  public async check(identifier: string): Promise<LockoutState> {
    if (!this.redis) {
      return { locked: false, retryAfterSeconds: 0 };
    }

    try {
      const lockedUntil = await this.redis.get(this.lockKey(identifier));
      if (!lockedUntil) {
        return { locked: false, retryAfterSeconds: 0 };
      }

      const remainingMs = Number(lockedUntil) - Date.now();
      if (remainingMs <= 0) {
        await this.redis.delete(this.lockKey(identifier));
        return { locked: false, retryAfterSeconds: 0 };
      }

      return { locked: true, retryAfterSeconds: Math.ceil(remainingMs / 1000) };
    } catch {
      return { locked: false, retryAfterSeconds: 0 };
    }
  }

  /**
   * Records a failed attempt, engaging the lockout once the threshold is crossed.
   * Returns the resulting state so the caller can report the lockout immediately.
   */
  public async recordFailure(identifier: string): Promise<LockoutState> {
    if (!this.redis) {
      return { locked: false, retryAfterSeconds: 0 };
    }

    try {
      const key = this.attemptsKey(identifier);
      const current = Number((await this.redis.get(key)) ?? 0) + 1;
      await this.redis.set(key, String(current), this.config.windowSeconds);

      if (current >= this.config.maxAttempts) {
        const until = Date.now() + this.config.lockoutSeconds * 1000;
        await this.redis.set(this.lockKey(identifier), String(until), this.config.lockoutSeconds);
        await this.redis.delete(key);
        return { locked: true, retryAfterSeconds: this.config.lockoutSeconds };
      }

      return { locked: false, retryAfterSeconds: 0 };
    } catch {
      return { locked: false, retryAfterSeconds: 0 };
    }
  }

  /**
   * Clears the failure counter after a successful authentication.
   */
  public async recordSuccess(identifier: string): Promise<void> {
    if (!this.redis) return;

    try {
      await this.redis.delete(this.attemptsKey(identifier));
      await this.redis.delete(this.lockKey(identifier));
    } catch {
      // A throttle-reset failure must not fail an otherwise valid login.
    }
  }
}
