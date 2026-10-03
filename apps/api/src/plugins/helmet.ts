import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import helmet from '@fastify/helmet';

/** Paths served by Swagger UI, which needs inline scripts and styles to render. */
const DOCS_PATH_PREFIX = '/api/docs';

async function helmetPlugin(fastify: FastifyInstance) {
  await fastify.register(helmet, {
    // A strict default policy for the API surface. Swagger UI's requirements used to be
    // applied globally, which meant every JSON endpoint advertised script-src
    // 'unsafe-inline' — a blanket weakening for the benefit of one HTML page.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });

  // Relax the policy for the documentation route only.
  fastify.addHook('onSend', async (request, reply) => {
    if (!request.url.startsWith(DOCS_PATH_PREFIX)) {
      return;
    }

    reply.header(
      'content-security-policy',
      [
        "default-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self' 'unsafe-inline'",
        "img-src 'self' data: validator.swagger.io",
        "object-src 'none'",
        "frame-ancestors 'none'",
      ].join('; ')
    );
  });
}

export default fp(helmetPlugin, {
  name: 'app-helmet',
});
