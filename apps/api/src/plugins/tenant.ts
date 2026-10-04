import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { DEFAULT_TENANT_ID } from '@packages/db';

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * The tenant (club) this request belongs to. Every club-owned query must be scoped by it.
     * For now it is always the default tenant; the control-plane work replaces this with
     * resolution from the Host header without changing the field's name or type.
     */
    tenantId: string;
  }
}

async function tenantPlugin(fastify: FastifyInstance) {
  fastify.decorateRequest('tenantId', DEFAULT_TENANT_ID);
}

export default fp(tenantPlugin, { name: 'tenant-plugin' });
