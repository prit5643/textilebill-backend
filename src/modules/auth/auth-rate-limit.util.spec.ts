import {
  createAuthRateLimitKey,
  createAuthRateLimiters,
  createWriteRateLimiters,
} from './auth-rate-limit.util';

describe('createAuthRateLimiters', () => {
  it('creates rate-limited routes under the configured API prefix', () => {
    const configService = {
      get: jest.fn(),
    } as any;

    const routes = createAuthRateLimiters(configService, 'api/v1');

    expect(routes.map((entry) => entry.path)).toEqual([
      '/api/v1/auth/login',
      '/api/v1/auth/forgot-password',
      '/api/v1/auth/reset-password',
    ]);
    expect(
      routes.every((entry) => typeof entry.middleware === 'function'),
    ).toBe(true);
  });

  it('creates write limiter routes for invoice, accounting, users, and admin', () => {
    const configService = {
      get: jest.fn(),
    } as any;

    const routes = createWriteRateLimiters(configService, 'api/v1');

    expect(routes.map((entry) => entry.path)).toEqual([
      '/api/v1/invoices',
      '/api/v1/accounting',
      '/api/v1/users',
      '/api/v1/admin',
    ]);
    expect(
      routes.every((entry) => typeof entry.middleware === 'function'),
    ).toBe(true);
  });

  it('normalizes IPv4-mapped IPv6 addresses to the same auth limiter key', () => {
    const mapped = createAuthRateLimitKey({
      headers: {},
      ip: '::ffff:198.51.100.42',
    });
    const ipv4 = createAuthRateLimitKey({
      headers: {},
      ip: '198.51.100.42',
    });

    expect(mapped).toBe(ipv4);
  });
});
