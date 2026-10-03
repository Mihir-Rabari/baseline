import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import cors from '@fastify/cors';

async function corsPlugin(fastify: FastifyInstance) {
  const env = fastify.env;

  await fastify.register(cors, {
    origin: (origin, cb) => {
      // In development or when no origin (like curl, postman, health probes), allow
      if (!origin || env.NODE_ENV === 'development') {
        cb(null, true);
        return;
      }
      
      const allowedOrigins = [env.WEB_URL];
      if (allowedOrigins.includes(origin)) {
        cb(null, true);
        return;
      }

      cb(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  });
}

export default fp(corsPlugin, {
  name: 'app-cors',
  dependencies: ['app-config'],
});
