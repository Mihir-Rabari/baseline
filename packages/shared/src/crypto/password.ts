import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(crypto.scrypt);

const SALT_BYTES = 16;
const KEY_BYTES = 64;

/**
 * A syntactically valid hash of a value nobody can supply.
 *
 * Used by `verifyPasswordDummy` to spend the same CPU time as a real verification.
 */
const DUMMY_HASH = `scrypt$${'0'.repeat(SALT_BYTES * 2)}$${'0'.repeat(KEY_BYTES * 2)}`;

/**
 * Performs a throwaway password verification.
 *
 * Login must take the same time whether or not the account exists. Returning early on
 * an unknown email leaks account existence through response latency, which is enough to
 * enumerate a user list. Call this on the account-not-found path before responding.
 */
export async function verifyPasswordDummy(password: string): Promise<void> {
  await verifyPassword(password, DUMMY_HASH);
}

/**
 * Securely hashes a plaintext password using scrypt with a unique random salt.
 * Output format: scrypt$<saltHex>$<hashHex>
 */
export async function hashPassword(password: string): Promise<string> {
  if (!password || password.length === 0) {
    throw new Error('Password cannot be empty');
  }

  const salt = crypto.randomBytes(SALT_BYTES).toString('hex');
  const derivedKey = (await scryptAsync(password, salt, KEY_BYTES)) as Buffer;

  return `scrypt$${salt}$${derivedKey.toString('hex')}`;
}

/**
 * Verifies a plaintext password against a stored scrypt hash using timing-safe comparison.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (!password || !storedHash) {
    return false;
  }

  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }

  const salt = parts[1];
  const originalKeyHex = parts[2];
  const originalBuffer = Buffer.from(originalKeyHex, 'hex');

  try {
    const derivedKey = (await scryptAsync(password, salt, KEY_BYTES)) as Buffer;

    if (derivedKey.length !== originalBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(derivedKey, originalBuffer);
  } catch {
    return false;
  }
}
