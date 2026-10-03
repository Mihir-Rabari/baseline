import { Redis, type RedisOptions } from 'ioredis';

export interface IRedisService {
  connect(): Promise<void>;
  get(key: string): Promise<string | null>;
  getJson<T>(key: string): Promise<T | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  setJson<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
  healthCheck(): Promise<{ status: 'ok' | 'error'; latencyMs?: number; error?: string }>;
  disconnect(): Promise<void>;
  getClient(): Redis;
}

export interface RedisConfig {
  url?: string;
  host?: string;
  port?: number;
  password?: string;
  maxRetriesPerRequest?: number;
  connectTimeout?: number;
}

export class RedisService implements IRedisService {
  private client: Redis;
  private isConnected = false;

  constructor(config: RedisConfig) {
    const options: RedisOptions = {
      lazyConnect: true,
      maxRetriesPerRequest: config.maxRetriesPerRequest ?? 3,
      connectTimeout: config.connectTimeout ?? 5000,
      retryStrategy(times) {
        // Exponential backoff with max 3000ms delay
        const delay = Math.min(times * 200, 3000);
        return delay;
      },
    };

    if (config.url) {
      this.client = new Redis(config.url, options);
    } else {
      this.client = new Redis({
        host: config.host ?? 'localhost',
        port: config.port ?? 6379,
        password: config.password || undefined,
        ...options,
      });
    }

    this.client.on('connect', () => {
      this.isConnected = true;
    });

    this.client.on('error', () => {
      // Don't crash process on unhandled connection error
      this.isConnected = false;
    });

    this.client.on('close', () => {
      this.isConnected = false;
    });
  }

  public isReady(): boolean {
    return this.isConnected && this.client.status === 'ready';
  }

  public async connect(): Promise<void> {
    if (this.client.status === 'ready' || this.client.status === 'connecting') {
      return;
    }
    try {
      await this.client.connect();
      this.isConnected = true;
    } catch (error) {
      this.isConnected = false;
      throw error;
    }
  }

  public async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  public async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  public async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds && ttlSeconds > 0) {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, value);
    }
  }

  public async setJson<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    await this.set(key, serialized, ttlSeconds);
  }

  public async delete(key: string): Promise<boolean> {
    const result = await this.client.del(key);
    return result > 0;
  }

  public async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key);
    return result > 0;
  }

  public async healthCheck(): Promise<{ status: 'ok' | 'error'; latencyMs?: number; error?: string }> {
    const start = Date.now();
    try {
      if (this.client.status !== 'ready') {
        await this.connect();
      }
      const pong = await this.client.ping();
      const latencyMs = Date.now() - start;
      if (pong === 'PONG') {
        return { status: 'ok', latencyMs };
      }
      return { status: 'error', latencyMs, error: `Unexpected ping response: ${pong}` };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return { status: 'error', latencyMs: Date.now() - start, error: errorMsg };
    }
  }

  public async disconnect(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    } finally {
      this.isConnected = false;
    }
  }

  public getClient(): Redis {
    return this.client;
  }
}

export function createRedisClient(config: RedisConfig): RedisService {
  return new RedisService(config);
}
