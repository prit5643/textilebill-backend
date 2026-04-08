const { spawn } = require('child_process');
const { existsSync, readFileSync } = require('fs');
const { resolve } = require('path');

function safeParseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function deriveSupabaseDirectUrl(rawUrl) {
  const parsed = safeParseUrl(rawUrl);
  if (!parsed) return null;

  const isSupabasePooler = parsed.hostname
    .toLowerCase()
    .endsWith('.pooler.supabase.com');
  if (!isSupabasePooler) return null;

  const usesPooledPort = parsed.port === '6543';
  const usesPgBouncer =
    parsed.searchParams.get('pgbouncer')?.toLowerCase() === 'true';
  if (!usesPooledPort && !usesPgBouncer) return null;

  parsed.port = '5432';
  parsed.searchParams.delete('pgbouncer');
  parsed.searchParams.delete('connection_limit');
  return parsed.toString();
}

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

function resolveMaintenanceDatabaseUrl() {
  const directUrl = process.env.DATABASE_DIRECT_URL;
  if (directUrl) {
    return { url: directUrl, source: 'DATABASE_DIRECT_URL' };
  }

  const runtimeUrl = process.env.DATABASE_URL;
  if (!runtimeUrl) {
    return { url: undefined, source: null };
  }

  const inferredDirectUrl = deriveSupabaseDirectUrl(runtimeUrl);
  if (inferredDirectUrl) {
    return {
      url: inferredDirectUrl,
      source: 'derived from DATABASE_URL (Supabase direct port 5432)',
    };
  }

  return { url: runtimeUrl, source: 'DATABASE_URL' };
}

function main() {
  loadLocalEnvFile();

  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error(
      '[prisma-command] Missing Prisma arguments. Example: node scripts/prisma-command.js migrate deploy',
    );
    process.exit(1);
  }

  const maintenanceUrl = resolveMaintenanceDatabaseUrl();
  if (maintenanceUrl.url) {
    process.env.DATABASE_URL = maintenanceUrl.url;
  }

  if (
    maintenanceUrl.source &&
    maintenanceUrl.source !== 'DATABASE_URL' &&
    maintenanceUrl.source !== 'DATABASE_DIRECT_URL'
  ) {
    console.log(
      `[prisma-command] Using maintenance database URL ${maintenanceUrl.source}.`,
    );
  }

  const child = spawn('npx', ['prisma', ...args], {
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });

  child.on('exit', (code) => {
    process.exit(code ?? 1);
  });

  child.on('error', (error) => {
    console.error('[prisma-command] Failed to run Prisma CLI:', error);
    process.exit(1);
  });
}

main();
