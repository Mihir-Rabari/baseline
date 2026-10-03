import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import cookie from '@fastify/cookie';
import { SessionManager } from '@packages/auth';

declare module 'fastify' {
  interface FastifyInstance {
    sessionManager: SessionManager;
  }
}

async function authPlugin(fastify: FastifyInstance) {
  const env = fastify.env;

  // 1. Register cookie support.
  //
  // SESSION_SECRET enables @fastify/cookie's signing support. The session cookie itself
  // is not signed and does not need to be: its value is a 256-bit random token that is
  // stored SHA-256-hashed server-side, so forging one means guessing the token, and a
  // signature would add nothing. The secret is registered here so that any *other*
  // cookie the application adds later can be signed with `{ signed: true }` without
  // further setup.
  await fastify.register(cookie, {
    secret: env.SESSION_SECRET,
    hook: 'onRequest',
  });

  // 2. Instantiate session manager
  const sessionManager = new SessionManager(fastify.db, fastify.redis, {
    sessionTtlSeconds: env.SESSION_TTL_SECONDS,
  });
  fastify.decorate('sessionManager', sessionManager);

  // 3. Global preHandler hook to resolve session from cookie
  fastify.addHook('preHandler', async (request: FastifyRequest, _reply: FastifyReply) => {
    const cookieName = env.SESSION_COOKIE_NAME;
    const sessionToken = request.cookies[cookieName];

    if (!sessionToken) {
      return;
    }

    try {
      const validation = await sessionManager.validateSession(sessionToken);
      if (validation.valid && validation.user && validation.session) {
        request.user = validation.user;
        request.session = validation.session;
      }
    } catch (err) {
      request.log.debug({ err }, 'Error resolving session cookie');
    }
  });
}

export default fp(authPlugin, {
  name: 'app-auth',
  dependencies: ['app-config', 'app-services'],
});
