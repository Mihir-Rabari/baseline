import { buildApp } from './app.js';
import { getEnv } from '@packages/config/env';
import { BookingService } from './services/booking.service.js';
import { JobService, expireHoldsForAllClubs, startHoldExpiryScheduler, startMembershipExpiryScheduler } from './services/job.service.js';

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
    const stopMembership = startMembershipExpiryScheduler(new JobService(app.db), app.log);
    const holds = new BookingService(app.db, { timezone: env.CLUB_TIMEZONE });
    const stopHolds = startHoldExpiryScheduler(() => expireHoldsForAllClubs(app.db, () => holds.expireHolds(), app.log), app.log);
    stopJobs = () => {
      stopMembership();
      stopHolds();
    };
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
