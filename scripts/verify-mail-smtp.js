const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

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

function maskSecret(value) {
  if (!value) {
    return '(missing)';
  }

  if (value.length <= 8) {
    return '********';
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function parseBoolean(value) {
  return (value || '').toLowerCase() === 'true';
}

function parseTransport(value) {
  return (value || '').toLowerCase() === 'gmail' ? 'gmail' : 'smtp';
}

function parsePositiveNumber(value, fallback) {
  const parsed = value ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function transportLabel(transport) {
  return transport === 'gmail' ? 'Gmail' : 'SMTP';
}

function resolveFromAddress(config) {
  if (config.transport === 'gmail') {
    return config.gmailFrom || config.from || config.gmailUser;
  }

  return config.from;
}

async function main() {
  const envPath = path.resolve(__dirname, '../.env');
  const env = parseEnvFile(fs.readFileSync(envPath, 'utf8'));

  const config = {
    enabled: parseBoolean(env.MAIL_ENABLED),
    transport: parseTransport(env.MAIL_TRANSPORT),
    host: env.MAIL_HOST || '',
    port: parsePositiveNumber(env.MAIL_PORT, 587),
    secure: parseBoolean(env.MAIL_SECURE),
    user: env.MAIL_USER || '',
    password: env.MAIL_PASSWORD || '',
    from: env.MAIL_FROM || '',
    gmailUser: env.MAIL_GMAIL_USER || '',
    gmailAppPassword: env.MAIL_GMAIL_APP_PASSWORD || '',
    gmailFrom: env.MAIL_GMAIL_FROM || '',
    sendTimeoutMs: parsePositiveNumber(env.MAIL_SEND_TIMEOUT_MS, 10000),
    testTo: env.MAIL_TEST_TO || env.MAIL_FROM || env.MAIL_GMAIL_USER || '',
  };

  const issues = [];

  if (!config.enabled) {
    issues.push('MAIL_ENABLED must be true.');
  }

  if (config.transport === 'gmail') {
    if (!config.gmailUser) {
      issues.push('MAIL_GMAIL_USER must be set when MAIL_TRANSPORT=gmail.');
    }
    if (!config.gmailAppPassword) {
      issues.push('MAIL_GMAIL_APP_PASSWORD must be set when MAIL_TRANSPORT=gmail.');
    }
  } else {
    if (!config.host) {
      issues.push('MAIL_HOST must be set when MAIL_TRANSPORT=smtp.');
    }
    if (!Number.isFinite(config.port) || config.port <= 0) {
      issues.push('MAIL_PORT must be a valid positive number when MAIL_TRANSPORT=smtp.');
    }
    if (!config.user) {
      issues.push('MAIL_USER must be set when MAIL_TRANSPORT=smtp.');
    }
    if (!config.password) {
      issues.push('MAIL_PASSWORD must be set when MAIL_TRANSPORT=smtp.');
    }
  }

  const from = resolveFromAddress(config);
  if (!from) {
    issues.push('Set MAIL_FROM, or set MAIL_GMAIL_FROM / MAIL_GMAIL_USER for Gmail mode.');
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
  console.log(`- transport: ${config.transport}`);
  if (config.transport === 'gmail') {
    console.log(`- gmail user: ${config.gmailUser}`);
    console.log(`- gmail app password: ${maskSecret(config.gmailAppPassword)}`);
  } else {
    console.log(`- host: ${config.host}`);
    console.log(`- port: ${config.port}`);
    console.log(`- secure: ${config.secure}`);
    console.log(`- user: ${config.user}`);
    console.log(`- password: ${maskSecret(config.password)}`);
  }
  console.log(`- from: ${from}`);
  console.log(`- test to: ${config.testTo || '(not set)'}`);

  const transporter =
    config.transport === 'gmail'
      ? nodemailer.createTransport({
          service: 'gmail',
          connectionTimeout: config.sendTimeoutMs,
          greetingTimeout: config.sendTimeoutMs,
          socketTimeout: config.sendTimeoutMs,
          auth: {
            user: config.gmailUser,
            pass: config.gmailAppPassword,
          },
        })
      : nodemailer.createTransport({
          host: config.host,
          port: config.port,
          secure: config.secure,
          connectionTimeout: config.sendTimeoutMs,
          greetingTimeout: config.sendTimeoutMs,
          socketTimeout: config.sendTimeoutMs,
          auth: {
            user: config.user,
            pass: config.password,
          },
        });

  await transporter.verify();
  console.log(`${transportLabel(config.transport)} authentication succeeded.`);

  if (process.argv.includes('--verify-only')) {
    console.log('Skipping test email because --verify-only was provided.');
    return;
  }

  if (!config.testTo) {
    console.log('Skipping test email because MAIL_TEST_TO is not set.');
    return;
  }

  const info = await transporter.sendMail({
    from,
    to: config.testTo,
    subject: `TextileBill ${transportLabel(config.transport)} test`,
    text: `This is a live ${transportLabel(config.transport)} delivery test from TextileBill.`,
    html: `<p>This is a live ${transportLabel(config.transport)} delivery test from <strong>TextileBill</strong>.</p>`,
  });

  console.log(`Test email accepted by ${transportLabel(config.transport)} server.`);
  console.log(`- message id: ${info.messageId}`);
  console.log(`- accepted: ${Array.isArray(info.accepted) ? info.accepted.join(', ') : ''}`);
  console.log(`- rejected: ${Array.isArray(info.rejected) ? info.rejected.join(', ') : ''}`);
}

main().catch((error) => {
  console.error('Mail verification failed.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
