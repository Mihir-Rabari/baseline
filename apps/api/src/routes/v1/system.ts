import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { SystemInfoResponseSchema } from '../../schemas/system.schema.js';
import { HttpErrorResponseSchema } from '@packages/validation';

export const systemRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get(
    '/system/info',
    {
      schema: {
        description: 'Get runtime environment and system metadata',
        tags: ['System'],
        response: {
          200: SystemInfoResponseSchema,
          500: HttpErrorResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      const config = fastify.appConfig;
      const env = fastify.env;

      return reply.status(200).send({
        name: config.name,
        version: config.version,
        environment: env.NODE_ENV,
        nodeVersion: process.version,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        features: config.features,
      });
    }
  );
};
