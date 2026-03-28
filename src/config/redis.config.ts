import { registerAs } from '@nestjs/config';

const parseBoolean = (value?: string): boolean | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return undefined;
};

export default registerAs('redis', () => {
  const nodeEnv = process.env.NODE_ENV;
  const redisUrl = process.env.REDIS_URL;
  const redisHost = process.env.REDIS_HOST;
  const redisPort = process.env.REDIS_PORT;

  // Detect environment: 'heroku' if REDIS_URL/rediss, 'ec2' if host/port, 'local' otherwise
  let environment = 'local';
  if (redisUrl?.startsWith('rediss://')) {
    environment = 'heroku';
  } else if (redisHost || redisPort) {
    environment = 'ec2';
  }

  return {
    enabled:
      parseBoolean(process.env.REDIS_ENABLED) ??
      (nodeEnv === 'production'
        ? Boolean(redisUrl || redisHost)
        : true),
    url: redisUrl,
    host: redisHost,
    port: Number.parseInt(redisPort || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    tlsEnabled:
      process.env.REDIS_TLS === 'true' ||
      (redisUrl || '').startsWith('rediss://'),
    environment, // Auto-detected: 'heroku' | 'ec2' | 'local'
  };
});
