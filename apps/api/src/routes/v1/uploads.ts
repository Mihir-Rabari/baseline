import { randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { PolicyEngine, type IamService } from '@packages/iam';
import { HttpErrorResponseSchema, ImageUploadResponseSchema, UploadKindEnum, type UploadKind } from '@packages/validation';
import { DomainError } from '../../lib/domain-error.js';
import { EXT_CONTENT_TYPE, IMAGE_CONTENT_TYPES, MAX_IMAGE_BYTES, detectImage } from '../../lib/images.js';

const err = HttpErrorResponseSchema;

/** Who may upload which kind of image. Every entry is a permission set that must all be held. */
const KIND_PERMISSIONS: Record<UploadKind, string[]> = {
  product: ['products:update'],
  menu: ['bar:manage', 'reports:read'],
  court: ['courts:update'],
  club: ['courts:update'],
  employee: ['hr:manage'],
  avatar: ['profile:update:self'],
};

const FILE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/;

function deny(request: FastifyRequest, reply: FastifyReply, status: 401 | 403) {
  return reply.status(status).send({
    statusCode: status,
    error: status === 401 ? 'Unauthorized' : 'Forbidden',
    message: status === 401 ? 'Authentication required to access this resource' : 'You do not have permission to upload this kind of image',
    code: status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN',
    requestId: request.id,
    timestamp: new Date().toISOString(),
  });
}

async function holdsAll(request: FastifyRequest, actions: string[]): Promise<boolean> {
  if (!request.user) return false;
  if (!request.effectiveStatements) {
    const iam = (request.server as unknown as { iamService: IamService }).iamService;
    request.effectiveStatements = await iam.getUserStatements(request.user.id);
  }
  return actions.every(
    (action) => PolicyEngine.evaluate({ identity: request.user!, action, statements: request.effectiveStatements!, context: { resourceOwnerId: request.user!.id } }).allowed
  );
}

/**
 * Image uploads go through the storage abstraction. The body is the raw image (no multipart), the type
 * is decided from the file's own bytes, and files are served back by a path that cannot escape the
 * upload prefix.
 */
export const uploadRoutes: FastifyPluginAsyncZod = async (fastify) => {
  // Raw image bodies. Anything larger than the limit is rejected by Fastify before it is read in full.
  for (const type of IMAGE_CONTENT_TYPES) {
    fastify.addContentTypeParser(type, { parseAs: 'buffer', bodyLimit: MAX_IMAGE_BYTES }, (_req, body, done) => done(null, body));
  }

  fastify.post(
    '/uploads/:kind',
    {
      bodyLimit: MAX_IMAGE_BYTES,
      preHandler: [
        async (request: FastifyRequest, reply: FastifyReply) => {
          if (!request.user) return deny(request, reply, 401);
          const kind = UploadKindEnum.safeParse((request.params as { kind?: string }).kind);
          if (!kind.success) return; // the schema reports the bad kind as 400
          if (!(await holdsAll(request, KIND_PERMISSIONS[kind.data]))) return deny(request, reply, 403);
        },
      ],
      schema: {
        description: 'Upload one image (JPEG, PNG or WebP, at most 5 MB) as the raw request body. Returns the URL to store on the record.',
        tags: ['Uploads'],
        params: z.object({ kind: UploadKindEnum }),
        response: { 201: ImageUploadResponseSchema, 400: err, 401: err, 403: err, 413: err, 415: err, 422: err },
      },
    },
    async (request, reply) => {
      const body = request.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        throw new DomainError('UNSUPPORTED_MEDIA_TYPE', 415, 'Send the image as a JPEG, PNG or WebP file.');
      }
      if (body.length > MAX_IMAGE_BYTES) throw new DomainError('PAYLOAD_TOO_LARGE', 413, 'Images can be at most 5 MB.');
      const detected = detectImage(body);
      if (!detected) throw new DomainError('INVALID_IMAGE', 422, 'That file is not a JPEG, PNG or WebP image.');
      const declared = String(request.headers['content-type'] ?? '').split(';')[0].trim();
      if (declared !== detected.contentType) {
        throw new DomainError('INVALID_IMAGE', 422, 'The file contents do not match the declared image type.');
      }
      const file = `${randomUUID()}.${detected.ext}`;
      const key = `${request.params.kind}/${file}`;
      await fastify.storage.upload(key, body, {
        contentType: detected.contentType,
        metadata: { uploader: request.user!.id },
      });
      request.log.info({ kind: request.params.kind, key, bytes: body.length, actorId: request.user!.id }, 'Image uploaded');
      return reply.status(201).send({ url: `/api/v1/media/${key}`, key, contentType: detected.contentType, size: body.length });
    }
  );

  // Public: product photos and the club logo appear on the website for signed-out visitors.
  fastify.get(
    '/media/:kind/:file',
    {
      schema: {
        description: 'An uploaded image.',
        tags: ['Uploads'],
        params: z.object({ kind: UploadKindEnum, file: z.string().regex(FILE_PATTERN) }),
        response: { 400: err, 404: err },
      },
    },
    async (request, reply) => {
      const { kind, file } = request.params;
      const bytes = await fastify.storage.get(`${kind}/${file}`);
      if (!bytes) throw new DomainError('NOT_FOUND', 404, 'Image not found.');
      const ext = file.slice(file.lastIndexOf('.') + 1) as keyof typeof EXT_CONTENT_TYPE;
      return reply
        .header('content-type', EXT_CONTENT_TYPE[ext])
        .header('cache-control', 'public, max-age=31536000, immutable')
        .header('x-content-type-options', 'nosniff')
        .header('content-security-policy', "default-src 'none'; sandbox")
        .header('cross-origin-resource-policy', 'cross-origin')
        .send(bytes as never);
    }
  );
};
