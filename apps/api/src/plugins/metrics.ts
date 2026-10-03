import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import client from 'prom-client';

declare module 'fastify' {
  interface FastifyInstance {
    metricsRegistry: client.Registry;
  }
}

async function metricsPlugin(fastify: FastifyInstance) {
  const register = new client.Registry();

  // Enable collection of default process/runtime metrics
  client.collectDefaultMetrics({
    register,
    prefix: 'app_',
  });

  // Custom HTTP metrics
  const httpRequestCounter = new client.Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests received',
    labelNames: ['method', 'route', 'status_code'],
    registers: [register],
  });

  const httpRequestDurationHistogram = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [register],
  });

  const httpErrorCounter = new client.Counter({
    name: 'http_request_errors_total',
    help: 'Total number of HTTP requests that resulted in 4xx or 5xx status codes',
    labelNames: ['method', 'route', 'status_code', 'error_code'],
    registers: [register],
  });

  // Hook into request lifecycle
  fastify.addHook('onRequest', async (request: FastifyRequest) => {
    (request as unknown as { startTime: [number, number] }).startTime = process.hrtime();
  });

  fastify.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = (request as unknown as { startTime: [number, number] }).startTime;
    if (!startTime) return;

    const diff = process.hrtime(startTime);
    const durationInSeconds = diff[0] + diff[1] / 1e9;

    const route = request.routeOptions?.url || request.url.split('?')[0] || 'unknown';
    const method = request.method;
    const statusCode = String(reply.statusCode);

    // Skip metrics endpoint scraping itself from request counts to avoid noise
    if (route === '/metrics') return;

    httpRequestCounter.inc({ method, route, status_code: statusCode });
    httpRequestDurationHistogram.observe({ method, route, status_code: statusCode }, durationInSeconds);

    if (reply.statusCode >= 400) {
      httpErrorCounter.inc({ method, route, status_code: statusCode, error_code: 'HTTP_ERROR' });
    }
  });

  // Expose /metrics endpoint
  fastify.get('/metrics', { schema: { hide: true } }, async (_request, reply) => {
    reply.header('Content-Type', register.contentType);
    return reply.send(await register.metrics());
  });

  fastify.decorate('metricsRegistry', register);
}

export default fp(metricsPlugin, {
  name: 'app-metrics',
});
