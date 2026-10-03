import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { IamService } from '@packages/iam';

declare module 'fastify' {
  interface FastifyInstance {
    iamService: IamService;
  }
}

async function iamPlugin(fastify: FastifyInstance) {
  const iamService = new IamService(fastify.db);
  fastify.decorate('iamService', iamService);
}

export default fp(iamPlugin, {
  name: 'app-iam',
  dependencies: ['app-config', 'app-services'],
});
