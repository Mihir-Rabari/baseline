import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from './app.js';
import type { FastifyInstance } from 'fastify';

describe('Authentication API Routes (/api/v1/auth)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Validation & Guards', () => {
    it('POST /api/v1/auth/signup should reject invalid payload with 400', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/signup',
        payload: {
          email: 'not-an-email',
          password: 'short', // < 8 characters
        },
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.statusCode).toBe(400);
      expect(json.code).toBe('VALIDATION_ERROR');
      expect(json.details).toBeDefined();
    });

    it('POST /api/v1/auth/login should reject empty body with 400', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.code).toBe('VALIDATION_ERROR');
    });

    it('GET /api/v1/auth/session should return 401 when no session cookie is provided', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/session',
      });

      expect(response.statusCode).toBe(401);
      const json = response.json();
      expect(json.statusCode).toBe(401);
      expect(json.code).toBe('UNAUTHORIZED');
      expect(json.message).toContain('Authentication required');
    });

    it('POST /api/v1/auth/logout should return 200 even if no session exists', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
    });
  });
});
