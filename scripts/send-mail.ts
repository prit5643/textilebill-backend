import { readFileSync } from 'fs';
import { resolve } from 'path';
import * as nodemailer from 'nodemailer';

type EnvMap = Record<string, string>;
type MailTransport = 'smtp' | 'gmail';
type MailScriptConfig = {
  enabled: boolean;
  transport: MailTransport;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
  gmailUser: string;
  gmailAppPassword: string;
  gmailFrom: string;
  sendTimeoutMs: number;
};

function parseEnvFile(filePath: string): EnvMap {
  const content = readFileSync(filePath, 'utf8');
  const values: EnvMap = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex < 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    values[key] = value;
  }

  return values;
}

function getCliValue(flagName: string): string | undefined {
  const index = process.argv.indexOf(flagName);
  if (index < 0) {
    return undefined;
  }

  return process.argv[index + 1];
}

function getPositionalArgs(): string[] {
  return process.argv.slice(2).filter((value, index, args) => {
    if (value.startsWith('--')) {
      return false;
    }

    const previous = args[index - 1];
    return !previous || !previous.startsWith('--');
  });
}

function parseBoolean(value: string | undefined): boolean {
  return (value || '').toLowerCase() === 'true';
}

function parseTransport(value: string | undefined): MailTransport {
  return (value || '').toLowerCase() === 'gmail' ? 'gmail' : 'smtp';
}

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = value ? Number(value) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  return fallback;
}

function getTransportLabel(transport: MailTransport): 'SMTP' | 'Gmail' {
  return transport === 'gmail' ? 'Gmail' : 'SMTP';
}

function resolveFromAddress(config: MailScriptConfig): string {
  if (config.transport === 'gmail') {
    return config.gmailFrom || config.from || config.gmailUser;
  }

  return config.from;
}

function getValidationIssues(config: MailScriptConfig, to: string | undefined): string[] {
  const issues: string[] = [];
  if (!config.enabled) {
    issues.push('MAIL_ENABLED must be true in .env before sending mail.');
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

  if (!resolveFromAddress(config)) {
    issues.push(
      'Set MAIL_FROM, or set MAIL_GMAIL_FROM / MAIL_GMAIL_USER for Gmail mode.',
    );
  }

  if (!to) {
    issues.push('Provide a recipient with --to or set MAIL_TEST_TO in .env.');
  }

  return issues;
}

function createTransporter(config: MailScriptConfig) {
  if (config.transport === 'gmail') {
    return nodemailer.createTransport({
      service: 'gmail',
      connectionTimeout: config.sendTimeoutMs,
      greetingTimeout: config.sendTimeoutMs,
      socketTimeout: config.sendTimeoutMs,
      auth: {
        user: config.gmailUser,
        pass: config.gmailAppPassword,
      },
    });
  }

  return nodemailer.createTransport({
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
}

async function main() {
  const envPath = resolve(__dirname, '../.env');
  const env = parseEnvFile(envPath);
  const positionalArgs = getPositionalArgs();

  const to = getCliValue('--to') || positionalArgs[0] || env.MAIL_TEST_TO;
  const subject = getCliValue('--subject') || positionalArgs[1] || 'TextileBill manual email test';
  const text =
    getCliValue('--text') ||
    positionalArgs[2] ||
    'This is a manual email sent from scripts/send-mail.ts.';
  const html =
    getCliValue('--html') ||
    `<p>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`;

  const config: MailScriptConfig = {
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
  };

  const issues = getValidationIssues(config, to);
  if (issues.length > 0) {
    throw new Error(issues.join('\n'));
  }

  const from = resolveFromAddress(config);
  const transporter = createTransporter(config);

  await transporter.verify();

  const info = await transporter.sendMail({
    from,
    to,
    subject,
    text,
    html,
  });

  const accepted = Array.isArray(info.accepted) ? info.accepted.join(', ') : '';
  const rejected = Array.isArray(info.rejected) ? info.rejected.join(', ') : '';

  console.log(`${getTransportLabel(config.transport)} mail send completed.`);
  console.log(`Transport: ${config.transport}`);
  console.log(`From: ${from}`);
  console.log(`To: ${to}`);
  console.log(`Subject: ${subject}`);
  console.log(`Message ID: ${info.messageId}`);
  console.log(`Accepted: ${accepted || '(none)'}`);
  console.log(`Rejected: ${rejected || '(none)'}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Mail send failed.');
  console.error(message);
  process.exitCode = 1;
});
