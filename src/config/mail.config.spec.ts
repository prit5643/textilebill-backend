import mailConfig from './mail.config';

describe('mail config', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('uses MAIL_PASSWORD for SMTP auth when configured', () => {
    process.env.MAIL_ENABLED = 'true';
    process.env.MAIL_TRANSPORT = 'smtp';
    process.env.MAIL_HOST = 'smtp.example.com';
    process.env.MAIL_PORT = '587';
    process.env.MAIL_SECURE = 'false';
    process.env.MAIL_USER = 'apikey';
    process.env.MAIL_PASSWORD = 'smtp-password';
    process.env.MAIL_FROM = 'noreply@example.com';

    expect(mailConfig()).toEqual({
      enabled: true,
      transport: 'smtp',
      asyncQueueEnabled: false,
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      user: 'apikey',
      password: 'smtp-password',
      from: 'noreply@example.com',
      gmailUser: undefined,
      gmailAppPassword: undefined,
      gmailFrom: undefined,
      sendTimeoutMs: 10000,
      connectionTimeoutMs: 10000,
      greetingTimeoutMs: 10000,
      socketTimeoutMs: 10000,
    });
  });

  it('loads Gmail transport settings when configured', () => {
    process.env.MAIL_ENABLED = 'true';
    process.env.MAIL_TRANSPORT = 'gmail';
    process.env.MAIL_HOST = '';
    process.env.MAIL_USER = '';
    process.env.MAIL_PASSWORD = '';
    process.env.MAIL_SECURE = 'false';
    process.env.MAIL_GMAIL_USER = 'billing@gmail.com';
    process.env.MAIL_GMAIL_APP_PASSWORD = 'gmail-app-pass';
    process.env.MAIL_GMAIL_FROM = 'Billing Team <billing@gmail.com>';
    process.env.MAIL_FROM = 'fallback@example.com';

    expect(mailConfig()).toEqual({
      enabled: true,
      transport: 'gmail',
      asyncQueueEnabled: false,
      host: '',
      port: 587,
      secure: false,
      user: '',
      password: '',
      from: 'fallback@example.com',
      gmailUser: 'billing@gmail.com',
      gmailAppPassword: 'gmail-app-pass',
      gmailFrom: 'Billing Team <billing@gmail.com>',
      sendTimeoutMs: 10000,
      connectionTimeoutMs: 10000,
      greetingTimeoutMs: 10000,
      socketTimeoutMs: 10000,
    });
  });
});
