import { describe, it, expect } from 'vitest';
import { createRedisClient } from './redis-client.js';

describe('Redis Client Abstraction (@packages/shared)', () => {
  it('should initialize RedisService without throwing', () => {
    const redis = createRedisClient({
      url: 'redis://localhost:6379' });

    expect(redis).toBeDefined();
    expect(typeof redis.connect).toBe('function');
    expect(typeof redis.get).toBe('function');
    expect(typeof redis.set).toBe('function');
    expect(typeof redis.delete).toBe('function');
    expect(typeof redis.exists).toBe('function');
    expect(typeof redis.healthCheck).toBe('function');
    expect(typeof redis.disconnect).toBe('function');
  });

  it('should handle offline connection errors cleanly in healthCheck', async () => {
    const redis = createRedisClient({
      host: '127.0.0.1',
      port: 59999, // Unreachable port
      connectTimeout: 200 });

    const result = await redis.healthCheck();
    expect(result.status).toBe('error');
    expect(result.error).toBeDefined();

    await redis.disconnect();
  });
});
