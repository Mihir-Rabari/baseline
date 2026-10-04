import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { createLlmClient, type LlmClient } from '../services/agent/llm.js';
import { DrizzleAgentStore, type AgentStore } from '../services/agent/store.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** The model client. Tests replace it with a scripted fake (`app.agentLlm = fake`). */
    agentLlm: LlmClient;
    agentStore: AgentStore;
  }
}

async function agentPlugin(fastify: FastifyInstance) {
  fastify.decorate('agentLlm', createLlmClient(fastify.env));
  fastify.decorate('agentStore', new DrizzleAgentStore(fastify.db));
  // The key is intentionally never logged; only whether the agent is on.
  fastify.log.info({ enabled: fastify.agentLlm.enabled }, 'Agent LLM client initialised');
}

export default fp(agentPlugin, {
  name: 'app-agent',
  dependencies: ['app-config', 'app-services'],
});
