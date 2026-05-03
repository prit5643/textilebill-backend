import type { ConfigService } from '@nestjs/config';
import rateLimit, {
  ipKeyGenerator,
  type Options,
  type RateLimitRequestHandler,
  type Store,
} from 'express-rate-limit';
import { parsePositiveInt } from '../../common/utils/config-value.util';

type ConfigReader = Pick<ConfigService, 'get'>;
type RedisRateLimitClient = Pick<
  {
    incr(key: string): Promise<number>;
    pttl(key: string): Promise<number>;
    pexpire(key: string, ttlMs: number): Promise<number>;
    decr(key: string): Promise<number>;
    del(key: string): Promise<number>;
    get(key: string): Promise<string | null>;
  },
  'incr' | 'pttl' | 'pexpire' | 'decr' | 'del' | 'get'
>;
type RedisRateLimitService = {
  isAvailable(): boolean;
  getClient(): RedisRateLimitClient | null;
};

export type RateLimitedRoute = {
  path: string;
  middleware: RateLimitRequestHandler;
};

type FallbackBucket = {
  hits: number;
  resetAt: number;
};

class RedisBackedRateLimitStore implements Store {
  localKeys = false;
  private readonly fallbackBuckets = new Map<string, FallbackBucket>();

  constructor(
    private readonly redisService: RedisRateLimitService,
    private readonly windowMs: number,
    private readonly keyPrefix: string,
  ) {}

  async increment(key: string) {
    const redisClient = this.resolveClient();
    if (!redisClient) {
      return this.incrementFallback(key);
    }

    const redisKey = this.toRedisKey(key);

    try {
      const totalHits = await redisClient.incr(redisKey);
      let ttlMs = await redisClient.pttl(redisKey);

      if (ttlMs <= 0) {
        await redisClient.pexpire(redisKey, this.windowMs);
        ttlMs = this.windowMs;
      }

      return {
        totalHits,
        resetTime: new Date(Date.now() + ttlMs),
      };
    } catch {
      return this.incrementFallback(key);
    }
  }

  async get(key: string) {
    const redisClient = this.resolveClient();
    if (!redisClient) {
      return this.getFallback(key);
    }

    const redisKey = this.toRedisKey(key);

    try {
      const [hitsRaw, ttlMs] = await Promise.all([
        redisClient.get(redisKey),
        redisClient.pttl(redisKey),
      ]);

      if (!hitsRaw || ttlMs <= 0) {
        return undefined;
      }

      return {
        totalHits: Number.parseInt(hitsRaw, 10),
        resetTime: new Date(Date.now() + ttlMs),
      };
    } catch {
      return this.getFallback(key);
    }
  }

  async decrement(key: string) {
    const redisClient = this.resolveClient();
    if (!redisClient) {
      this.decrementFallback(key);
      return;
    }

    try {
      await redisClient.decr(this.toRedisKey(key));
    } catch {
      this.decrementFallback(key);
    }
  }

  async resetKey(key: string) {
    this.fallbackBuckets.delete(key);

    const redisClient = this.resolveClient();
    if (!redisClient) {
      return;
    }

    try {
      await redisClient.del(this.toRedisKey(key));
    } catch {
      // Do nothing. Rate limiter should never block request flow due to store cleanup.
    }
  }

  private resolveClient(): RedisRateLimitClient | null {
    if (!this.redisService.isAvailable()) {
      return null;
    }

    return this.redisService.getClient();
  }

  private toRedisKey(key: string): string {
    return `${this.keyPrefix}:${key}`;
  }

  private cleanupFallback(now: number) {
    for (const [key, bucket] of this.fallbackBuckets.entries()) {
      if (bucket.resetAt <= now) {
        this.fallbackBuckets.delete(key);
      }
    }
  }

  private incrementFallback(key: string) {
    const now = Date.now();
    this.cleanupFallback(now);

    const existing = this.fallbackBuckets.get(key);
    if (existing && existing.resetAt > now) {
      existing.hits += 1;
      return {
        totalHits: existing.hits,
        resetTime: new Date(existing.resetAt),
      };
    }

    const resetAt = now + this.windowMs;
    this.fallbackBuckets.set(key, { hits: 1, resetAt });
    return {
      totalHits: 1,
      resetTime: new Date(resetAt),
    };
  }

  private getFallback(key: string) {
    const now = Date.now();
    this.cleanupFallback(now);

    const bucket = this.fallbackBuckets.get(key);
    if (!bucket) {
      return undefined;
    }

    return {
      totalHits: bucket.hits,
      resetTime: new Date(bucket.resetAt),
    };
  }

