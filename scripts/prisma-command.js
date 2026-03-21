const { spawn } = require('child_process');
const { existsSync, readFileSync } = require('fs');
const { resolve } = require('path');

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

function main() {
  loadLocalEnvFile();

  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error(
      '[prisma-command] Missing Prisma arguments. Example: node scripts/prisma-command.js migrate deploy',
    );
    process.exit(1);
  }

  const directUrl = process.env.DATABASE_DIRECT_URL;
  if (directUrl) {
    process.env.DATABASE_URL = directUrl;
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
