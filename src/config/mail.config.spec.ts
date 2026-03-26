import mailConfig from './mail.config';

describe('mail config', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('loads resend settings when configured', () => {
    process.env.MAIL_ENABLED = 'true';
    process.env.MAIL_FROM = 'noreply@example.com';
    process.env.MAIL_RESEND_API_KEY = 're_123';
    process.env.MAIL_RESEND_FROM = 'TextileBill <billing@example.com>';
    process.env.MAIL_RESEND_REPLY_TO = 'support@example.com';
    process.env.MAIL_MAX_SENDS_PER_PROCESS = '500';

    expect(mailConfig()).toEqual({
      enabled: true,
      asyncQueueEnabled: false,
      from: 'noreply@example.com',
      resendApiKey: 're_123',
      resendFrom: 'TextileBill <billing@example.com>',
      resendReplyTo: 'support@example.com',
      sendTimeoutMs: 10000,
      maxSendsPerProcess: 500,
    });
  });

  it('skips invalid max send limit', () => {
    process.env.MAIL_ENABLED = 'true';
    process.env.MAIL_FROM = 'fallback@example.com';
    process.env.MAIL_MAX_SENDS_PER_PROCESS = '0';

    expect(mailConfig()).toEqual({
      enabled: true,
      asyncQueueEnabled: false,
      from: 'fallback@example.com',
      resendApiKey: undefined,
      resendFrom: undefined,
      resendReplyTo: undefined,
      sendTimeoutMs: 10000,
      maxSendsPerProcess: undefined,
    });
  });
});
