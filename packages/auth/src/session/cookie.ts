export interface CookieOptions {
  name: string;
  maxAge: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  path: string;
}

/**
 * Builds the session cookie attributes.
 *
 * `sameSite` defaults to 'lax', which is correct when the web app and the API share a
 * site (the local Docker setup, and any deployment behind one domain). When they are on
 * different sites — app.example.com calling api.other.com — a lax cookie is simply not
 * sent on cross-site requests and authentication silently fails. Pass
 * `crossSite: true` in that case: it switches to `sameSite: 'none'`, which browsers
 * only honour on a Secure cookie, so it also forces `secure` on.
 */
export function getSessionCookieOptions(
  isProduction: boolean,
  ttlSeconds = 604800,
  cookieName = 'app_session',
  crossSite = false
): CookieOptions {
  return {
    name: cookieName,
    maxAge: ttlSeconds,
    httpOnly: true,
    secure: isProduction || crossSite,
    sameSite: crossSite ? 'none' : 'lax',
    path: '/',
  };
}
