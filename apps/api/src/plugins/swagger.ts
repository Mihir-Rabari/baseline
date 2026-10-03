import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';
import { getOpenApiSpecification } from '@packages/openapi';

async function swaggerPlugin(fastify: FastifyInstance) {
  const env = fastify.env;
  const openApiSpec = getOpenApiSpecification({
    hostUrl: env.API_URL,
  });

  await fastify.register(swagger, {
    openapi: openApiSpec,
    transform: jsonSchemaTransform,
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/api/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      displayRequestDuration: true,
    },
    staticCSP: true,
    transformStaticCSP: (header) => header,
  });

  // Expose raw openapi.json route
  fastify.get('/api/openapi.json', { schema: { hide: true } }, async (_request, reply) => {
    return reply.send(fastify.swagger());
  });
}

export default fp(swaggerPlugin, {
  name: 'app-swagger',
  dependencies: ['app-config'],
});
