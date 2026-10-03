import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { shouldRetryQuery } from './query-retry';

describe('shouldRetryQuery (regression #75: no retry loop on 403)', () => {
  it('never retries authorization / client errors', () => {
    for (const status of [400, 401, 403, 404, 422]) expect(shouldRetryQuery(0, new ApiError('no', status))).toBe(false);
  });
  it('retries transient errors a bounded number of times', () => {
    expect(shouldRetryQuery(0, new ApiError('down', 503))).toBe(true);
    expect(shouldRetryQuery(0, new ApiError('slow', 408))).toBe(true);
    expect(shouldRetryQuery(2, new ApiError('down', 503))).toBe(false);
    expect(shouldRetryQuery(0, new Error('boom'))).toBe(true);
  });
});
