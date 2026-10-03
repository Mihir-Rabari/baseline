import { buildApp } from './app.js';
import { getEnv } from '@packages/config/env';

async function start() {
  const env = getEnv();
  const app = buildApp();

  // Handle graceful shutdown
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) {
    process.on(signal, async () => {
      app.log.info(`Received ${signal}, initiating graceful shutdown...`);
      try {
        await app.close();
        app.log.info('Server shutdown successfully.');
        process.exit(0);
      } catch (err) {
        app.log.error({ err }, 'Error during graceful shutdown');
        process.exit(1);
      }
    });
  }

  try {
    const address = await app.listen({
      port: env.PORT,
      host: env.HOST,
    });
    app.log.info(`🚀 API Server running at: ${address}`);
    app.log.info(`📚 Swagger Documentation at: ${address}/api/docs`);
    app.log.info(`📊 Prometheus Metrics at: ${address}/metrics`);
    app.log.info(`🩺 Health endpoint at: ${address}/health`);
  } catch (err) {
    app.log.fatal({ err }, 'Failed to start API server');
    process.exit(1);
  }
}

start();
