import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { eq } from 'drizzle-orm';
import { systemSettings } from '@packages/db';
import { AccountService } from '../services/account.service.js';
import { EmailService } from '../services/email.service.js';

declare module 'fastify' {
  interface FastifyInstance {
    emailService: EmailService;
    accountService: AccountService;
  }
}

async function emailPlugin(fastify: FastifyInstance) {
  const { env, appConfig } = fastify;
  // Automated tests never reach the provider, even when a developer has a key in .env.
  const enabled = appConfig.features.enableEmail && env.NODE_ENV !== 'test';
  const emailService = new EmailService({ apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM, enabled, log: fastify.log });
  fastify.log.info({ emailEnabled: emailService.enabled }, 'Email delivery configured');

  /** The club's public name, read when needed so a rename shows up in the next email. */
  const clubName = async () => {
    try {
      const [row] = await fastify.db.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, 'club.profile')).limit(1);
      const name = (row?.value as { name?: unknown } | undefined)?.name;
      return typeof name === 'string' && name.trim() ? name.trim() : env.APP_NAME;
    } catch {
      return env.APP_NAME;
    }
  };

  fastify.decorate('emailService', emailService);
  fastify.decorate(
    'accountService',
    new AccountService(fastify.db, {
      email: emailService,
      sessions: fastify.sessionManager,
      webUrl: env.WEB_URL,
      clubName,
      defaultPolicy: appConfig.iam.defaultExternalUserPolicy,
      defaultRole: appConfig.iam.defaultRole,
      minPasswordLength: appConfig.auth.minPasswordLength,
      log: fastify.log,
    })
  );
}

export default fp(emailPlugin, { name: 'app-email', dependencies: ['app-config', 'app-services', 'app-auth'] });
