import { registerAs } from '@nestjs/config';

const DEFAULT_MAIL_TIMEOUT_MS = 10000;

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

function parsePositiveInteger(value: string | undefined): number | undefined {
  const parsed = value ? parseInt(value, 10) : NaN;
  if (Number.isNaN(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}

export default registerAs('mail', () => {
  return {
    enabled: parseBoolean(process.env.MAIL_ENABLED, false),
    asyncQueueEnabled: parseBoolean(process.env.MAIL_ASYNC_QUEUE_ENABLED, false),
    from: process.env.MAIL_FROM,
    resendApiKey: process.env.MAIL_RESEND_API_KEY,
    resendFrom: process.env.MAIL_RESEND_FROM,
    resendReplyTo: process.env.MAIL_RESEND_REPLY_TO,
    sendTimeoutMs: parseTimeout(process.env.MAIL_SEND_TIMEOUT_MS),
    maxSendsPerProcess: parsePositiveInteger(process.env.MAIL_MAX_SENDS_PER_PROCESS),
  };
});
