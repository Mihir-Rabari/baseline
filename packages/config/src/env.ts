import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';

// Automatically load .env file if present
function loadEnvFile(): void {
  const rootEnv = path.resolve(process.cwd(), '.env');
  const parentEnv = path.resolve(process.cwd(), '../../.env');
  
  if (fs.existsSync(rootEnv)) {
    dotenv.config({ path: rootEnv });
  } else if (fs.existsSync(parentEnv)) {
    dotenv.config({ path: parentEnv });
  } else {
    dotenv.config();
  }
}

loadEnvFile();

/**
 * Development placeholders shipped in `.env.example`.
 *
 * They exist so a fresh clone boots against Docker Compose with no configuration. They
 * are published in the repository, so they are public knowledge and must never reach a
 * production process — `assertProductionSecrets` enforces that.
 *
 * Declared once and referenced by both the schema defaults below and the guard, so the
 * two can never disagree about what counts as a placeholder.
 */
export const DEV_PLACEHOLDERS = {
  SESSION_SECRET: 'a_very_secret_32_character_string_for_session_cookies_change_in_prod',
  INITIAL_ROOT_PASSWORD: 'RootSecurePass123!',
  DATABASE_PASSWORD: 'postgres',
  S3_ACCESS_KEY: 'minioadmin',
  S3_SECRET_KEY: 'minioadmin',
} as const;

/**
 * Zod Schema for Environment Variables
 */
export const envSchema = z.object({
  // Application
  APP_NAME: z.string().default('production-starter'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // Service URLs
  WEB_URL: z.string().url().default('http://localhost:3000'),
  API_URL: z.string().url().default('http://localhost:3001'),
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default('0.0.0.0'),

  // Reverse proxy trust.
  //
  // Set this when the API sits behind nginx, a cloud load balancer, or Docker's
  // ingress. Without it Fastify reports every request as originating from the proxy,
  // which makes per-IP rate limiting meaningless and records the wrong address on
  // sessions and audit logs.
  //
  // Accepts `true`/`false`, a hop count ("1"), or a comma-separated CIDR allowlist.
  TRUST_PROXY: z.string().default('false'),

  // PostgreSQL Database
  DATABASE_URL: z.string().min(1).default('postgres://postgres:postgres@localhost:5432/app_db'),
  DATABASE_HOST: z.string().default('localhost'),
  DATABASE_PORT: z.coerce.number().int().positive().default(5432),
  DATABASE_USER: z.string().default('postgres'),
  DATABASE_PASSWORD: z.string().default(DEV_PLACEHOLDERS.DATABASE_PASSWORD),
  DATABASE_NAME: z.string().default('app_db'),
  DATABASE_SSL: z
    .enum(['true', 'false'])
    .or(z.boolean())
    .transform((val) => val === true || val === 'true')
    .default(false),

  // Redis
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),

  // MinIO / S3 Object Storage
  S3_ENDPOINT: z.string().default('http://localhost:9000'),
  S3_PORT: z.coerce.number().int().positive().default(9000),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().default(DEV_PLACEHOLDERS.S3_ACCESS_KEY),
  S3_SECRET_KEY: z.string().default(DEV_PLACEHOLDERS.S3_SECRET_KEY),
  S3_BUCKET: z.string().default('app-uploads'),
  S3_USE_SSL: z
    .enum(['true', 'false'])
    .or(z.boolean())
    .transform((val) => val === true || val === 'true')
    .default(false),
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .or(z.boolean())
    .transform((val) => val === true || val === 'true')
    .default(true),

  // Optional Providers
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM: z.string().email().optional().default('noreply@example.com'),

  // Authentication & Sessions (Phase 2)
  SESSION_SECRET: z.string().min(16).default(DEV_PLACEHOLDERS.SESSION_SECRET),
  SESSION_COOKIE_NAME: z.string().default('app_session'),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(604800), // 7 days

  // Root Account Initial Bootstrap (Phase 2)
  INITIAL_ROOT_EMAIL: z.string().email().default('root@example.com'),
  INITIAL_ROOT_PASSWORD: z.string().min(8).default(DEV_PLACEHOLDERS.INITIAL_ROOT_PASSWORD),

  // Observability
  PROMETHEUS_URL: z.string().default('http://localhost:9090'),
});

export type Env = z.infer<typeof envSchema>;

/**
 * The variables the production guard checks, derived from {@link DEV_PLACEHOLDERS} so
 * that changing a placeholder cannot leave the guard checking a stale value.
 */
export const INSECURE_DEFAULTS: Record<string, string[]> = Object.fromEntries(
  Object.entries(DEV_PLACEHOLDERS).map(([key, value]) => [key, [value]])
);

/**
 * Refuses to start a production process that is still using development placeholders.
 *
 * Throws with every offending variable listed at once, so an operator fixes the whole
 * set in one pass rather than discovering them one restart at a time.
 */
export function assertProductionSecrets(env: Env): void {
  if (env.NODE_ENV !== 'production') {
    return;
  }

  const offenders: string[] = [];

  for (const [key, insecureValues] of Object.entries(INSECURE_DEFAULTS)) {
    const value = (env as unknown as Record<string, unknown>)[key];
    if (typeof value === 'string' && insecureValues.includes(value)) {
      offenders.push(`  ${key}: still set to the public default shipped in .env.example`);
    }
  }

  if (env.SESSION_SECRET.length < 32) {
    offenders.push('  SESSION_SECRET: must be at least 32 characters in production');
  }

  if (offenders.length > 0) {
    throw new Error(
      '[Config] Refusing to start in production with insecure configuration:\n' +
        offenders.join('\n') +
        '\n\nGenerate fresh values, e.g. `node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"`.'
    );
  }
}

let cachedEnv: Env | null = null;

/**
 * Validate and retrieve typed environment variables
 */
export function getEnv(overrideEnv?: Record<string, unknown>): Env {
  if (cachedEnv && !overrideEnv) {
    return cachedEnv;
  }

  const raw = overrideEnv || process.env;
  const parsed = envSchema.safeParse(raw);

  if (!parsed.success) {
    const formatted = parsed.error.format();
    const errorDetails = Object.entries(formatted)
      .filter(([k]) => k !== '_errors')
      .map(([k, v]) => `  ${k}: ${(v as { _errors: string[] })._errors.join(', ')}`)
      .join('\n');

    const errorMessage = `[Config] Environment validation failed:\n${errorDetails}`;
    
    // In test environment, throw descriptive error; in production/development, log and throw
    throw new Error(errorMessage);
  }

  assertProductionSecrets(parsed.data);

  if (!overrideEnv) {
    cachedEnv = parsed.data;
  }

  return parsed.data;
}

/**
 * Reset cached environment (useful in tests)
 */
export function resetEnvCache(): void {
  cachedEnv = null;
}
