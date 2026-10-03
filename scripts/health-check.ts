import { checkDatabaseHealth, closeDatabase } from '@packages/db';
import { createRedisClient, createStorageClient } from '@packages/shared';
import { getEnv } from '@packages/config/env';

interface CheckResult {
  name: string;
  target: string;
  status: 'UP' | 'DOWN' | 'DEGRADED';
  latencyMs?: number;
  error?: string;
}

async function runHealthCheck(): Promise<void> {
  const env = getEnv();
  console.log('🔍 Executing system-wide infrastructure health checks...\n');

  const results: CheckResult[] = [];

  // 1. Check PostgreSQL Database
  try {
    const dbCheck = await checkDatabaseHealth();
    results.push({
      name: 'PostgreSQL Database',
      target: env.DATABASE_URL.replace(/:[^:@]*@/, ':****@'),
      status: dbCheck.status === 'ok' ? 'UP' : 'DOWN',
      latencyMs: dbCheck.latencyMs,
      error: dbCheck.error,
    });
  } catch (err: unknown) {
    results.push({
      name: 'PostgreSQL Database',
      target: env.DATABASE_HOST + ':' + env.DATABASE_PORT,
      status: 'DOWN',
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    await closeDatabase();
  }

  // 2. Check Redis
  const redis = createRedisClient({
    url: env.REDIS_URL,
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD,
  });

  try {
    const redisCheck = await redis.healthCheck();
    results.push({
      name: 'Redis Cache',
      target: env.REDIS_URL.replace(/:[^:@]*@/, ':****@'),
      status: redisCheck.status === 'ok' ? 'UP' : 'DOWN',
      latencyMs: redisCheck.latencyMs,
      error: redisCheck.error,
    });
  } catch (err: unknown) {
    results.push({
      name: 'Redis Cache',
      target: env.REDIS_HOST + ':' + env.REDIS_PORT,
      status: 'DOWN',
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    await redis.disconnect();
  }

  // 3. Check MinIO / S3 Storage
  const storage = createStorageClient({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
    bucket: env.S3_BUCKET,
    useSsl: env.S3_USE_SSL,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  });

  try {
    const storageCheck = await storage.healthCheck();
    results.push({
      name: 'MinIO / S3 Storage',
      target: `${env.S3_ENDPOINT}/${env.S3_BUCKET}`,
      status: storageCheck.status === 'ok' ? 'UP' : 'DOWN',
      latencyMs: storageCheck.latencyMs,
      error: storageCheck.error,
    });
  } catch (err: unknown) {
    results.push({
      name: 'MinIO / S3 Storage',
      target: env.S3_ENDPOINT,
      status: 'DOWN',
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 4. Check Fastify API (if running)
  const apiStart = Date.now();
  try {
    const apiRes = await fetch(`${env.API_URL}/health/ready`, { signal: AbortSignal.timeout(3000) });
    const latencyMs = Date.now() - apiStart;
    if (apiRes.ok) {
      results.push({
        name: 'Fastify API Server',
        target: `${env.API_URL}/health/ready`,
        status: 'UP',
        latencyMs,
      });
    } else {
      results.push({
        name: 'Fastify API Server',
        target: `${env.API_URL}/health/ready`,
        status: 'DEGRADED',
        latencyMs,
        error: `HTTP ${apiRes.status}`,
      });
    }
  } catch (err: unknown) {
    results.push({
      name: 'Fastify API Server',
      target: `${env.API_URL}/health/ready`,
      status: 'DOWN',
      error: 'Not running (host process)',
    });
  }

  // 5. Check Prometheus (if running)
  const promStart = Date.now();
  try {
    const promRes = await fetch(`${env.PROMETHEUS_URL}/-/healthy`, { signal: AbortSignal.timeout(3000) });
    const latencyMs = Date.now() - promStart;
    results.push({
      name: 'Prometheus Observability',
      target: `${env.PROMETHEUS_URL}/-/healthy`,
      status: promRes.ok ? 'UP' : 'DOWN',
      latencyMs,
    });
  } catch {
    results.push({
      name: 'Prometheus Observability',
      target: env.PROMETHEUS_URL,
      status: 'DOWN',
      error: 'Container unreachable or stopped',
    });
  }

  // Display formatted table
  console.log('┌─────────────────────────────┬──────────┬────────────┬──────────────────────────────────────────┐');
  console.log('│ Service                     │ Status   │ Latency    │ Target / Error                           │');
  console.log('├─────────────────────────────┼──────────┼────────────┼──────────────────────────────────────────┤');

  let hasDown = false;

  for (const r of results) {
    const statusFormatted =
      r.status === 'UP'
        ? '\x1b[32mUP      \x1b[0m'
        : r.status === 'DEGRADED'
        ? '\x1b[33mDEGRADED\x1b[0m'
        : '\x1b[31mDOWN    \x1b[0m';

    const latencyFormatted = r.latencyMs !== undefined ? `${r.latencyMs}ms`.padEnd(10) : '-         ';
    const detail = r.error ? `\x1b[31m${r.error.substring(0, 40)}\x1b[0m` : r.target.substring(0, 40);

    console.log(`│ ${r.name.padEnd(27)} │ ${statusFormatted} │ ${latencyFormatted} │ ${detail.padEnd(40)} │`);

    if (r.status === 'DOWN' && (r.name.includes('PostgreSQL') || r.name.includes('Redis') || r.name.includes('MinIO'))) {
      hasDown = true;
    }
  }

  console.log('└─────────────────────────────┴──────────┴────────────┴──────────────────────────────────────────┘\n');

  if (hasDown) {
    console.error('❌ Critical infrastructure services are DOWN. Run "pnpm infra:up" to start Docker containers.');
    process.exit(1);
  } else {
    console.log('✅ Infrastructure health verification complete.');
    process.exit(0);
  }
}

runHealthCheck().catch((err) => {
  console.error('Fatal health check error:', err);
  process.exit(1);
});
