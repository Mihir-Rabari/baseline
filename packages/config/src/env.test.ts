import { describe, it, expect } from 'vitest';
import { envSchema, getEnv, resetEnvCache, DEV_PLACEHOLDERS } from './env.js';

describe('Environment Configuration (@packages/config)', () => {
  it('should validate default environment values', () => {
    const valid = envSchema.parse({
      NODE_ENV: 'development',
      PORT: '3001',
    });

    expect(valid.PORT).toBe(3001);
    expect(valid.APP_NAME).toBe('production-starter');
    expect(valid.DATABASE_URL).toBe('postgres://postgres:postgres@localhost:5432/app_db');
    expect(valid.REDIS_URL).toBe('redis://localhost:6379');
  });

  it('should coerce boolean and number values correctly', () => {
    const valid = envSchema.parse({
      PORT: '8080',
      DATABASE_PORT: '5433',
      DATABASE_SSL: 'true',
      S3_USE_SSL: 'false',
    });

    expect(valid.PORT).toBe(8080);
    expect(valid.DATABASE_PORT).toBe(5433);
    expect(valid.DATABASE_SSL).toBe(true);
    expect(valid.S3_USE_SSL).toBe(false);
  });

  it('should throw descriptive validation errors on invalid environment variables', () => {
    expect(() => {
      resetEnvCache();
      getEnv({
        NODE_ENV: 'invalid_environment',
        PORT: 'not-a-number',
        DATABASE_PORT: '-10',
      });
    }).toThrow('[Config] Environment validation failed');
  });
});

describe('Production secret guard', () => {
  const baseProdEnv = {
    NODE_ENV: 'production',
    SESSION_SECRET: 'a-genuinely-random-48-byte-value-goes-right-here',
    INITIAL_ROOT_PASSWORD: 'a-freshly-generated-root-password',
    DATABASE_PASSWORD: 'a-real-database-password',
    S3_ACCESS_KEY: 'a-real-access-key',
    S3_SECRET_KEY: 'a-real-secret-key',
  };

  it('accepts a production environment with real secrets', () => {
    expect(() => getEnv(baseProdEnv)).not.toThrow();
  });

  it('refuses to start production with the published SESSION_SECRET default', () => {
    expect(() =>
      getEnv({
        ...baseProdEnv,
        SESSION_SECRET: DEV_PLACEHOLDERS.SESSION_SECRET,
      })
    ).toThrow(/SESSION_SECRET/);
  });

  it('refuses to start production with the published root password', () => {
    expect(() =>
      getEnv({ ...baseProdEnv, INITIAL_ROOT_PASSWORD: DEV_PLACEHOLDERS.INITIAL_ROOT_PASSWORD })
    ).toThrow(/INITIAL_ROOT_PASSWORD/);
  });

  it('refuses to start production with default infrastructure credentials', () => {
    expect(() => getEnv({ ...baseProdEnv, DATABASE_PASSWORD: DEV_PLACEHOLDERS.DATABASE_PASSWORD })).toThrow(
      /DATABASE_PASSWORD/
    );
    expect(() => getEnv({ ...baseProdEnv, S3_SECRET_KEY: DEV_PLACEHOLDERS.S3_SECRET_KEY })).toThrow(
      /S3_SECRET_KEY/
    );
  });

  it('reports every offending variable in one error', () => {
    // An operator should be able to fix the whole set in one pass rather than
    // rediscovering them one restart at a time.
    let message = '';
    try {
      getEnv({
        ...baseProdEnv,
        SESSION_SECRET: DEV_PLACEHOLDERS.SESSION_SECRET,
        DATABASE_PASSWORD: DEV_PLACEHOLDERS.DATABASE_PASSWORD,
        S3_SECRET_KEY: DEV_PLACEHOLDERS.S3_SECRET_KEY,
      });
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).toContain('SESSION_SECRET');
    expect(message).toContain('DATABASE_PASSWORD');
    expect(message).toContain('S3_SECRET_KEY');
  });

  it('rejects a short SESSION_SECRET in production', () => {
    expect(() => getEnv({ ...baseProdEnv, SESSION_SECRET: 'sixteen-chars-ok' })).toThrow(
      /at least 32 characters/
    );
  });

  it('leaves development environments alone', () => {
    // The defaults exist so a fresh clone boots against Docker Compose with no setup.
    expect(() => getEnv({ NODE_ENV: 'development' })).not.toThrow();
    expect(() => getEnv({ NODE_ENV: 'test' })).not.toThrow();
  });
});
