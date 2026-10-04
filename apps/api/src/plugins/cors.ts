import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import cors from '@fastify/cors';

async function corsPlugin(fastify: FastifyInstance) {
  const env = fastify.env;

  await fastify.register(cors, {
    origin: (origin, cb) => {
      // In development or when no origin (like curl, postman, health probes), allow
      if (!origin || env.NODE_ENV === 'development' || origin === env.WEB_URL) {
        cb(null, true);
        return;
      }

      // A club's own site (platform subdomain or verified custom domain) may call the API.
      let host = '';
      try {
        host = new URL(origin).host.toLowerCase().replace(/:\d+$/, '');
      } catch {
        /* a malformed Origin is refused below */
      }
      const known = host ? fastify.tenantDirectory.isKnownHost(host) : Promise.resolve(false);
      known.then(
        (ok) => (ok ? cb(null, true) : cb(new Error('Not allowed by CORS'), false)),
        () => cb(new Error('Not allowed by CORS'), false)
      );
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-Tenant-Host'],
  });
}

export default fp(corsPlugin, {
  name: 'app-cors',
  dependencies: ['app-config'],
});
