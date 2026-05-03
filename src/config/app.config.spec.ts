import appConfig from './app.config';

describe('app config', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('accepts legacy CORS_ORIGIN when ALLOWED_ORIGINS is unset', () => {
    delete process.env.ALLOWED_ORIGINS;
    process.env.CORS_ORIGIN = 'https://textilebook.app';
    process.env.APP_URL = 'https://textilebook.app';

    expect(appConfig().allowedOrigins).toEqual(['https://textilebook.app']);
  });
});
