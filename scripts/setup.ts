import { execSync } from 'node:child_process';
import fs from 'node:fs';

async function setup(): Promise<void> {
  console.log('\x1b[35m=== Initializing Application Environment & Database ===\x1b[0m\n');

  // 1. Copy .env.example if .env does not exist
  if (!fs.existsSync('.env') && fs.existsSync('.env.example')) {
    console.log('[Setup] 📄 Creating .env from .env.example...');
    fs.copyFileSync('.env.example', '.env');
  }

  // 2. Run Database Migrations
  console.log('[Setup] 🗄️  Applying database migrations...');
  try {
    execSync('pnpm --filter @packages/db db:migrate', { stdio: 'inherit' });
  } catch (err) {
    console.error('[Setup] ⚠️ Database migration failed. Is PostgreSQL running (pnpm infra:up)?');
    process.exit(1);
  }

  // 3. Seed Database
  console.log('[Setup] 🌱 Seeding baseline system & IAM configuration...');
  try {
    execSync('pnpm --filter @packages/db db:seed', { stdio: 'inherit' });
  } catch (err) {
    console.error('[Setup] ⚠️ Database seed failed.');
    process.exit(1);
  }

  console.log('\n\x1b[32m✔ Application setup completed successfully!\x1b[0m');
  console.log('You can now run: \x1b[36mpnpm dev\x1b[0m\n');
}

setup().catch((err) => {
  console.error('[Setup] Unexpected error:', err);
  process.exit(1);
});
