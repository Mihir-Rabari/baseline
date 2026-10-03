import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { getEnv } from '@packages/config/env';
import { createStorageClient } from './storage-client.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const docker = promisify(execFile);
const compose = await readFile(join(root, 'docker-compose.yml'), 'utf8');

describe('MinIO Compose configuration', () => {
  it('uses the available GHCR image for both server and bundled client', () => {
    expect(compose.match(/image: ghcr\.io\/coollabsio\/minio:latest/g)).toHaveLength(2);
    expect(compose).not.toMatch(/image: (?:quay\.io\/)?minio\/(?:minio|mc):/);
  });

  it('propagates initializer failures and checks the bucket before reporting healthy', () => {
    const init = compose.split('  minio-init:')[1].split('  prometheus:')[0];
    expect(init).toContain('- -ec');
    expect(init).not.toContain('exit 0');
    expect(init).toContain('"$${MINIO_INIT_ACCESS_KEY}" "$${MINIO_INIT_SECRET_KEY}"');
    expect(init).toContain('mb --ignore-existing "local/$${MINIO_INIT_BUCKET}"');
    expect(init).toContain('exec sleep infinity');
    expect(init).toContain('mc stat "local/$${MINIO_INIT_BUCKET}"');
  });
});

interface ComposeService {
  container_name?: string;
  ports?: Array<{ target: number; published?: string; host_ip?: string }>;
  environment?: Record<string, string>;
}
interface ComposeConfig {
  name: string;
  services: Record<string, ComposeService>;
  volumes: Record<string, { name: string }>;
  networks: Record<string, { name: string }>;
}

// Opt-in: pulls the GHCR image and creates only uniquely named disposable resources.
describe.skipIf(process.env.RUN_STORAGE_SMOKE !== 'true')('MinIO Docker regression (issue #6)', () => {
  it('starts with --wait, survives initialization twice, rejects bad credentials and supports S3 operations', async () => {
    const project = `baseline-storage-${randomUUID().replaceAll('-', '')}`;
    const directory = await mkdtemp(join(tmpdir(), project));
    const file = join(directory, 'compose.json');
    let provisioned = false;
    const accessKey = 'storage-smoke';
    // Include shell metacharacters to catch unsafe interpolation into the initializer script.
    const secretKey = 'smoke-test-$literal;quote"value';
    const bucket = 'storage-smoke';
    const run = (args: string[]) => docker('docker', ['compose', '-p', project, '-f', file, ...args], {
      cwd: root, timeout: 90_000, maxBuffer: 1024 * 1024,
    });
    try {
      const { stdout } = await docker('docker', ['compose', '--env-file', '.env.example', 'config', '--format', 'json'], { cwd: root });
      const config = JSON.parse(stdout) as ComposeConfig;
      config.name = project;
      config.services = Object.fromEntries(Object.entries(config.services).filter(([name]) => ['minio', 'minio-init'].includes(name)));
      for (const service of Object.values(config.services)) delete service.container_name;
      config.services.minio.ports = [{ target: 9000, published: '0', host_ip: '127.0.0.1' }];
      // The generated config is parsed by Compose again; preserve literal dollar signs.
      const composeSecret = secretKey.replaceAll('$', '$$$$');
      config.services.minio.environment = { MINIO_ROOT_USER: accessKey, MINIO_ROOT_PASSWORD: composeSecret };
      config.services['minio-init'].environment = {
        MINIO_INIT_ACCESS_KEY: accessKey, MINIO_INIT_SECRET_KEY: composeSecret, MINIO_INIT_BUCKET: bucket,
      };
      config.volumes = { minio_data: { name: `${project}-data` } };
      config.networks = { app_network: { name: `${project}-network` } };
      await writeFile(file, JSON.stringify(config));
      provisioned = true;
      await run(['up', '-d', '--wait', '--wait-timeout', '60']);
      await run(['up', '-d', '--force-recreate', '--wait', '--wait-timeout', '60', 'minio-init']);
      const rejected = await run(['run', '--rm', '--no-deps', '-e', 'MINIO_INIT_SECRET_KEY=incorrect-password', 'minio-init'])
        .then(() => null, (error: { code: number; stdout: string; stderr: string }) => error);
      expect(rejected?.code).toBe(1);
      expect(`${rejected?.stdout} ${rejected?.stderr}`).toMatch(/signature|access denied|access key/i);

      const address = (await run(['port', 'minio', '9000'])).stdout.trim();
      const env = getEnv({ NODE_ENV: 'test', S3_ENDPOINT: `http://${address}`, S3_ACCESS_KEY: accessKey, S3_SECRET_KEY: secretKey, S3_BUCKET: bucket });
      const storage = createStorageClient({
        endpoint: env.S3_ENDPOINT, region: env.S3_REGION, accessKeyId: env.S3_ACCESS_KEY,
        secretAccessKey: env.S3_SECRET_KEY, bucket: env.S3_BUCKET, forcePathStyle: env.S3_FORCE_PATH_STYLE,
      });
      try {
        expect((await storage.healthCheck()).status).toBe('ok');
        await storage.upload('regression.txt', 'issue-6-fixed');
        expect((await storage.get('regression.txt'))?.toString()).toBe('issue-6-fixed');
        const signed = await storage.getUrl('regression.txt');
        expect(await (await fetch(signed)).text()).toBe('issue-6-fixed');
        expect(await storage.delete('regression.txt')).toBe(true);
        expect(await storage.get('regression.txt')).toBeNull();
      } finally {
        storage.getClient().destroy();
      }
    } finally {
      try {
        if (provisioned) await run(['down', '-v']);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  }, 240_000);
});

