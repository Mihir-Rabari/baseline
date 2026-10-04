import { ApiError } from '@/lib/api-client';

/** Retry transient failures only; 4xx (401/403/404/422...) will not change on retry. */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 408 && error.statusCode !== 429) {
    return false;
  }
  return failureCount < 2;
}
