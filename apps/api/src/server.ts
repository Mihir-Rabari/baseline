import { buildApp } from './app.js';
import { eq } from 'drizzle-orm';
import { getEnv } from '@packages/config/env';
import { tenants } from '@packages/db';
import { JobService, startMembershipExpiryScheduler } from './services/job.service.js';

async function start() {
  const env = getEnv();
  const app = buildApp();
  let stopJobs: (() => void) | undefined;

  // Handle graceful shutdown
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) {
    process.on(signal, async () => {
      app.log.info(`Received ${signal}, initiating graceful shutdown...`);
      stopJobs?.();
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
    // Background jobs: the timer is cleared by the shutdown handler above.
    // One run per active club, each inside that club's tenant scope.
    const activeClubs = async () =>
      (await app.systemDb.select({ id: tenants.id }).from(tenants).where(eq(tenants.status, 'ACTIVE'))).map((t) => t.id);
    stopJobs = startMembershipExpiryScheduler(new JobService(app.db), app.log, undefined, activeClubs);
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
