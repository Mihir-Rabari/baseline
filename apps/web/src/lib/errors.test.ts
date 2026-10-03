import { describe, it, expect } from 'vitest';
import { getErrorMessage } from './errors.js';

describe('getErrorMessage (@app/web)', () => {
  it('returns the message from an Error instance', () => {
    expect(getErrorMessage(new Error('boom'), 'fallback')).toBe('boom');
  });

  it('falls back when an Error has an empty message', () => {
    expect(getErrorMessage(new Error(''), 'fallback')).toBe('fallback');
  });

  it('returns a non-empty string thrown directly', () => {
    expect(getErrorMessage('plain string error', 'fallback')).toBe('plain string error');
  });

  it('falls back for an empty string', () => {
    expect(getErrorMessage('', 'fallback')).toBe('fallback');
  });

  it('falls back for a rejected plain object', () => {
    expect(getErrorMessage({ some: 'object' }, 'fallback')).toBe('fallback');
  });

  it('falls back for null/undefined', () => {
    expect(getErrorMessage(null, 'fallback')).toBe('fallback');
    expect(getErrorMessage(undefined, 'fallback')).toBe('fallback');
  });
});
