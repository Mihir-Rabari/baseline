import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  outputFileTracingRoot: rootDir,
  transpilePackages: ['@packages/config', '@packages/shared', '@packages/validation'],
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001',
  },
  async redirects() {
    return [
      {
        source: '/menu',
        destination: '/bar/menu',
        permanent: true,
      },
    ];
  },
  turbopack: {},
  webpack: (config) => {
    // The workspace packages above re-export their own submodules with explicit `.js`
    // extensions (e.g. `export * from './pagination.js'`) even though the files on disk
    // are `.ts` — standard TS/ESM "bundler" resolution style. Type-only imports of these
    // packages get erased by SWC before webpack ever resolves anything, which is why this
    // went unnoticed: nothing forced webpack to actually resolve a `.js` specifier against
    // a `.ts` file until a real (value) import was added. extensionAlias teaches webpack to
    // try `.ts`/`.tsx` when a `.js` specifier doesn't resolve literally.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.js', '.ts', '.tsx'],
    };
    return config;
  },
};

export default nextConfig;

