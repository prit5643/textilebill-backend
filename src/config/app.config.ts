import { registerAs } from '@nestjs/config';
import {
  parseBooleanFlag,
  parsePositiveInt,
  parseTrustProxySetting,
} from '../common/utils/config-value.util';

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
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
}));
