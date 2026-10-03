import { defineConfig } from 'drizzle-kit';
import { getEnv } from '@packages/config/env';

const env = getEnv();

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: env.DATABASE_URL,
  },
  verbose: true,
  strict: true,
});
