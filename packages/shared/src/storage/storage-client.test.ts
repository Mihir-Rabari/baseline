import { describe, it, expect } from 'vitest';
import { createStorageClient } from './storage-client.js';

describe('Storage Client Abstraction (@packages/shared)', () => {
  it('should initialize S3/MinIO StorageService with configuration', () => {
    const storage = createStorageClient({
      endpoint: 'http://localhost:9000',
      bucket: 'test-bucket',
      accessKeyId: 'minioadmin',
      secretAccessKey: 'minioadmin',
      forcePathStyle: true,
    });

    expect(storage).toBeDefined();
    expect(typeof storage.upload).toBe('function');
    expect(typeof storage.get).toBe('function');
    expect(typeof storage.delete).toBe('function');
    expect(typeof storage.exists).toBe('function');
    expect(typeof storage.getUrl).toBe('function');
    expect(typeof storage.getUploadSignedUrl).toBe('function');
    expect(typeof storage.healthCheck).toBe('function');
  });

  it('should handle unreachable storage endpoint gracefully in healthCheck', async () => {
    const storage = createStorageClient({
      endpoint: 'http://127.0.0.1:59998',
      bucket: 'unreachable-bucket',
    });

    const result = await storage.healthCheck();
    expect(result.status).toBe('error');
    expect(result.error).toBeDefined();
  });
});
