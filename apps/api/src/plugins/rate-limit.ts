import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';

async function rateLimitPlugin(fastify: FastifyInstance) {
  const config = fastify.appConfig;

  await fastify.register(rateLimit, {
    max: config.security.rateLimitMax,
    timeWindow: config.security.rateLimitTimeWindow,
    // No loopback allowlist.
    //
    // Behind nginx, a cloud load balancer, or Docker ingress, every request arrives from
    // 127.0.0.1 unless TRUST_PROXY is configured. Allowlisting loopback therefore
    // switched rate limiting off entirely in exactly the deployments that need it — an
    // unlimited-attempt path straight to /auth/login.
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Try again in ${context.after}`,
      code: 'RATE_LIMIT_EXCEEDED',
    }),
  });
}

export default fp(rateLimitPlugin, {
  name: 'app-rate-limit',
  dependencies: ['app-config'],
});
