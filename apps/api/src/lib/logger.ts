import { createLogger as createSharedLogger, type Logger } from '@packages/shared';

export function createLogger(nodeEnv: string, logLevel = 'info'): Logger {
  const isDev = nodeEnv === 'development';

  return createSharedLogger({
    level: logLevel,
    isDev,
    name: 'api',
  });
}
