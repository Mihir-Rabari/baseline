import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { DEFAULT_TENANT_ID, enterTenant } from '@packages/db';
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

  /** The club for this request, or null once a refusal has been sent. */
  async function resolveTenantId(request: FastifyRequest, reply: FastifyReply): Promise<string | null> {
    const { host, hinted } = requestHost(request, trustProxy);
    const resolved = await directory.resolve(host);
    if (!resolved) {
      // A plain Host that matches no club is the API's own address, so it uses the default tenant.
      // An explicit tenant host (our web app, or a trusted proxy) that matches no club is refused in
      // production; local development and tests always fall back to the default tenant.
      if (production && hinted) {
        await reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'No club is served at this address.',
          code: 'TENANT_NOT_FOUND',
          requestId: request.id,
          timestamp: new Date().toISOString(),
        });
        return null;
      }
      return DEFAULT_TENANT_ID;
    }
    if (resolved.status === 'SUSPENDED') {
      await reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: 'This club is suspended.',
        code: 'TENANT_SUSPENDED',
        requestId: request.id,
        timestamp: new Date().toISOString(),
      });
      return null;
    }
    return resolved.tenantId;
  }

  // Callback style on purpose: the rest of the request lifecycle (auth, validation, the handler and
  // every database statement they issue) must run INSIDE the club's database scope, which only works
  // when the next hook is invoked from within `enterTenant`.
  fastify.addHook('onRequest', (request, reply, done) => {
    // Preflights carry no tenant hint; the real request that follows is checked.
    if (request.method === 'OPTIONS' || HOST_FREE.test(request.url)) return done();
    resolveTenantId(request, reply).then(
      (tenantId) => {
        if (tenantId === null) return; // a refusal was sent
        request.tenantId = tenantId;
        enterTenant(tenantId, done);
      },
      (error: unknown) => done(error as Error)
    );
  });
}

export default fp(tenantPlugin, { name: 'app-tenant', dependencies: ['app-config', 'app-services'] });
