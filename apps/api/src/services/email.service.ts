import { EmailSchema } from '@packages/validation';

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export type SendResult = { sent: true; id: string | null } | { sent: false; reason: 'DISABLED' | 'INVALID_ADDRESS' | 'RESERVED_DOMAIN' | 'PROVIDER_ERROR' };

interface Logger {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
}

/** Domains reserved for documentation and tests (RFC 2606 and 6761). Mail to them can never be delivered. */
const RESERVED = /(^|\.)(example\.(com|org|net)|example|test|invalid|localhost)$/i;

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const TIMEOUT_MS = 8000;

/**
 * Sends transactional email through Resend's HTTP API.
 *
 * It never throws and never blocks a request on a failure: callers get a result they may ignore.
 * It is off unless an API key is set and the feature flag is on, so development and tests never
 * reach the provider by accident. Addresses are validated and reserved test domains are skipped.
 * The API key is read once and is never logged.
 */
export class EmailService {
  constructor(
    private readonly options: { apiKey?: string; from: string; enabled: boolean; fetchImpl?: typeof fetch; log: Logger }
  ) {}

  get enabled(): boolean {
    return this.options.enabled && Boolean(this.options.apiKey);
  }

  /** Whether mail to this address could be delivered: a valid address on a real domain. */
  static isDeliverable(address: string): boolean {
    const parsed = EmailSchema.safeParse(address);
    if (!parsed.success) return false;
    return !RESERVED.test(parsed.data.split('@')[1] ?? '');
  }

  async send(email: OutgoingEmail): Promise<SendResult> {
    const parsed = EmailSchema.safeParse(email.to);
    if (!parsed.success) return { sent: false, reason: 'INVALID_ADDRESS' };
    if (!this.enabled) {
      this.options.log.info({ subject: email.subject }, 'Email not sent: email delivery is disabled');
      return { sent: false, reason: 'DISABLED' };
    }
    if (!EmailService.isDeliverable(parsed.data)) {
      this.options.log.info({ subject: email.subject }, 'Email not sent: reserved test domain');
      return { sent: false, reason: 'RESERVED_DOMAIN' };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await (this.options.fetchImpl ?? fetch)(RESEND_ENDPOINT, {
        method: 'POST',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${this.options.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: this.options.from, to: [parsed.data], subject: email.subject, html: email.html, text: email.text }),
      });
      const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
      if (!response.ok) {
        this.options.log.warn({ status: response.status, provider: body.name, providerMessage: body.message, subject: email.subject }, 'Email provider rejected the message');
        return { sent: false, reason: 'PROVIDER_ERROR' };
      }
      this.options.log.info({ id: body.id, subject: email.subject }, 'Email sent');
      return { sent: true, id: body.id ?? null };
    } catch (error) {
      this.options.log.warn({ error: error instanceof Error ? error.name : 'unknown', subject: email.subject }, 'Email could not be sent');
      return { sent: false, reason: 'PROVIDER_ERROR' };
    } finally {
      clearTimeout(timer);
    }
  }
}
