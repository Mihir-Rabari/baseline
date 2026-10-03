import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface StorageConfig {
  endpoint?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  bucket: string;
  forcePathStyle?: boolean;
  useSsl?: boolean;
}

export interface UploadOptions {
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface IStorageService {
  upload(key: string, body: Buffer | Uint8Array | string, options?: UploadOptions): Promise<{ key: string; bucket: string; eTag?: string }>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
  getUrl(key: string, expiresInSeconds?: number): Promise<string>;
  getUploadSignedUrl(key: string, contentType: string, expiresInSeconds?: number): Promise<string>;
  ensureBucketExists(): Promise<void>;
  healthCheck(): Promise<{ status: 'ok' | 'error'; latencyMs?: number; error?: string }>;
  getClient(): S3Client;
}

export class StorageService implements IStorageService {
  private client: S3Client;
  private bucket: string;

  constructor(config: StorageConfig) {
    this.bucket = config.bucket;

    const s3Config: S3ClientConfig = {
      region: config.region || 'us-east-1',
      forcePathStyle: config.forcePathStyle ?? true,
    };

    if (config.endpoint) {
      s3Config.endpoint = config.endpoint;
    }

    if (config.accessKeyId && config.secretAccessKey) {
      s3Config.credentials = {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      };
    }

    if (config.useSsl !== undefined) {
      s3Config.tls = config.useSsl;
    }

    this.client = new S3Client(s3Config);
  }

  public async upload(
    key: string,
    body: Buffer | Uint8Array | string,
    options?: UploadOptions
  ): Promise<{ key: string; bucket: string; eTag?: string }> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: typeof body === 'string' ? Buffer.from(body) : body,
      ContentType: options?.contentType || 'application/octet-stream',
      Metadata: options?.metadata,
    });

    const response = await this.client.send(command);
    return {
      key,
      bucket: this.bucket,
      eTag: response.ETag,
    };
  }

  public async get(key: string): Promise<Buffer | null> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      const response = await this.client.send(command);
      if (!response.Body) return null;
      const byteArray = await response.Body.transformToByteArray();
      return Buffer.from(byteArray);
    } catch (err: unknown) {
      if ((err as { name?: string }).name === 'NoSuchKey' || (err as { '$metadata'?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  public async delete(key: string): Promise<boolean> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      await this.client.send(command);
      return true;
    } catch {
      return false;
    }
  }

  public async exists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      await this.client.send(command);
      return true;
    } catch (err: unknown) {
      if ((err as { name?: string }).name === 'NotFound' || (err as { '$metadata'?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) {
        return false;
      }
      return false;
    }
  }

  public async getUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  public async getUploadSignedUrl(key: string, contentType: string, expiresInSeconds = 3600): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  public async ensureBucketExists(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (err: unknown) {
      const statusCode = (err as { '$metadata'?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (statusCode === 404 || (err as { name?: string }).name === 'NotFound' || (err as { name?: string }).name === 'NoSuchBucket') {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      } else {
        throw err;
      }
    }
  }

  public async healthCheck(): Promise<{ status: 'ok' | 'error'; latencyMs?: number; error?: string }> {
    const start = Date.now();
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return { status: 'ok', latencyMs: Date.now() - start };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return { status: 'error', latencyMs: Date.now() - start, error: errorMsg };
    }
  }

  public getClient(): S3Client {
    return this.client;
  }
}

export function createStorageClient(config: StorageConfig): StorageService {
  return new StorageService(config);
}
