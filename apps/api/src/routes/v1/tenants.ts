import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

/**
 * Tenant domains, DNS verification and branding endpoints. Registered here so the control-plane
 * work only fills this file in; it does not need to edit the route index.
 */
export const tenantRoutes: FastifyPluginAsyncZod = async () => {
  // Intentionally empty until the control-plane work lands.
};
