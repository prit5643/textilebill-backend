import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  SESSION_TOKEN_COOKIE,
  assertAllowedOrigin,
  clearAuthCookies,
  getAccessTokenFromRequest,
  getAccessTokenLifetimeMs,
  getRefreshTokenFromRequest,
  getRefreshTokenLifetimeMs,
  parseAllowedOrigins,
  setAuthCookies,
} from './auth-cookie.util';

describe('auth-cookie.util', () => {
  function createConfig(overrides: Record<string, string> = {}) {
    return {
      get: jest.fn((key: string, defaultValue?: string) => {
        const values: Record<string, string | undefined> = {
          'app.apiPrefix': 'api/v1',
          'app.cookieDomain': '.textilebill.test',
          'app.cookieSameSite': 'strict',
          'app.cookieSecure': 'true',
          'app.corsOrigin':
            'https://app.textilebill.test, https://admin.textilebill.test',
          'app.nodeEnv': 'production',
          'jwt.expiresIn': '15m',
          'jwt.refreshExpiresIn': '14d',
          ...overrides,
        };

        return values[key] ?? defaultValue;
      }),
    } as unknown as ConfigService;
  }

  function createResponse() {
    return {
      cookie: jest.fn(),
      clearCookie: jest.fn(),
    } as any;
  }

  it('sets cookie lifetimes and paths for browser auth cookies', () => {
    const config = createConfig();
    const response = createResponse();

    setAuthCookies(response, config, {
      accessToken: 'access-token',
      sessionToken: 'session-token',
      refreshToken: 'refresh-token',
    });

    expect(response.cookie).toHaveBeenCalledTimes(3);
    expect(response.cookie).toHaveBeenNthCalledWith(
      1,
      ACCESS_TOKEN_COOKIE,
      'access-token',
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        domain: '.textilebill.test',
        path: '/',
        maxAge: 15 * 60 * 1000,
      }),
    );
    expect(response.cookie).toHaveBeenNthCalledWith(
      2,
      SESSION_TOKEN_COOKIE,
      'session-token',
      expect.objectContaining({
        path: '/',
        maxAge: 14 * 24 * 60 * 60 * 1000,
      }),
    );
    expect(response.cookie).toHaveBeenNthCalledWith(
      3,
      REFRESH_TOKEN_COOKIE,
      'refresh-token',
      expect.objectContaining({
        path: '/api/v1/auth',
        maxAge: 14 * 24 * 60 * 60 * 1000,
      }),
    );
  });

  it('clears all browser auth cookies with matching paths', () => {
    const config = createConfig();
    const response = createResponse();

    clearAuthCookies(response, config);

    expect(response.clearCookie).toHaveBeenCalledTimes(3);
    expect(response.clearCookie).toHaveBeenCalledWith(
      ACCESS_TOKEN_COOKIE,
      expect.objectContaining({ path: '/' }),
    );
    expect(response.clearCookie).toHaveBeenCalledWith(
      SESSION_TOKEN_COOKIE,
      expect.objectContaining({ path: '/' }),
    );
    expect(response.clearCookie).toHaveBeenCalledWith(
      REFRESH_TOKEN_COOKIE,
      expect.objectContaining({ path: '/api/v1/auth' }),
    );
  });

  it('reads access and refresh tokens directly from the cookie header', () => {
    const request = {
      headers: {
        cookie:
          'tb_access=access-token; other=value; tb_refresh=refresh-token%201',
      },
    } as any;

    expect(getAccessTokenFromRequest(request)).toBe('access-token');
    expect(getRefreshTokenFromRequest(request)).toBe('refresh-token 1');
  });

  it('parses allowed origins from comma-separated config', () => {
    const config = createConfig();

    expect(parseAllowedOrigins(config)).toEqual([
      'https://app.textilebill.test',
      'https://admin.textilebill.test',
    ]);
  });

  it('rejects disallowed origins and logs the attempted origin', () => {
    const logger = {
      warn: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
    };
    const config = createConfig();
    const request = {
      headers: {
        origin: 'https://evil.example',
      },
    } as any;

    expect(() => assertAllowedOrigin(request, config, logger as any)).toThrow(
      ForbiddenException,
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'Rejected auth cookie mutation from origin https://evil.example',
    );
  });

  it('allows same-origin or server-side auth mutations without an Origin header', () => {
    const config = createConfig();

    expect(() =>
      assertAllowedOrigin({ headers: {} } as any, config),
    ).not.toThrow();
    expect(() =>
      assertAllowedOrigin(
        { headers: { origin: 'https://admin.textilebill.test' } } as any,
        config,
      ),
    ).not.toThrow();
  });

  it('falls back to safe default cookie durations for malformed config values', () => {
    const config = createConfig({
      'jwt.expiresIn': 'bad-value',
      'jwt.refreshExpiresIn': 'bad-value',
      'app.cookieSameSite': 'invalid',
      'app.cookieSecure': 'false',
    });
    const response = createResponse();

    expect(getAccessTokenLifetimeMs(config)).toBe(15 * 60 * 1000);
    expect(getRefreshTokenLifetimeMs(config)).toBe(7 * 24 * 60 * 60 * 1000);

    setAuthCookies(response, config, {
      accessToken: 'access-token',
      sessionToken: 'session-token',
      refreshToken: 'refresh-token',
    });

    expect(response.cookie).toHaveBeenNthCalledWith(
      1,
      ACCESS_TOKEN_COOKIE,
      'access-token',
      expect.objectContaining({
        sameSite: 'lax',
        secure: false,
        maxAge: 15 * 60 * 1000,
      }),
    );
  });
});
