import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { getEnv } from '@packages/config/env';
import { buildApp } from '../../../apps/api/src/app.js';
import { isDatabaseAvailable } from '../../../apps/api/src/test-support/database.js';

/**
 * Regression (Rule T2/T3): a session is cached in Redis together with the user's status.
 * Suspending or disabling an account must kill that live session immediately, with no
 * manual cache eviction, or the user keeps authenticated access until the cache TTL.
 */
describe('Account status changes invalidate live sessions', () => {
  let app: FastifyInstance;
  let hasDatabase = false;
  const env = getEnv();
  const password = 'Password123!';

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
    hasDatabase = await isDatabaseAvailable();
  });

  afterAll(async () => {
    await app.close();
  });

  const cookieOf = (res: { cookies: { name: string; value: string }[] }) => {
    const c = res.cookies.find((x) => x.name === env.SESSION_COOKIE_NAME);
    if (!c) throw new Error('no session cookie in response');
    return { [env.SESSION_COOKIE_NAME]: c.value };
  };

  async function login(email: string, pw: string) {
    return app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: pw } });
  }

  async function setup() {
    const email = `status-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    const signup = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email, password, name: 'Status Victim' },
    });
    expect(signup.statusCode).toBe(201);
    const userId = signup.json().user.id as string;

    const adminLogin = await login(env.INITIAL_ROOT_EMAIL, env.INITIAL_ROOT_PASSWORD);
    expect(adminLogin.statusCode).toBe(200);

    const victimCookies = cookieOf(signup);
    const adminCookies = cookieOf(adminLogin);

    // Warm the Redis cache for the victim's session while ACTIVE.
    const warm = await app.inject({ method: 'GET', url: '/api/v1/auth/session', cookies: victimCookies });
    expect(warm.statusCode, warm.body).toBe(200);

    const setStatus = (status: string) =>
      app.inject({
        method: 'PATCH',
        url: `/api/v1/iam/users/${userId}/status`,
        cookies: adminCookies,
        payload: { status },
      });
    const whoami = () =>
      app.inject({ method: 'GET', url: '/api/v1/auth/session', cookies: victimCookies });

    return { email, setStatus, whoami };
  }

  for (const status of ['SUSPENDED', 'DISABLED'] as const) {
    it(`${status} user's existing session cookie is rejected immediately`, async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const { email, setStatus, whoami } = await setup();

      const res = await setStatus(status);
      expect(res.statusCode).toBe(200);

      const after = await whoami();
      expect(after.statusCode).toBe(401);

      // Fresh login is also refused while the account is not ACTIVE.
      const relogin = await login(email, password);
      expect(relogin.statusCode).toBe(403);
    });
  }

  it('reactivation restores access through a fresh login, not the revoked session', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const { email, setStatus, whoami } = await setup();

    expect((await setStatus('SUSPENDED')).statusCode).toBe(200);
    expect((await whoami()).statusCode).toBe(401);

    expect((await setStatus('ACTIVE')).statusCode).toBe(200);
    // The old session stays dead: suspension revoked it.
    expect((await whoami()).statusCode).toBe(401);

    const relogin = await login(email, password);
    expect(relogin.statusCode).toBe(200);
    const ok = await app.inject({ method: 'GET', url: '/api/v1/auth/session', cookies: cookieOf(relogin) });
    expect(ok.statusCode).toBe(200);
  });
});
