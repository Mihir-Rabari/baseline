import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from './app.js';
import type { FastifyInstance } from 'fastify';

describe('HTTP Logging & Request Correlation Tests', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should attach x-request-id header to every HTTP response', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    const reqId = response.headers['x-request-id'];
    expect(reqId).toBeDefined();
    expect(typeof reqId).toBe('string');
    expect((reqId as string).startsWith('req_')).toBe(true);
  });

  it('should preserve valid incoming x-request-id header', async () => {
    const customId = 'trace-id-12345_custom';
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: {
        'x-request-id': customId,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-request-id']).toBe(customId);
  });

  it('should sanitize and replace malicious log-injection x-request-id header', async () => {
    const injectionId = 'malicious\r\nINJECTED_HEADER: true\n';
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: {
        'x-request-id': injectionId,
      },
    });

    expect(response.statusCode).toBe(200);
    const reqId = response.headers['x-request-id'] as string;
    expect(reqId).not.toBe(injectionId);
    expect(reqId.startsWith('req_')).toBe(true);
  });

  it('should include matching requestId in structured 404 and 400 error payloads', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/non-existent-api-endpoint',
    });

    expect(response.statusCode).toBe(404);
    const json = response.json();
    expect(json.requestId).toBeDefined();
    expect(json.requestId).toBe(response.headers['x-request-id']);
    expect(json.code).toBe('ROUTE_NOT_FOUND');
  });
});
