import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { AppConfig, type AppConfigType } from '@packages/config';
import { getEnv, type Env } from '@packages/config/env';

declare module 'fastify' {
  interface FastifyInstance {
    env: Env;
    appConfig: AppConfigType;
  }
}

async function configPlugin(fastify: FastifyInstance) {
  const env = getEnv();
  fastify.decorate('env', env);
  fastify.decorate('appConfig', AppConfig);
}

export default fp(configPlugin, {
  name: 'app-config',
});
