import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The `database` CI job (see .github/workflows/ci.yml) is the only place `DATABASE_URL`
// is set, so it's also the only place `iam-service.integration.test.ts` actually runs
// instead of skipping. Gating the service-layer threshold on it keeps the no-database
// quality gate green (it would otherwise fail on integration-only coverage it can never
// produce) while still catching a coverage regression wherever Postgres is available.
const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

export default defineConfig({
  resolve: {
    alias: {
      // Mirrors apps/web/tsconfig.json's "@/*" path mapping so component/hook tests
      // that import via the app's own alias resolve the same way the Next.js build does.
      '@': fileURLToPath(new URL('./apps/web/src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    // apps/web ships React components and hooks that need a DOM (document, window,
    // localStorage) to render under @testing-library/react. The rest of the workspace
    // (API, packages) is server-side code that runs faster and more realistically under
    // plain node, so only apps/web opts into jsdom rather than flipping it globally.
    environmentMatchGlobs: [['apps/web/**', 'jsdom']],
    // Absolute, like the alias above — a relative path here resolves against the running
    // process's cwd when Vite discovers this config by walking upward from elsewhere
    // (e.g. `pnpm --filter <pkg> test` from that package's own directory), not against
    // this file's directory. That silently pointed at a nonexistent
    // <cwd>/apps/web/vitest.setup.ts for any such invocation.
    setupFiles: [fileURLToPath(new URL('./apps/web/vitest.setup.ts', import.meta.url))],
    env: {
      NODE_ENV: 'test',
      // Silence the API's request logger by default. Every `app.inject()` otherwise
      // writes raw pino JSON to stdout, burying the reporter's output and making a real
      // failure hard to find. Set LOG_LEVEL on the command line to get it back:
      //   LOG_LEVEL=debug pnpm test
      // (`.env` also sets LOG_LEVEL, which is why this cannot be keyed off its absence.)
      LOG_LEVEL: process.env.LOG_LEVEL ?? 'silent',
    },
    include: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**'],
    // Vitest defaults to 5s, which is too tight for the suites that copy the whole
    // template tree or pack 14 skill bundles. Those comfortably fit on Linux and on a
    // developer machine, then intermittently blow the budget on a Windows CI runner,
    // where filesystem calls are markedly slower. A green suite that fails once a week
    // on timing alone teaches people to re-run CI rather than read it.
    // The one genuinely slow hook — scaffolding the template tree in generator.test.ts —
    // sets its own budget inline, so the global stays tight enough that a hung hook
    // still fails fast.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json', 'html'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/.next/**',
        '**/*.d.ts',
        '**/*.config.*',
        '**/scripts/**',
        '**/infrastructure/**',
        // Next.js app-router pages/layouts and presentational components are framework
        // glue and markup, best covered by e2e/visual tests, not unit coverage. Issue #6
        // scopes apps/web unit coverage to hooks/contexts/lib, where the state and
        // request logic actually lives — component/page coverage is a follow-up.
        'apps/web/src/app/**',
        'apps/web/src/components/**',
        'apps/web/**/*.config.*',
      ],
      // Without thresholds, `test:coverage` reported numbers that nothing acted on and
      // the CI step could never fail.
      //
      // The global floor is set to what holds with no infrastructure running, which is
      // the CI quality-gate's situation and a contributor's default. Database-backed
      // paths (most of iam-service) push the real figure higher when Postgres is up;
      // pinning to that number would make the suite fail depending on whether Docker
      // happened to be running.
      //
      // apps/web joined the coverage report in issue #6 (previously excluded entirely).
      // Its hooks/contexts/lib are now unit-tested but its components/pages are not yet
      // (out of scope for that issue — see the coverage `exclude` list above), so the
      // measured global numbers moved. These floors are set a couple points below what
      // `pnpm test:coverage` actually measured on a clean checkout (no Docker/Postgres),
      // so the gate ratchets up from a real baseline instead of chasing an aspirational
      // one that starts red.
      thresholds: {
        statements: 58,
        branches: 78,
        functions: 48,
        lines: 58,

        // Tighter floors on the security-critical pure logic. These modules decide who
        // may do what, contain no I/O, and so have no excuse for gaps.
        'packages/iam/src/policy/**': {
          statements: 95,
          branches: 90,
          functions: 95,
          lines: 95,
        },
        'packages/shared/src/crypto/**': {
          statements: 85,
          branches: 85,
          functions: 95,
          lines: 85,
        },

        // iam-service.ts mediates every role/group/policy mutation and resolves
        // effective permissions; its guard rails (assertCanGrantPolicy,
        // assertNotSystemRecord, assertStatusChangeAllowed) and getEffectivePermissions
        // are covered by iam-service.integration.test.ts, which only runs (rather than
        // skips) when DATABASE_URL is set — hence gating this threshold the same way.
        ...(hasDatabaseUrl
          ? {
              'packages/iam/src/service/**': {
                statements: 70,
                branches: 60,
                functions: 70,
                lines: 70,
              },
            }
          : {}),
      },
    },
  },
});
