import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Prisma 7 does not read .env itself; the CLI gets DATABASE_URL from here.
if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
