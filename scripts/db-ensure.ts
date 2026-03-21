import { PrismaClient } from '@prisma/client';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

function loadLocalEnvFile() {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function getDatabaseName(databaseUrl: string): string {
  const parsed = new URL(databaseUrl);
  const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!dbName) {
    throw new Error('DATABASE_URL does not contain a database name.');
  }
  if (!/^[A-Za-z0-9_]+$/.test(dbName)) {
    throw new Error(
      `Unsupported database name "${dbName}". Use only letters, numbers and underscores for db:init.`,
    );
  }
  return dbName;
}

function getAdminDatabaseUrl(databaseUrl: string): string {
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  if (adminUrl) return adminUrl;

  const parsed = new URL(databaseUrl);
  parsed.pathname = '/postgres';
  return parsed.toString();
}

async function main() {
  loadLocalEnvFile();

  const databaseUrl = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL or DATABASE_DIRECT_URL is required.');
  }

  const dbName = getDatabaseName(databaseUrl);
  const adminUrl = getAdminDatabaseUrl(databaseUrl);

  const adminClient = new PrismaClient({
    datasources: {
      db: {
        url: adminUrl,
      },
    },
  });

  try {
    const existing = await adminClient.$queryRawUnsafe<Array<{ datname: string }>>(
      'SELECT datname FROM pg_database WHERE datname = $1 LIMIT 1',
      dbName,
    );

    if (existing.length > 0) {
      console.log(`[db:init] Database "${dbName}" already exists.`);
      return;
    }

    await adminClient.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
    console.log(`[db:init] Database "${dbName}" created.`);
  } finally {
    await adminClient.$disconnect();
  }
}

main().catch((error) => {
  console.error('[db:init] Failed:', error);
  process.exit(1);
});
