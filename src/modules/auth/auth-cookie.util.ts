import { ConfigService } from '@nestjs/config';
import type { Request, Response, CookieOptions } from 'express';

export const ACCESS_TOKEN_COOKIE = 'tb_access';
export const SESSION_TOKEN_COOKIE = 'tb_session';
export const REFRESH_TOKEN_COOKIE = 'tb_refresh';

type SessionCookieSet = {
  accessToken: string;
  sessionToken: string;
  refreshToken: string;
};

type SameSiteValue = 'lax' | 'strict' | 'none';

function normalizeApiPrefix(prefix: string | undefined) {
  const trimmed = (prefix || 'api').replace(/^\/+|\/+$/g, '');
  return `/${trimmed}`;
}

function parseDurationToMs(value: string | undefined, fallbackMs: number) {
  if (!value) return fallbackMs;

  const trimmed = value.trim();
  const match = trimmed.match(/^(\d+)(ms|s|m|h|d)?$/i);
  if (!match) return fallbackMs;

  const amount = Number(match[1]);
  const unit = (match[2] || 's').toLowerCase();

  switch (unit) {
    case 'ms':
      return amount;
    case 's':
      return amount * 1000;
    case 'm':
      return amount * 60 * 1000;
    case 'h':
      return amount * 60 * 60 * 1000;
    case 'd':
      return amount * 24 * 60 * 60 * 1000;
    default:
      return fallbackMs;
  }
}

function getCookieSameSite(configService: ConfigService): SameSiteValue {
  const raw = configService
    .get<string>('app.cookieSameSite', 'lax')
    .toLowerCase();

  if (raw === 'none' || raw === 'strict') {
    return raw;
  }

  return 'lax';
}

function getCookieSecure(configService: ConfigService) {
  const explicit = configService.get<string>('app.cookieSecure');
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;

  return configService.get<string>('app.nodeEnv') === 'production';
}

function getBaseCookieOptions(configService: ConfigService): CookieOptions {
  const domain = configService.get<string>('app.cookieDomain') || undefined;

  return {
    httpOnly: true,
    secure: getCookieSecure(configService),
    sameSite: getCookieSameSite(configService),
    domain,
  };
}

function getRefreshCookiePath(configService: ConfigService) {
  return `${normalizeApiPrefix(configService.get<string>('app.apiPrefix'))}/auth`;
}

export function getAccessTokenLifetimeMs(configService: ConfigService) {
  return parseDurationToMs(
    configService.get<string>('jwt.expiresIn'),
    15 * 60 * 1000,
  );
}

export function getRefreshTokenLifetimeMs(configService: ConfigService) {
  return parseDurationToMs(
    configService.get<string>('jwt.refreshExpiresIn'),
    7 * 24 * 60 * 60 * 1000,
  );
}

export function setAuthCookies(
  response: Response,
  configService: ConfigService,
  tokens: SessionCookieSet,
) {
  const base = getBaseCookieOptions(configService);
  const refreshPath = getRefreshCookiePath(configService);

  response.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
    ...base,
    path: '/',
    maxAge: getAccessTokenLifetimeMs(configService),
  });
  response.cookie(SESSION_TOKEN_COOKIE, tokens.sessionToken, {
    ...base,
    path: '/',
    maxAge: getRefreshTokenLifetimeMs(configService),
  });
  response.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
    ...base,
    path: refreshPath,
    maxAge: getRefreshTokenLifetimeMs(configService),
  });
}

export function clearAuthCookies(
  response: Response,
  configService: ConfigService,
) {
  const base = getBaseCookieOptions(configService);
  const refreshPath = getRefreshCookiePath(configService);

  response.clearCookie(ACCESS_TOKEN_COOKIE, {
    ...base,
    path: '/',
  });
  response.clearCookie(SESSION_TOKEN_COOKIE, {
    ...base,
    path: '/',
  });
  response.clearCookie(REFRESH_TOKEN_COOKIE, {
    ...base,
    path: refreshPath,
  });
}

export function getCookieValue(request: Request, cookieName: string) {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) {
    return null;
  }

  const encodedName = `${cookieName}=`;
  const cookie = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(encodedName));

  if (!cookie) {
    return null;
  }

  return decodeURIComponent(cookie.slice(encodedName.length));
}

export function getAccessTokenFromRequest(request: Request) {
  return getCookieValue(request, ACCESS_TOKEN_COOKIE);
}

export function getRefreshTokenFromRequest(request: Request) {
  return getCookieValue(request, REFRESH_TOKEN_COOKIE);
}

function normalizeOrigin(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  const withoutTrailingSlash = trimmed.replace(/\/+$/, '');
  try {
    return new URL(withoutTrailingSlash).origin.toLowerCase();
  } catch {
    return withoutTrailingSlash.toLowerCase();
  }
}

export function parseAllowedOrigins(configService: ConfigService) {
  const rawOrigins = configService.get<string>('app.url') || '';

  return rawOrigins
    .split(',')
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean);
}

export function assertAllowedOrigin(
  request: Request,
  configService: ConfigService,
  logger?: any,
) {
  void request;
  void configService;
  void logger;
  return;
}
