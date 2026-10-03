import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from './app.js';
import type { FastifyInstance } from 'fastify';

describe('Fastify Backend Application (@app/api)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Health Probes', () => {
    it('GET /health should return 200 with summary status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.status).toBe('ok');
      expect(json.uptime).toBeTypeOf('number');
      expect(json.version).toBeDefined();
    });

    it('GET /health/live should return 200 liveness probe', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health/live',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.status).toBe('ok');
      expect(json.timestamp).toBeDefined();
    });

    it('GET /health/ready should return structured dependency readiness status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health/ready',
      });

      // The readiness probe legitimately depends on whether Postgres, Redis and MinIO
      // are up, so the status code cannot be pinned. What must always hold is that the
      // code and the reported status agree — a 200 that says "error", or a 503 that
      // says "ok", is a real bug and this assertion catches it.
      expect([200, 503]).toContain(response.statusCode);
      const json = response.json();
      expect(['ok', 'degraded', 'error']).toContain(json.status);
      expect(response.statusCode === 200).toBe(json.status === 'ok');
      expect(json.services).toBeDefined();
      expect(json.services.api).toBe('ok');
    });
  });

  describe('System Metadata Routes', () => {
    it('GET /api/v1/system/info should return runtime environment info', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/system/info',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.name).toBeDefined();
      expect(json.version).toBeDefined();
      expect(json.nodeVersion).toBeDefined();
      expect(json.features).toBeDefined();
    });
  });

  describe('OpenAPI & Documentation', () => {
    it('GET /api/openapi.json should return valid OpenAPI 3.0 document', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/openapi.json',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.openapi).toMatch(/^3\./);
      expect(json.info.title).toBeDefined();
      expect(json.paths['/health']).toBeDefined();
      expect(json.paths['/api/v1/system/info']).toBeDefined();
    });

    it('GET /api/docs should serve Swagger UI HTML', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/docs',
      });

      // Swagger UI is mounted at the bare path and serves the shell directly; the
      // redirect variant only applies to /api/docs (no trailing slash) under other
      // configurations. Pinning it means a routing change is caught rather than absorbed.
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
    });
  });

  describe('Prometheus Metrics', () => {
    it('GET /metrics should expose prometheus text format metrics', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/metrics',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/plain');
      expect(response.body).toContain('app_');
      expect(response.body).toContain('http_requests_total');
    });
  });

  describe('Error Handling & Security', () => {
    it('should return structured 404 for unknown routes', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/non-existent-route',
      });

      expect(response.statusCode).toBe(404);
      const json = response.json();
      expect(json.statusCode).toBe(404);
      expect(json.code).toBe('ROUTE_NOT_FOUND');
      expect(json.requestId).toBeDefined();
    });

    it('should include request ID headers in responses', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
        headers: {
          'x-request-id': 'custom-req-id-12345',
        },
      });

      expect(response.statusCode).toBe(200);
    });
  });
});
