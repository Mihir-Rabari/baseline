import { pino, type Logger as PinoLogger, type LoggerOptions } from 'pino';

export type Logger = PinoLogger;

export const REDACTED_PATHS = [
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.sessionToken',
  '*.tokenHash',
  '*.secret',
  '*.sessionSecret',
  '*.accessKey',
  '*.secretKey',
  '*.apiKey',
  '*.authorization',
  '*.cookie',
  '*.set-cookie',
  "*['set-cookie']",
  '*.databaseUrl',
  '*.DATABASE_URL',
  '*.SESSION_SECRET',
  '*.RESEND_API_KEY',
  'req.headers.authorization',
  'req.headers.cookie',
  "res.headers['set-cookie']",
];

export interface CreateLoggerOptions {
  level?: string;
  isDev?: boolean;
  redactions?: string[];
  name?: string;
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const {
    level = process.env.LOG_LEVEL || 'info',
    isDev = process.env.NODE_ENV === 'development',
    redactions = [],
    name,
  } = options;

  const pinoOptions: LoggerOptions = {
    name,
    level,
    redact: {
      paths: [...REDACTED_PATHS, ...redactions],
      censor: '[REDACTED]',
      remove: false,
    },
    serializers: {
      err: (err) => {
        if (!err) return err;
        return {
          type: err.name || 'Error',
          message: err.message,
          stack: isDev ? err.stack : undefined,
          code: (err as { code?: unknown }).code,
        };
      },
    },
    transport: isDev
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss Z',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
  };

  return pino(pinoOptions);
}

/**
 * Universal canonical application logger.
 */
export const logger: Logger = createLogger();
