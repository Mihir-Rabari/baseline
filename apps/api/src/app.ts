import fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { createLogger } from './lib/logger.js';
import { getEnv } from '@packages/config/env';

// Plugins
import configPlugin from './plugins/config.js';
import helmetPlugin from './plugins/helmet.js';
import corsPlugin from './plugins/cors.js';
import rateLimitPlugin from './plugins/rate-limit.js';
import swaggerPlugin from './plugins/swagger.js';
import metricsPlugin from './plugins/metrics.js';
import servicesPlugin from './plugins/services.js';
import authPlugin from './plugins/auth.js';
import iamPlugin from './plugins/iam.js';
import errorHandlerPlugin from './plugins/error-handler.js';

// Routes
import { healthRoutes } from './routes/health.js';
import { v1Routes } from './routes/v1/index.js';

const SAFE_REQ_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Translates the TRUST_PROXY env value into Fastify's `trustProxy` option.
 *
 * "false" (the default) means `request.ip` is the socket address. Behind a proxy that
 * is always the proxy itself, so operators must opt in explicitly — either with `true`,
 * a hop count, or, preferably, the CIDR of their own load balancer.
 */
function resolveTrustProxy(value: string): boolean | string | string[] {
  const normalized = value.trim().toLowerCase();

  if (normalized === '' || normalized === 'false') return false;
  if (normalized === 'true') return true;

  // A bare integer is a hop count. Fastify forwards it to proxy-addr as a string.
  const hops = Number(normalized);
  if (Number.isInteger(hops) && hops > 0) return normalized;

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function buildApp(options: FastifyServerOptions = {}): FastifyInstance {
  const env = getEnv();
  const logger = createLogger(env.NODE_ENV, env.LOG_LEVEL);

  const serverOptions: FastifyServerOptions = {
    loggerInstance: logger,
    trustProxy: resolveTrustProxy(env.TRUST_PROXY),
    genReqId: (req) => {
      const headerReqId = req.headers['x-request-id'];
      if (
        typeof headerReqId === 'string' &&
        headerReqId.length > 0 &&
        SAFE_REQ_ID_PATTERN.test(headerReqId)
      ) {
        return headerReqId;
      }
      return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    },
    ...options,
  };

  const app = fastify(serverOptions).withTypeProvider<ZodTypeProvider>();

  // Ensure x-request-id is always included in response headers for client tracing
  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  // Configure Zod validation & serialization compilers
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Register foundational plugins
  app.register(configPlugin);
  app.register(helmetPlugin);
  app.register(corsPlugin);
  app.register(rateLimitPlugin);
  app.register(swaggerPlugin);
  app.register(metricsPlugin);
  app.register(servicesPlugin);
  app.register(authPlugin);
  app.register(iamPlugin);
  app.register(errorHandlerPlugin);

  // Register application routes
  app.register(healthRoutes);
  app.register(v1Routes, { prefix: '/api/v1' });

  return app;
}
