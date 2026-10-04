import { afterEach, expect, it, vi } from 'vitest';

vi.mock('dotenv', () => ({
  default: {
    config: vi.fn(() => {
      // Simulate a database configured only in the local .env file.
      vi.stubEnv('DATABASE_URL', 'postgres://test-only');
    }),
  },
}));

afterEach(() => vi.unstubAllEnvs());

it('serializes database suites when DATABASE_URL comes from .env', async () => {
  vi.stubEnv('DATABASE_URL', '');
  const { default: config } = await import('./vitest.config');
  expect(config.test?.fileParallelism).toBe(false);
});
