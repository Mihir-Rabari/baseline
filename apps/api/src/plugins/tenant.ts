import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { DEFAULT_TENANT_ID } from '@packages/db';
import { TenantDirectory, normalizeHost } from '../services/tenant-directory.js';
import { systemDnsVerifier, type DnsVerifier } from '../lib/dns-verifier.js';

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * The tenant (club) this request belongs to. Every club-owned query must be scoped by it.
     * Resolved from the request host (see `requestHost`); the default tenant on local hosts.
     */
    tenantId: string;
  }
  interface FastifyInstance {
    tenantDirectory: TenantDirectory;
    /** Replaceable in tests so domain verification never touches the network. */
    dnsVerifier: DnsVerifier;
  }
}

/** Paths that must answer on any host: probes and docs. */
const HOST_FREE = /^\/(health|metrics|api\/docs)(\/|$)/;

/**
 * The host a request is for. Our own web app sends `x-tenant-host` (the browser's host, since the API
 * lives on another origin); behind a trusted proxy `x-forwarded-host` is honoured; otherwise `Host`.
 * `hinted` says the host was named explicitly rather than being the API's own address.
 * The header is a routing hint only: sessions are bound to a tenant, so naming another tenant's host
 * never grants access to its data.
 */
export function requestHost(request: FastifyRequest, trustProxy: boolean): { host: string; hinted: boolean } {
  const hint = request.headers['x-tenant-host'];
  if (typeof hint === 'string' && hint.trim()) return { host: normalizeHost(hint), hinted: true };
  const forwarded = request.headers['x-forwarded-host'];
  if (trustProxy && typeof forwarded === 'string' && forwarded.trim()) return { host: normalizeHost(forwarded), hinted: true };
  return { host: normalizeHost(request.headers.host), hinted: false };
}

async function tenantPlugin(fastify: FastifyInstance) {
  const env = fastify.env;
  const trustProxy = env.TRUST_PROXY.trim().toLowerCase() !== 'false' && env.TRUST_PROXY.trim() !== '';
  const directory = new TenantDirectory(fastify.db, env.PLATFORM_DOMAIN);
  fastify.decorate('tenantDirectory', directory);
  fastify.decorate('dnsVerifier', systemDnsVerifier);
  fastify.decorateRequest('tenantId', DEFAULT_TENANT_ID);

  const production = env.NODE_ENV === 'production';
  fastify.addHook('onRequest', async (request, reply) => {
    // Preflights carry no tenant hint; the real request that follows is checked.
    if (request.method === 'OPTIONS' || HOST_FREE.test(request.url)) return;
    const { host, hinted } = requestHost(request, trustProxy);
    const resolved = await directory.resolve(host);
    if (!resolved) {
      // A plain Host that matches no club is the API's own address, so it uses the default tenant.
      // An explicit tenant host (our web app, or a trusted proxy) that matches no club is refused in
      // production; local development and tests always fall back to the default tenant.
      if (production && hinted) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'No club is served at this address.',
          code: 'TENANT_NOT_FOUND',
          requestId: request.id,
          timestamp: new Date().toISOString(),
        });
      }
      request.tenantId = DEFAULT_TENANT_ID;
      return;
    }
    if (resolved.status === 'SUSPENDED') {
      return reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: 'This club is suspended.',
        code: 'TENANT_SUSPENDED',
        requestId: request.id,
        timestamp: new Date().toISOString(),
      });
    }
    request.tenantId = resolved.tenantId;
  });
}

export default fp(tenantPlugin, { name: 'app-tenant', dependencies: ['app-config', 'app-services'] });
