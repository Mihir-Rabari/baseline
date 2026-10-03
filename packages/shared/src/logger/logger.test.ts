import { describe, it, expect } from 'vitest';
import { createLogger, REDACTED_PATHS } from './index.js';

describe('Structured Logger & Redaction Engine', () => {
  it('should include sensitive credential paths in REDACTED_PATHS', () => {
    expect(REDACTED_PATHS).toContain('*.password');
    expect(REDACTED_PATHS).toContain('*.passwordHash');
    expect(REDACTED_PATHS).toContain('*.token');
    expect(REDACTED_PATHS).toContain('*.sessionToken');
    expect(REDACTED_PATHS).toContain('*.secret');
    expect(REDACTED_PATHS).toContain('*.apiKey');
    expect(REDACTED_PATHS).toContain('req.headers.authorization');
    expect(REDACTED_PATHS).toContain('req.headers.cookie');
  });

  it('should instantiate a logger with expected log methods', () => {
    const log = createLogger({ level: 'debug', isDev: false });

    expect(typeof log.info).toBe('function');
    expect(typeof log.debug).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.error).toBe('function');
    expect(typeof log.fatal).toBe('function');
    expect(typeof log.child).toBe('function');
  });

  it('should create a child logger with bound metadata', () => {
    const log = createLogger({ level: 'info', isDev: false });
    const childLog = log.child({ requestId: 'req_123', service: 'iam' });

    expect(childLog).toBeDefined();
    expect(typeof childLog.info).toBe('function');
  });
});
