# Backend Gateway (`apps/api`) — Subtree Operating Manual

> **Scope**: Fastify HTTP gateway, routing architecture, runtime input validation, OpenAPI generation, structured logging, and API route contract testing.

---

## 1. Subtree Architecture & Conventions

1. **Framework & Type Provider**:
   - Built on Fastify with `fastify-type-provider-zod`.
   - Every route plugin must be typed with `FastifyPluginAsyncZod`.

2. **Route Registration Pattern**:
   ```typescript
   import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
   import { z } from 'zod';
   import { requirePermission } from '@packages/iam';
   import { HttpErrorResponseSchema } from '@packages/validation';

   export const exampleRoutes: FastifyPluginAsyncZod = async (fastify) => {
     fastify.get(
       '/items/:id',
       {
         preHandler: [requirePermission('items:read')],
         schema: {
           tags: ['Items'],
           params: z.object({ id: z.string().uuid() }),
           response: {
             200: z.object({ id: z.string(), name: z.string() }),
             400: HttpErrorResponseSchema,
             401: HttpErrorResponseSchema,
             403: HttpErrorResponseSchema,
             404: HttpErrorResponseSchema,
           },
         },
       },
       async (request, reply) => {
         request.log.info({ itemId: request.params.id }, 'Item retrieved');
         return reply.send({ id: request.params.id, name: 'Sample Item' });
       }
     );
   };
   ```

3. **Structured Logging & Correlation**:
   - Always log with `request.log.info(...)` or the shared `logger` from `@packages/shared`.
   - Never use `console.log` or log raw passwords, tokens, or cookie headers.
   - Every request is correlated by the sanitized `x-request-id` header.

4. **Error Handling**:
   - All errors must return a sanitized `HttpErrorResponse` matching the OpenAPI error schema with `requestId` included.
   - Never expose database connection strings or stack traces to clients.

5. **Testing Expectations**:
   - Test every route with Fastify `app.inject()` covering 400 (validation), 401 (unauthenticated), 403 (unauthorized), and success shapes.
