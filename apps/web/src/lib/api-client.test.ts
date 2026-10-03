import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchApi, ApiError } from './api-client.js';

describe('Web API Client (@app/web)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should construct ApiError with code and status', () => {
    const err = new ApiError('Not found', 404, 'NOT_FOUND', { id: '123' }, 'req-999');
    expect(err.message).toBe('Not found');
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.requestId).toBe('req-999');
  });

  it('should parse successful JSON responses', async () => {
    const mockData = { status: 'ok', version: '1.0.0' };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: (header: string) => (header === 'content-type' ? 'application/json' : null),
      },
      json: async () => mockData,
    });

    const result = await fetchApi('/health');
    expect(result).toEqual(mockData);
  });

  it('should throw ApiError with structured details on API failure', async () => {
    const errorBody = {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Email invalid',
      details: [{ field: 'email', message: 'Invalid format' }],
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      headers: {
        get: (header: string) => (header === 'content-type' ? 'application/json' : null),
      },
      json: async () => errorBody,
    });

    await expect(fetchApi('/invalid')).rejects.toThrow('Email invalid');
  });
});
