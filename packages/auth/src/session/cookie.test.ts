import { describe, it, expect } from 'vitest';
import { getSessionCookieOptions } from './cookie.js';

describe('Session Cookie Options', () => {
  it('should configure secure defaults for development', () => {
    const options = getSessionCookieOptions(false, 3600);

    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe('lax');
    expect(options.path).toBe('/');
    expect(options.secure).toBe(false);
    expect(options.maxAge).toBe(3600);
  });

  it('should enforce Secure flag in production environments', () => {
    const options = getSessionCookieOptions(true, 7200);

    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe('lax');
    expect(options.path).toBe('/');
    expect(options.secure).toBe(true);
    expect(options.maxAge).toBe(7200);
  });

  it('should default to 7-day TTL if duration is omitted', () => {
    const options = getSessionCookieOptions();

    expect(options.maxAge).toBe(7 * 24 * 60 * 60);
  });
});