  private decrementFallback(key: string) {
    const bucket = this.fallbackBuckets.get(key);
    if (!bucket) {
      return;
    }

    bucket.hits = Math.max(0, bucket.hits - 1);
    if (bucket.hits === 0) {
      this.fallbackBuckets.delete(key);
    }
  }
}

function normalizeApiPrefix(apiPrefix: string): string {
  const trimmed = apiPrefix.trim().replace(/^\/+|\/+$/g, '');
  return trimmed ? `/${trimmed}` : '';
}

function isMutationMethod(method: string | undefined): boolean {
  return (
    method === 'POST' ||
    method === 'PUT' ||
    method === 'PATCH' ||
    method === 'DELETE'
  );
}

function getHeaderValue(
  headers: Record<string, string | string[] | undefined>,
  key: string,
): string | null {
  const value = headers[key.toLowerCase()];
  if (!value) {
    return null;
  }

  return Array.isArray(value) ? value[0] : value;
}

type RequestLikeForIp = {
  ip?: string;
  socket?: {
    remoteAddress?: string;
  };
  headers: Record<string, string | string[] | undefined>;
};

function stripPortFromIp(rawIp: string): string {
  const bracketedIpv6 = rawIp.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketedIpv6?.[1]) {
    return bracketedIpv6[1];
  }

  if (rawIp.includes('.') && rawIp.includes(':')) {
    const lastColonIndex = rawIp.lastIndexOf(':');
    const maybePort = rawIp.slice(lastColonIndex + 1);
    if (/^\d+$/.test(maybePort)) {
      return rawIp.slice(0, lastColonIndex);
    }
  }

  return rawIp;
}

function normalizeIp(ip: string | null | undefined): string {
  if (!ip) {
    return '127.0.0.1';
  }

  const normalized = stripPortFromIp(ip.trim().replace(/%.+$/, ''));

  if (
    normalized.toLowerCase().startsWith('::ffff:') &&
    normalized.includes('.')
  ) {
    return normalized.slice(7);
  }

  return normalized;
}

function getClientIp(request: RequestLikeForIp): string {
  const ipFromForwarded = getHeaderValue(request.headers, 'x-forwarded-for')
    ?.split(',')[0]
    ?.trim();
  const ipFromRealIpHeader = getHeaderValue(request.headers, 'x-real-ip');

  return normalizeIp(
    request.ip ||
      ipFromForwarded ||
      ipFromRealIpHeader ||
      request.socket?.remoteAddress,
  );
}

export function createAuthRateLimitKey(request: RequestLikeForIp): string {
  return `ip:${ipKeyGenerator(getClientIp(request))}`;
}

function decodeJwtSubject(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) {
    return null;
  }

  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) {
    return null;
  }

  const parts = match[1].split('.');
  if (parts.length < 2) {
    return null;
  }

  try {
    const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload = JSON.parse(payloadJson) as { sub?: string };
    return typeof payload.sub === 'string' && payload.sub.length
      ? payload.sub
      : null;
  } catch {
    return null;
  }
}

function getWriteRateLimitKey(req: {
  headers: Record<string, string | string[] | undefined>;
  user?: { id?: string };
  ip?: string;
}): string {
  const tenantId = getHeaderValue(req.headers, 'x-company-id') ?? 'no-company';
  const userIdFromReq = req.user?.id;
  const userIdFromToken = decodeJwtSubject(
    getHeaderValue(req.headers, 'authorization'),
  );
  const userId =
    userIdFromReq ?? userIdFromToken ?? `ip:${req.ip ?? 'unknown'}`;

  return `tenant:${tenantId}:user:${userId}`;
}

function createJsonRateLimiter(
  max: number,
  windowMs: number,
  message: string,
  options?: Partial<Pick<Options, 'skip' | 'keyGenerator'>>,
  store?: Store,
): RateLimitRequestHandler {
  return rateLimit({
    max,
    windowMs,
    store,
    skip: options?.skip,
    keyGenerator: options?.keyGenerator,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        statusCode: 429,
        message,
      });
    },
  });
}

