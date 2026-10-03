import { describe, it, expect } from 'vitest';
import { hashSessionToken, generateSessionToken } from './session-manager.js';

describe('Session Manager Primitives', () => {
  it('should generate secure 64-char hexadecimal session tokens', () => {
    const token1 = generateSessionToken();
    const token2 = generateSessionToken();

    expect(token1).toHaveLength(64);
    expect(token2).toHaveLength(64);
    expect(token1).not.toEqual(token2);
  });

  it('should deterministically produce SHA-256 token hashes', () => {
    const token = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    const hash1 = hashSessionToken(token);
    const hash2 = hashSessionToken(token);

    expect(hash1).toEqual(hash2);
    expect(hash1).toHaveLength(64);
  });
});
