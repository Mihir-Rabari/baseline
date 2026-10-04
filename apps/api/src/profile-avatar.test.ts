import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { deflateSync } from 'node:zlib';
import { profileAvatarRoutes } from './routes/v1/profile-avatar.js';
import { normalizeAvatarPng } from './lib/avatar-png.js';
import { DEFAULT_TENANT_ID } from '@packages/db';

const userId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
function chunk(type: string, data: Buffer) {
  const body = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length); body.copy(result, 4); result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}
function png(width = 1, height = 1, rows = Buffer.from([0, 10, 20, 30, 255])) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
const image = png();
const payload = { imageBase64: image.toString('base64') };

describe('Private profile avatar routes', () => {
  let app: FastifyInstance;
  let stored: Buffer | null;
  const storage = { get: vi.fn(), upload: vi.fn(), delete: vi.fn(), ensureBucketExists: vi.fn() };
  beforeEach(async () => {
    vi.resetAllMocks(); stored = null;
    storage.get.mockImplementation(async () => stored);
    storage.upload.mockImplementation(async (_key, bytes) => { stored = bytes; return { key: _key, bucket: 'test' }; });
    storage.delete.mockImplementation(async () => { stored = null; return true; });
    storage.ensureBucketExists.mockResolvedValue(undefined);
    app = Fastify(); app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
    app.decorate('storage', storage); app.decorate('iamService', { getUserStatements: async () => [] });
    app.decorateRequest('tenantId', DEFAULT_TENANT_ID);
    app.addHook('onRequest', async (request) => {
      const actor = request.headers['x-test-actor'];
      // Controlled authentication double: absent/expired sessions have no identity.
      if (!actor || actor === 'expired') return;
      request.user = { id: userId, email: 'photo@example.com', name: 'Photo', status: actor === 'suspended' ? 'SUSPENDED' : actor === 'disabled' ? 'DISABLED' : 'ACTIVE', identityType: actor === 'root' ? 'ROOT' : 'EXTERNAL_USER' } as typeof request.user;
      request.effectiveStatements = actor === 'no-permission' ? [] : [{ effect: 'allow', actions: ['profile:read:self', 'profile:update:self'], resources: ['*'] }];
      if (actor === 'deny') request.effectiveStatements.push({ effect: 'deny', actions: ['profile:update:self'], resources: ['*'] });
    });
    await app.register(swagger, { openapi: { info: { title: 'Avatar test', version: '1' }, components: { securitySchemes: { CookieAuth: { type: 'apiKey', in: 'cookie', name: 'app_session' } } } }, transform: jsonSchemaTransform });
    await app.register(profileAvatarRoutes, { prefix: '/api/v1' }); await app.ready();
  });
  afterEach(async () => { await app.close(); });
  const headers = { 'x-test-actor': 'member' };

  it('stores, reads, versions and removes an owned photo using private storage', async () => {
    expect((await app.inject({ url: '/api/v1/profile/avatar', headers })).json()).toEqual({ version: null });
    const uploaded = await app.inject({ method: 'PUT', url: '/api/v1/profile/avatar', headers, payload });
    expect(uploaded.statusCode).toBe(200); expect(uploaded.json().version).toMatch(/^[a-f0-9]{64}$/);
    expect(storage.upload).toHaveBeenCalledWith(`tenants/${DEFAULT_TENANT_ID}/profiles/${userId}/avatar.png`, image, { contentType: 'image/png' });
    expect((await app.inject({ url: '/api/v1/profile/avatar', headers })).json()).toEqual(uploaded.json());
    const downloaded = await app.inject({ url: `/api/v1/profile/avatar/${userId}`, headers });
    expect(downloaded.statusCode).toBe(200); expect(downloaded.rawPayload).toEqual(image);
    expect(downloaded.headers['content-type']).toBe('image/png');
    expect(downloaded.headers['cache-control']).toBe('private, no-store'); expect(downloaded.headers['x-content-type-options']).toBe('nosniff');
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/profile/avatar', headers })).json()).toEqual({ success: true });
  });
  it.each(['GET', 'PUT', 'DELETE'] as const)('requires authentication and permissions for %s', async (method) => {
    for (const [actor, status] of [[undefined, 401], ['expired', 401], ['no-permission', 403], ['suspended', 403], ['disabled', 403]] as const) {
      const response = await app.inject({ method, url: '/api/v1/profile/avatar', headers: actor ? { 'x-test-actor': actor } : {}, ...(method === 'PUT' ? { payload } : {}) });
      expect(response.statusCode).toBe(status);
    }
    expect(storage.get).not.toHaveBeenCalled(); expect(storage.upload).not.toHaveBeenCalled(); expect(storage.delete).not.toHaveBeenCalled();
  });
  it('denies cross-account photo reads and honors ROOT authority', async () => {
    expect((await app.inject({ url: `/api/v1/profile/avatar/${userId}` })).statusCode).toBe(401);
    expect((await app.inject({ url: `/api/v1/profile/avatar/${otherId}`, headers })).statusCode).toBe(403);
    expect(storage.get).not.toHaveBeenCalled(); stored = image;
    expect((await app.inject({ url: `/api/v1/profile/avatar/${otherId}`, headers: { 'x-test-actor': 'root' } })).statusCode).toBe(200);
  });
  it('rejects explicit DENY before any storage write', async () => {
    expect((await app.inject({ method: 'PUT', url: '/api/v1/profile/avatar', headers: { 'x-test-actor': 'deny' }, payload })).statusCode).toBe(403);
    expect(storage.upload).not.toHaveBeenCalled();
  });
  it('validates parameters and rejects client-controlled keys or owners', async () => {
    expect((await app.inject({ url: '/api/v1/profile/avatar/not-a-uuid', headers })).statusCode).toBe(400);
    for (const bad of [{ ...payload, userId: otherId }, { ...payload, key: 'other/photo' }, { imageBase64: '<svg/>' }, { imageBase64: Buffer.alloc(256 * 1024 + 1).toString('base64') }]) {
      expect((await app.inject({ method: 'PUT', url: '/api/v1/profile/avatar', headers, payload: bad })).statusCode).toBe(400);
    }
    expect(storage.upload).not.toHaveBeenCalled();
  });
  it('rejects corrupt, oversized-dimension, truncated and invalid scanline PNGs before writes', async () => {
    const corrupt = Buffer.from(image); corrupt[corrupt.length - 1] ^= 1;
    for (const invalid of [corrupt, image.subarray(0, 40), png(513), png(1, 1, Buffer.from([5, 0, 0, 0, 255])), Buffer.from('<svg/>')]) {
      expect((await app.inject({ method: 'PUT', url: '/api/v1/profile/avatar', headers, payload: { imageBase64: invalid.toString('base64') } })).statusCode).toBe(400);
    }
    expect(storage.upload).not.toHaveBeenCalled();
  });
  it('returns a missing photo as 404', async () => {
    expect((await app.inject({ url: `/api/v1/profile/avatar/${userId}`, headers })).statusCode).toBe(404);
  });
  it.each(['get', 'upload', 'delete', 'ensureBucketExists'] as const)('sanitizes %s storage failures', async (operation) => {
    storage[operation].mockRejectedValueOnce(new Error('secret-access-key private-endpoint'));
    const method = operation === 'get' ? 'GET' : operation === 'delete' ? 'DELETE' : 'PUT';
    const response = await app.inject({ method, url: '/api/v1/profile/avatar', headers, ...(method === 'PUT' ? { payload } : {}) });
    expect(response.statusCode).toBe(503); expect(response.body).not.toContain('secret-access-key'); expect(response.json().requestId).toBeTruthy();
  });
  it('handles StorageService delete false as unavailable', async () => {
    storage.delete.mockResolvedValueOnce(false);
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/profile/avatar', headers })).statusCode).toBe(503);
  });
  it('documents the upload and private download contracts in OpenAPI', () => {
    const spec = app.swagger();
    expect(spec.paths?.['/api/v1/profile/avatar']?.put?.responses?.['200']).toBeTruthy();
    expect(spec.paths?.['/api/v1/profile/avatar/{userId}']?.get?.responses?.['403']).toBeTruthy();
    const download = spec.paths?.['/api/v1/profile/avatar/{userId}']?.get;
    expect(download?.security).toEqual([{ CookieAuth: [] }]);
    expect(download?.responses?.['200']).toMatchObject({ content: { 'image/png': { schema: { type: 'string', format: 'binary' } } } });
  });
  it('strips ancillary PNG metadata while preserving the image', () => {
    const metadata = chunk('tEXt', Buffer.from('Comment\0private metadata'));
    const withMetadata = Buffer.concat([image.subarray(0, 33), metadata, image.subarray(33)]);
    expect(normalizeAvatarPng(withMetadata)).toEqual(image);
  });
  it('rejects trailing compressed data, animation chunks and invalid reserved chunk bytes', () => {
    const header = image.subarray(0, 33);
    const trailer = chunk('IEND', Buffer.alloc(0));
    const data = chunk('IDAT', Buffer.concat([deflateSync(Buffer.from([0, 1, 2, 3, 4])), Buffer.from('junk')]));
    expect(normalizeAvatarPng(Buffer.concat([header, data, trailer]))).toBeNull();
    expect(normalizeAvatarPng(Buffer.concat([header, chunk('acTL', Buffer.alloc(8)), image.subarray(33)]))).toBeNull();
    expect(normalizeAvatarPng(Buffer.concat([header, chunk('test', Buffer.alloc(0)), image.subarray(33)]))).toBeNull();
  });
  it('rejects noncanonical base64 padding bits without storing an image', async () => {
    const canonical = image.toString('base64');
    // This PNG ends in padding; alter unused low bits of its final symbol.
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const position = canonical.length - (canonical.endsWith('==') ? 3 : 2);
    const changed = canonical.slice(0, position) + alphabet[alphabet.indexOf(canonical[position]) + 1] + canonical.slice(position + 1);
    expect(Buffer.from(changed, 'base64')).toEqual(image);
    expect((await app.inject({ method: 'PUT', url: '/api/v1/profile/avatar', headers, payload: { imageBase64: changed } })).statusCode).toBe(400);
    expect(storage.upload).not.toHaveBeenCalled();
  });
});
