import { registerAs } from '@nestjs/config';

const DEFAULT_MAIL_TIMEOUT_MS = 10000;
type MailTransport = 'smtp' | 'gmail';

function parseTimeout(value: string | undefined): number {
  const parsed = value ? parseInt(value, 10) : NaN;
  if (Number.isNaN(parsed) || parsed <= 0) {
    return DEFAULT_MAIL_TIMEOUT_MS;
  }

  return parsed;
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (typeof value !== 'string') {
    return defaultValue;
  }

  return value.toLowerCase() === 'true';
}

function parseTransport(value: string | undefined): MailTransport {
  if (typeof value !== 'string') {
    return 'smtp';
  }

  return value.toLowerCase() === 'gmail' ? 'gmail' : 'smtp';
}

export default registerAs('mail', () => {
  return {
    enabled: parseBoolean(process.env.MAIL_ENABLED, false),
    transport: parseTransport(process.env.MAIL_TRANSPORT),
    asyncQueueEnabled: parseBoolean(process.env.MAIL_ASYNC_QUEUE_ENABLED, false),
    host: process.env.MAIL_HOST,
    port: process.env.MAIL_PORT ? parseInt(process.env.MAIL_PORT, 10) : 587,
    secure: parseBoolean(process.env.MAIL_SECURE, false),
    user: process.env.MAIL_USER,
    password: process.env.MAIL_PASSWORD,
    from: process.env.MAIL_FROM,
    gmailUser: process.env.MAIL_GMAIL_USER,
    gmailAppPassword: process.env.MAIL_GMAIL_APP_PASSWORD,
    gmailFrom: process.env.MAIL_GMAIL_FROM,
    sendTimeoutMs: parseTimeout(process.env.MAIL_SEND_TIMEOUT_MS),
    connectionTimeoutMs: parseTimeout(process.env.MAIL_CONNECTION_TIMEOUT_MS),
    greetingTimeoutMs: parseTimeout(process.env.MAIL_GREETING_TIMEOUT_MS),
    socketTimeoutMs: parseTimeout(process.env.MAIL_SOCKET_TIMEOUT_MS),
  };
});
