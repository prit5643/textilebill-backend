import { registerAs } from '@nestjs/config';
import { parsePositiveInt } from '../common/utils/config-value.util';

export default registerAs('database', () => ({
  url: process.env.DATABASE_URL,
  directUrl: process.env.DATABASE_DIRECT_URL,
  connectMaxRetries: parsePositiveInt(process.env.DB_CONNECT_MAX_RETRIES, 8),
  connectRetryBaseMs: parsePositiveInt(
    process.env.DB_CONNECT_RETRY_BASE_MS,
    250,
  ),
  connectRetryMaxMs: parsePositiveInt(
    process.env.DB_CONNECT_RETRY_MAX_MS,
    5000,
  ),
}));
