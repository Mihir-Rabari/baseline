import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const keyCache = new Map<string, Buffer>();

/** A 32-byte key derived from the app secret, bound to one purpose so keys are not reused across features. */
function keyFor(secret: string, purpose: string): Buffer {
  const id = `${purpose}:${secret}`;
  let key = keyCache.get(id);
  if (!key) {
    key = scryptSync(secret, `baseline:${purpose}`, 32);
    keyCache.set(id, key);
  }
  return key;
}

/** AES-256-GCM. Output is `v1.<iv>.<tag>.<ciphertext>` in base64url, so tampering is detected on open. */
export function seal(plaintext: string, secret: string, purpose: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(secret, purpose), iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export function open(sealed: string, secret: string, purpose: string): string {
  const [version, iv, tag, data] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unrecognised sealed value');
  const decipher = createDecipheriv('aes-256-gcm', keyFor(secret, purpose), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}