export function createAuthRateLimiters(
  configService: ConfigReader,
  apiPrefix = 'api',
  redisService?: RedisRateLimitService,
): RateLimitedRoute[] {
  const loginMax = parsePositiveInt(
    configService.get<string>('AUTH_LOGIN_RATE_LIMIT_MAX'),
    10,
  );
  const loginWindowMs = parsePositiveInt(
    configService.get<string>('AUTH_LOGIN_RATE_LIMIT_WINDOW_MS'),
    60_000,
  );
  const forgotMax = parsePositiveInt(
    configService.get<string>('AUTH_FORGOT_RATE_LIMIT_MAX'),
    5,
  );
  const forgotWindowMs = parsePositiveInt(
    configService.get<string>('AUTH_FORGOT_RATE_LIMIT_WINDOW_MS'),
    15 * 60_000,
  );
  const resetMax = parsePositiveInt(
    configService.get<string>('AUTH_RESET_RATE_LIMIT_MAX'),
    10,
  );
  const resetWindowMs = parsePositiveInt(
    configService.get<string>('AUTH_RESET_RATE_LIMIT_WINDOW_MS'),
    15 * 60_000,
  );

  const prefix = normalizeApiPrefix(apiPrefix);

  const loginStore = redisService
    ? new RedisBackedRateLimitStore(
        redisService,
        loginWindowMs,
        `${prefix || '/api'}:auth:login`,
      )
    : undefined;
  const forgotStore = redisService
    ? new RedisBackedRateLimitStore(
        redisService,
        forgotWindowMs,
        `${prefix || '/api'}:auth:forgot-password`,
      )
    : undefined;
  const resetStore = redisService
    ? new RedisBackedRateLimitStore(
        redisService,
        resetWindowMs,
        `${prefix || '/api'}:auth:reset-password`,
      )
    : undefined;
  const authKeyGenerator = (request: {
    ip?: string;
    socket?: {
      remoteAddress?: string;
    };
    headers: Record<string, string | string[] | undefined>;
  }) => createAuthRateLimitKey(request);

  return [
    {
      path: `${prefix}/auth/login`,
      middleware: createJsonRateLimiter(
        loginMax,
        loginWindowMs,
        'Too many login attempts. Please wait and try again.',
        { keyGenerator: authKeyGenerator },
        loginStore,
      ),
    },
    {
      path: `${prefix}/auth/forgot-password`,
      middleware: createJsonRateLimiter(
        forgotMax,
        forgotWindowMs,
        'Too many password-reset requests. Please wait and try again.',
        { keyGenerator: authKeyGenerator },
        forgotStore,
      ),
    },
    {
      path: `${prefix}/auth/reset-password`,
      middleware: createJsonRateLimiter(
        resetMax,
        resetWindowMs,
        'Too many OTP verification attempts. Please wait and try again.',
        { keyGenerator: authKeyGenerator },
        resetStore,
      ),
    },
  ];
}

export function createWriteRateLimiters(
  configService: ConfigReader,
  apiPrefix = 'api',
  redisService?: RedisRateLimitService,
): RateLimitedRoute[] {
  const writeMax = parsePositiveInt(
    configService.get<string>('WRITE_RATE_LIMIT_MAX'),
    120,
  );
  const writeWindowMs = parsePositiveInt(
    configService.get<string>('WRITE_RATE_LIMIT_WINDOW_MS'),
    60_000,
  );
  const adminWriteMax = parsePositiveInt(
    configService.get<string>('WRITE_ADMIN_RATE_LIMIT_MAX'),
    60,
  );
  const adminWriteWindowMs = parsePositiveInt(
    configService.get<string>('WRITE_ADMIN_RATE_LIMIT_WINDOW_MS'),
    60_000,
  );

  const prefix = normalizeApiPrefix(apiPrefix);
  const basePrefix = prefix || '/api';

  const writeOptions = {
    skip: (req: { method?: string }) => !isMutationMethod(req.method),
    keyGenerator: (req: {
      headers: Record<string, string | string[] | undefined>;
      user?: { id?: string };
      ip?: string;
    }) => getWriteRateLimitKey(req),
  };

  const writeLimiter = (
    scope: string,
    max: number,
    windowMs: number,
    message: string,
  ) =>
    createJsonRateLimiter(
      max,
      windowMs,
      message,
      writeOptions,
      redisService
        ? new RedisBackedRateLimitStore(
            redisService,
            windowMs,
            `${basePrefix}:write:${scope}`,
          )
        : undefined,
    );

  return [
    {
      path: `${prefix}/invoices`,
      middleware: writeLimiter(
        'invoices',
        writeMax,
        writeWindowMs,
        'Too many invoice write requests. Please wait and try again.',
      ),
    },
    {
      path: `${prefix}/accounting`,
      middleware: writeLimiter(
        'accounting',
        writeMax,
        writeWindowMs,
        'Too many accounting write requests. Please wait and try again.',
      ),
    },
    {
      path: `${prefix}/users`,
      middleware: writeLimiter(
        'users',
        writeMax,
        writeWindowMs,
        'Too many user management write requests. Please wait and try again.',
      ),
    },
    {
      path: `${prefix}/admin`,
      middleware: writeLimiter(
      'admin',
        adminWriteMax,
        adminWriteWindowMs,
        'Too many admin write requests. Please wait and try again.',
      ),
    },
  ];
}
