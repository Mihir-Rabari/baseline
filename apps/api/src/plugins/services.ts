import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { createRedisClient, type IRedisService, createStorageClient, type IStorageService } from '@packages/shared';
import { getDb, closeDatabase, createScopedDb, type DatabaseInstance } from '@packages/db';
import { HealthService } from '../services/health.service.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: DatabaseInstance;
    /** The plain owner connection, outside any tenant scope. Platform-wide work only. */
    systemDb: DatabaseInstance;
    redis: IRedisService;
    storage: IStorageService;
    healthService: HealthService;
  }
}

async function servicesPlugin(fastify: FastifyInstance) {
  const env = fastify.env;

  // Initialize DB instance
  // `db` follows the request's tenant scope (row level security); `systemDb` is the plain owner
  // connection for platform-wide work such as creating clubs.
  const systemDb = getDb();
  fastify.decorate('systemDb', systemDb);
  const db = createScopedDb(systemDb);
  fastify.decorate('db', db);

  // Initialize Redis Service
  const redis = createRedisClient({
    url: env.REDIS_URL,
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD,
  });
  fastify.decorate('redis', redis);

  // Initialize S3 / MinIO Storage Service
  const storage = createStorageClient({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
    bucket: env.S3_BUCKET,
    useSsl: env.S3_USE_SSL,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  });
  fastify.decorate('storage', storage);

  // Initialize Health Service
  const healthService = new HealthService(redis, storage);
  fastify.decorate('healthService', healthService);

  // Graceful cleanup on close
  fastify.addHook('onClose', async () => {
    fastify.log.info('Closing database and redis connections...');
    await Promise.allSettled([
      redis.disconnect(),
      closeDatabase(),
    ]);
  });
}

export default fp(servicesPlugin, {
  name: 'app-services',
  dependencies: ['app-config'],
});
