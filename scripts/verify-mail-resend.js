const fs = require('fs');
const path = require('path');
const { Resend } = require('resend');

function parseEnvFile(content) {
  const values = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    values[key] = value;
  }

  return values;
}

function parseBoolean(value) {
  return (value || '').toLowerCase() === 'true';
}

function parsePositiveNumber(value, fallback) {
  const parsed = value ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getCliValue(flagName) {
  const index = process.argv.indexOf(flagName);
  if (index < 0) {
    return undefined;
  }
  return process.argv[index + 1];
}

function maskSecret(value) {
  if (!value) {
    return '(missing)';
  }

  if (value.length <= 8) {
    return '********';
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

async function main() {
  const envPath = path.resolve(__dirname, '../.env');
  const env = parseEnvFile(fs.readFileSync(envPath, 'utf8'));

  const config = {
    enabled: parseBoolean(env.MAIL_ENABLED),
    apiKey: env.MAIL_RESEND_API_KEY || '',
    from: env.MAIL_RESEND_FROM || env.MAIL_FROM || '',
    replyTo: env.MAIL_RESEND_REPLY_TO || '',
    sendTimeoutMs: parsePositiveNumber(env.MAIL_SEND_TIMEOUT_MS, 10000),
    testTo: getCliValue('--to') || env.MAIL_TEST_TO || '',
  };

  const issues = [];
  if (!config.enabled) {
    issues.push('MAIL_ENABLED must be true.');
  }
  if (!config.apiKey) {
    issues.push('MAIL_RESEND_API_KEY must be set.');
  }
  if (!config.from) {
    issues.push('Set MAIL_RESEND_FROM or MAIL_FROM.');
  }

  if (issues.length > 0) {
    console.error('Mail config check failed:');
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('Resolved mail config:');
  console.log('- provider: resend');
  console.log(`- api key: ${maskSecret(config.apiKey)}`);
  console.log(`- from: ${config.from}`);
  console.log(`- reply to: ${config.replyTo || '(not set)'}`);
  console.log(`- send timeout: ${config.sendTimeoutMs}ms`);
  console.log(`- test to: ${config.testTo || '(not set)'}`);

  if (process.argv.includes('--verify-only')) {
    console.log('Resend configuration validated. Skipping test send (--verify-only).');
    return;
  }

  if (!config.testTo) {
    console.log('Skipping test email because MAIL_TEST_TO/--to is not set.');
    return;
  }

  const client = new Resend(config.apiKey);
  const result = await client.emails.send({
    from: config.from,
    to: config.testTo,
    subject: 'TextileBill Resend test',
    text: 'This is a live Resend delivery test from TextileBill.',
    html: '<p>This is a live Resend delivery test from <strong>TextileBill</strong>.</p>',
    replyTo: config.replyTo || undefined,
  });

  if (result.error) {
    throw new Error(result.error.message || 'Resend API error');
  }

  console.log('Resend test email accepted by provider.');
  console.log(`- message id: ${result.data?.id || '(missing)'}`);
}

main().catch((error) => {
  console.error('Mail verification failed.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
