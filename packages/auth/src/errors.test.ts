import { describe, it, expect } from 'vitest';
import {
  AuthenticationError,
  InvalidCredentialsError,
  SessionExpiredError,
  AccountSuspendedError,
  AccountDisabledError,
  UserAlreadyExistsError,
} from './errors.js';

describe('Auth Error Classes', () => {
  it('should instantiate InvalidCredentialsError with 401 status', () => {
    const err = new InvalidCredentialsError();
    expect(err).toBeInstanceOf(AuthenticationError);
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('INVALID_CREDENTIALS');
    expect(err.message).toBe('Invalid email or password');
  });

  it('should instantiate SessionExpiredError with 401 status', () => {
    const err = new SessionExpiredError();
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('SESSION_EXPIRED');
  });

  it('should instantiate AccountSuspendedError with 403 status', () => {
    const err = new AccountSuspendedError();
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('ACCOUNT_SUSPENDED');
    expect(err.message).toContain('suspended');
  });

  it('should instantiate AccountDisabledError with 403 status', () => {
    const err = new AccountDisabledError();
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('ACCOUNT_DISABLED');
    expect(err.message).toContain('disabled');
  });

  it('should instantiate UserAlreadyExistsError with 409 status', () => {
    const err = new UserAlreadyExistsError('test@example.com');
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('USER_ALREADY_EXISTS');
    expect(err.message).toContain('test@example.com');
  });
});
