/**
 * Browser-safe configuration.
 *
 * This entry point deliberately does NOT re-export `env.ts`. That module reads the
 * filesystem and calls dotenv at import time, so pulling it into the barrel meant any
 * client component importing `@packages/config` — which the README tells developers to
 * do — would break the Next.js client build or drag server environment handling into
 * the browser bundle.
 *
 * Server code imports runtime environment from `@packages/config/env` instead.
 */
export * from './app-config.js';
export * from './auth-config.js';
export * from './iam-config.js';
export * from './feature-config.js';
