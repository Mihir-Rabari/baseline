import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  HealthSummaryResponseSchema,
  LivenessResponseSchema,
  ReadinessResponseSchema,
} from '../schemas/health.schema.js';
import { HttpErrorResponseSchema } from '@packages/validation';

export const healthRoutes: FastifyPluginAsyncZod = async (fastify) => {
  // GET /health - Summary
  fastify.get(
    '/health',
    {
      schema: {
        description: 'Get application health summary',
        tags: ['Health'],
        response: {
          200: HealthSummaryResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      const summary = fastify.healthService.getSummary();
      return reply.status(200).send(summary);
    }
  );

  // GET /health/live - Liveness probe (for k8s / docker container health)
  fastify.get(
    '/health/live',
    {
      schema: {
        description: 'Liveness probe verifying the HTTP server is responsive',
        tags: ['Health'],
        response: {
          200: LivenessResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      const liveness = fastify.healthService.getLiveness();
      return reply.status(200).send(liveness);
    }
  );

  // GET /health/ready - Readiness probe (verifying PostgreSQL, Redis, MinIO)
  fastify.get(
    '/health/ready',
    {
      schema: {
        description: 'Readiness probe verifying all backing dependencies (PostgreSQL, Redis, Storage) are operational',
        tags: ['Health'],
        response: {
          200: ReadinessResponseSchema,
          503: ReadinessResponseSchema,
          500: HttpErrorResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      const readiness = await fastify.healthService.getReadiness();
      // 200 must mean "every dependency is genuinely ok" — a caller that only checks the
      // status code (the common case for load balancers / orchestrators) has no other way
      // to learn that a dependency (e.g. MinIO) is unreachable while Postgres and Redis
      // are fine. 'degraded' is still a failure to route traffic to this instance, so it
      // gets 503 alongside 'error'; only 'ok' gets 200.
      const statusCode = readiness.status === 'ok' ? 200 : 503;
      return reply.status(statusCode).send(readiness);
    }
  );
};
