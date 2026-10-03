import { describe, expect, it, vi } from 'vitest';
import { EmailService } from './email.service.js';
import { accountCreatedEmail, passwordResetEmail, welcomeMemberEmail } from './email-templates.js';

const KEY = 're_test_key_that_must_never_be_logged';
const message = { to: 'riya@vedlabs.tech', subject: 'Hello', html: '<p>Hi</p>', text: 'Hi' };

function service(overrides: Partial<ConstructorParameters<typeof EmailService>[0]> = {}) {
  const log = { info: vi.fn(), warn: vi.fn() };
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: 'email_123' }), { status: 200, headers: { 'content-type': 'application/json' } }));
  return { log, fetchImpl, svc: new EmailService({ apiKey: KEY, from: 'Club <noreply@vedlabs.tech>', enabled: true, fetchImpl: fetchImpl as unknown as typeof fetch, log, ...overrides }) };
}

describe('EmailService', () => {
  it('is off without a key or when the feature is off, and never calls the provider', async () => {
    for (const overrides of [{ apiKey: undefined }, { enabled: false }]) {
      const { svc, fetchImpl } = service(overrides);
      expect(svc.enabled).toBe(false);
      expect(await svc.send(message)).toEqual({ sent: false, reason: 'DISABLED' });
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it('rejects malformed addresses before anything else', async () => {
    const { svc, fetchImpl } = service();
    for (const to of ['', 'nope', 'a@b', 'two@@x.com', 'white space@x.com']) expect(await svc.send({ ...message, to })).toEqual({ sent: false, reason: 'INVALID_ADDRESS' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('skips reserved test domains so demo data never produces real mail', async () => {
    const { svc, fetchImpl } = service();
    for (const to of ['a@example.com', 'a@example.org', 'a@courtos.test', 'a@sub.example.net', 'a@x.invalid']) {
      expect(await svc.send({ ...message, to }), to).toEqual({ sent: false, reason: 'RESERVED_DOMAIN' });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(EmailService.isDeliverable('riya@vedlabs.tech')).toBe(true);
    expect(EmailService.isDeliverable('riya@gmail.com')).toBe(true);
  });

  it('posts the message to Resend with the key in the header only', async () => {
    const { svc, fetchImpl, log } = service();
    expect(await svc.send({ ...message, to: ' Riya@VedLabs.tech ' })).toEqual({ sent: true, id: 'email_123' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(init.body as string)).toEqual({ from: 'Club <noreply@vedlabs.tech>', to: ['riya@vedlabs.tech'], subject: 'Hello', html: '<p>Hi</p>', text: 'Hi' });
    expect(JSON.stringify([...log.info.mock.calls, ...log.warn.mock.calls])).not.toContain(KEY);
  });

  it('reports a provider rejection without throwing or leaking the key', async () => {
    const { svc, log, fetchImpl } = service();
    fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify({ name: 'validation_error', message: 'The domain is not verified' }), { status: 403 }));
    expect(await svc.send(message)).toEqual({ sent: false, reason: 'PROVIDER_ERROR' });
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ status: 403, providerMessage: 'The domain is not verified' }), expect.any(String));
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain(KEY);
  });

  it('turns a network failure into a failed result', async () => {
    const { svc, fetchImpl, log } = service();
    fetchImpl.mockRejectedValueOnce(new TypeError('fetch failed'));
    expect(await svc.send(message)).toEqual({ sent: false, reason: 'PROVIDER_ERROR' });
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain(KEY);
  });
});

describe('email templates', () => {
  const welcome = welcomeMemberEmail({ clubName: 'Baseline Sports Club', name: 'Riya Patel', loginEmail: 'riya@vedlabs.tech', setPasswordUrl: 'https://club.example/set-password?token=abc123', validHours: 72, planName: 'Silver' });

  it('the welcome email names the login, links to set a password and expires, but contains no password', () => {
    expect(welcome.subject).toContain('Baseline Sports Club');
    for (const body of [welcome.html, welcome.text]) {
      expect(body).toContain('riya@vedlabs.tech');
      expect(body).toContain('https://club.example/set-password?token=abc123');
      expect(body).toContain('72 hours');
      expect(body).toContain('Silver');
      expect(body.toLowerCase()).not.toMatch(/temporary password|your password is/);
    }
    expect(welcome.html).toContain('Welcome, Riya');
  });

  it('escapes anything a person typed so it cannot inject markup', () => {
    const mail = welcomeMemberEmail({ clubName: 'Club <b>', name: '<script>alert(1)</script> Eve', loginEmail: 'eve@vedlabs.tech', setPasswordUrl: 'https://x.example/?a=1&b="2"', validHours: 1, planName: '"><img src=x>' });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).not.toContain('<img src=x>');
    expect(mail.html).toContain('&lt;script&gt;');
    expect(mail.html).toContain('&amp;b=&quot;2&quot;');
  });

  it('account-created and reset emails link where they should', () => {
    const created = accountCreatedEmail({ clubName: 'C', name: 'A', loginEmail: 'a@vedlabs.tech', loginUrl: 'https://club.example/login', planName: 'Gold' });
    expect(created.html).toContain('https://club.example/login');
    expect(created.text).toContain('Gold');
    const reset = passwordResetEmail({ clubName: 'C', name: 'A', resetUrl: 'https://club.example/set-password?token=zzz', validMinutes: 60 });
    expect(reset.html).toContain('token=zzz');
    expect(reset.text).toContain('60 minutes');
    expect(reset.html).toContain('did not ask for this');
  });
});
