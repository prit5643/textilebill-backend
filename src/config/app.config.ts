import { registerAs } from '@nestjs/config';
import {
  parseBooleanFlag,
  parsePositiveInt,
  parseTrustProxySetting,
} from '../common/utils/config-value.util';

function parseAllowedOrigins(): string[] {
  const source =
    [
      process.env.ALLOWED_ORIGINS,
      process.env.CORS_ORIGIN,
      process.env.APP_URL,
    ].find((value) => typeof value === 'string' && value.trim().length > 0) ??
    '';

  const normalized = source
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => {
      try {
        return new URL(origin).origin;
      } catch {
        return origin.replace(/\/+$/, '');
      }
    });

  return Array.from(new Set(normalized));
}

export default registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parsePositiveInt(process.env.PORT, 3001),
  secretKey: process.env.APP_SECRET_KEY,
  apiPrefix: process.env.API_PREFIX ?? 'api',
  url: process.env.APP_URL ?? '',
  cookieDomain: process.env.COOKIE_DOMAIN,
  cookieSameSite: process.env.COOKIE_SAME_SITE,
  cookieSecure: process.env.COOKIE_SECURE,
  trustProxy: parseTrustProxySetting(process.env.TRUST_PROXY, 1),
  enableSwagger: parseBooleanFlag(process.env.ENABLE_SWAGGER),
  slowRequestMs: parsePositiveInt(process.env.SLOW_REQUEST_MS, 1500),
  allowedOrigins: parseAllowedOrigins(),
}));
