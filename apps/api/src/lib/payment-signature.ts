import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PaymentWebhookRequest } from '@packages/validation';

/** The exact string a gateway signs for a webhook delivery. */
export function webhookSigningString(body: PaymentWebhookRequest): string {
  return `${body.intentId}.${body.event}.${body.amountPaise}.${body.reference}`;
}

export function signPaymentWebhook(secret: string, body: PaymentWebhookRequest): string {
  return createHmac('sha256', secret).update(webhookSigningString(body)).digest('hex');
}

/** Constant-time check of the hex `x-signature` header; false for anything malformed. */
export function verifyPaymentWebhook(secret: string, body: PaymentWebhookRequest, signature: unknown): boolean {
  if (typeof signature !== 'string' || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = Buffer.from(signPaymentWebhook(secret, body), 'hex');
  const given = Buffer.from(signature, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
