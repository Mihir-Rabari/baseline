import { defineConfig } from 'vitest/config';

// A dedicated config, rather than relying on the root vitest.config.ts's upward-search
// discovery, for two reasons:
//
// 1. The root config's coverage thresholds are calibrated against a full workspace run
//    (see its own comments). Coverage `all: true` is v8's default, so scoping *test
//    execution* to this package alone (e.g. `vitest run packages/iam`) still instruments
//    and reports every other file in the coverage.include scope at 0% — which then blows
//    the root config's global/branches/etc. thresholds for reasons that have nothing to
//    do with this package. Only a package-local coverage.include avoids that.
// 2. The root config's `setupFiles: ['./apps/web/vitest.setup.ts']` resolves against the
//    running process's cwd, not the config file's own directory, when Vite discovers a
//    config by walking upward from a different cwd (e.g. `pnpm --filter @packages/iam
//    test:coverage` runs with cwd=packages/iam) — so it looked for
//    packages/iam/apps/web/vitest.setup.ts and failed outright.
//
// The `database` CI job runs this directly (see .github/workflows/ci.yml's "IAM Service
// Integration Tests" step) specifically to evaluate the DATABASE_URL-gated
// `iam-service.ts` threshold below against real Postgres, without the rest of the
// workspace's untested files dragging global coverage down to near zero.
const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: process.env.LOG_LEVEL ?? 'silent',
    },
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include: ['src/**'],
      exclude: ['**/*.d.ts', '**/*.test.ts'],
      thresholds: {
        'src/policy/**': {
          statements: 95,
          branches: 90,
          functions: 95,
          lines: 95,
        },
        // Only meaningful with a live Postgres — iam-service.integration.test.ts skips
        // without one, and asserting a coverage floor against skipped tests would fail
        // the no-database quality-gate job for coverage it can never produce.
        ...(hasDatabaseUrl
          ? {
              'src/service/**': {
                statements: 55,
                branches: 55,
                functions: 50,
                lines: 55,
              },
            }
          : {}),
      },
    },
  },
});
