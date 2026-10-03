import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, verifyPasswordDummy } from './password.js';

describe('Password Cryptography', () => {
  it('should hash and verify passwords correctly', async () => {
    const password = 'SuperSecretPassword123!';
    const hash = await hashPassword(password);

    expect(hash).toBeDefined();
    expect(hash.startsWith('scrypt$')).toBe(true);

    const isValid = await verifyPassword(password, hash);
    expect(isValid).toBe(true);

    const isInvalid = await verifyPassword('WrongPassword123!', hash);
    expect(isInvalid).toBe(false);
  });

  it('should generate unique salts for identical passwords', async () => {
    const password = 'IdenticalPassword123!';
    const hash1 = await hashPassword(password);
    const hash2 = await hashPassword(password);

    expect(hash1).not.toEqual(hash2);
    expect(await verifyPassword(password, hash1)).toBe(true);
    expect(await verifyPassword(password, hash2)).toBe(true);
  });

  it('should reject empty passwords', async () => {
    await expect(hashPassword('')).rejects.toThrow('Password cannot be empty');
  });

  it('should return false for malformed hash strings', async () => {
    expect(await verifyPassword('password', 'malformed_hash')).toBe(false);
    expect(await verifyPassword('password', '')).toBe(false);
    expect(await verifyPassword('password', 'bcrypt$invalid$hash')).toBe(false);
  });
});

describe('verifyPasswordDummy', () => {
  it('resolves without throwing for any input', async () => {
    await expect(verifyPasswordDummy('anything')).resolves.toBeUndefined();
    await expect(verifyPasswordDummy('')).resolves.toBeUndefined();
  });

  it('costs roughly the same as a real verification', async () => {
    // The point of the dummy hash is that "no such account" and "wrong password" take
    // indistinguishable time. An order-of-magnitude gap would reopen the enumeration
    // oracle, so the bound is deliberately loose but not vacuous.
    const realHash = await hashPassword('correct horse battery staple');

    const startReal = performance.now();
    await verifyPassword('wrong password', realHash);
    const realMs = performance.now() - startReal;

    const startDummy = performance.now();
    await verifyPasswordDummy('wrong password');
    const dummyMs = performance.now() - startDummy;

    expect(dummyMs).toBeGreaterThan(realMs / 10);
    expect(dummyMs).toBeLessThan(realMs * 10);
  });
});
