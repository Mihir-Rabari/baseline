import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from './app.js';
import type { FastifyInstance } from 'fastify';

describe('IAM & Profile Permission Route Guards (/api/v1/iam, /api/v1/profile)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Unauthenticated Access Control (401)', () => {
    it('GET /api/v1/iam/users should reject unauthenticated requests', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/iam/users',
      });

      expect(response.statusCode).toBe(401);
      const json = response.json();
      expect(json.code).toBe('UNAUTHORIZED');
    });

    it('GET /api/v1/iam/roles should reject unauthenticated requests', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/iam/roles',
      });

      expect(response.statusCode).toBe(401);
      const json = response.json();
      expect(json.code).toBe('UNAUTHORIZED');
    });

    it('GET /api/v1/iam/groups should reject unauthenticated requests', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/iam/groups',
      });

      expect(response.statusCode).toBe(401);
      const json = response.json();
      expect(json.code).toBe('UNAUTHORIZED');
    });

    it('GET /api/v1/iam/policies should reject unauthenticated requests', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/iam/policies',
      });

      expect(response.statusCode).toBe(401);
      const json = response.json();
      expect(json.code).toBe('UNAUTHORIZED');
    });

    it('GET /api/v1/iam/permissions should reject unauthenticated requests', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/iam/permissions',
      });

      expect(response.statusCode).toBe(401);
      const json = response.json();
      expect(json.code).toBe('UNAUTHORIZED');
    });

    it('GET /api/v1/profile should reject unauthenticated requests', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/profile',
      });

      expect(response.statusCode).toBe(401);
      const json = response.json();
      expect(json.code).toBe('UNAUTHORIZED');
    });
  });

  describe('Policy condition operator validation (400)', () => {
    // Body schema validation runs ahead of the `requirePermission` auth preHandler in
    // Fastify's request lifecycle, so an unsupported operator is rejected with 400
    // before authorization is even evaluated. This confirms issue #5: a policy carrying
    // an operator the engine doesn't understand (e.g. `IpAddressInRange`) can no longer
    // reach storage through the write API.
    it('POST /api/v1/iam/policies rejects an unsupported condition operator', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/iam/policies',
        payload: {
          name: 'BadOperatorPolicy',
          statements: [
            {
              effect: 'allow',
              actions: ['users:read'],
              conditions: { IpAddressInRange: { sourceIp: '10.0.0.0/8' } },
            },
          ],
        },
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.code).toBe('VALIDATION_ERROR');
      const detailMessages = (json.details || []).map((d: { message: string }) => d.message).join(' | ');
      expect(detailMessages).toContain('IpAddressInRange');
      expect(detailMessages).toContain('StringEquals');
      expect(detailMessages).toContain('OwnerEquals');
    });

    it('PUT /api/v1/iam/policies/:id rejects an unsupported condition operator', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/v1/iam/policies/11111111-1111-1111-1111-111111111111',
        payload: {
          statements: [
            {
              effect: 'allow',
              actions: ['users:read'],
              conditions: { DateGreaterThan: { expiresAt: '2026-01-01' } },
            },
          ],
        },
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.code).toBe('VALIDATION_ERROR');
      const detailMessages = (json.details || []).map((d: { message: string }) => d.message).join(' | ');
      expect(detailMessages).toContain('DateGreaterThan');
    });
  });
});
