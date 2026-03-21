import * as express from 'express';
import * as request from 'supertest';
import {
  createAuthRateLimiters,
  createWriteRateLimiters,
} from './auth-rate-limit.util';

describe('Auth rate-limit integration', () => {
  const configService = {
    get: jest.fn((key: string) => {
      switch (key) {
        case 'AUTH_LOGIN_RATE_LIMIT_MAX':
          return '2';
        case 'AUTH_LOGIN_RATE_LIMIT_WINDOW_MS':
          return '60000';
        case 'AUTH_FORGOT_RATE_LIMIT_MAX':
          return '1';
        case 'AUTH_FORGOT_RATE_LIMIT_WINDOW_MS':
          return '60000';
        case 'AUTH_RESET_RATE_LIMIT_MAX':
          return '2';
        case 'AUTH_RESET_RATE_LIMIT_WINDOW_MS':
          return '60000';
        case 'WRITE_RATE_LIMIT_MAX':
          return '2';
        case 'WRITE_RATE_LIMIT_WINDOW_MS':
          return '60000';
        case 'WRITE_ADMIN_RATE_LIMIT_MAX':
          return '1';
        case 'WRITE_ADMIN_RATE_LIMIT_WINDOW_MS':
          return '60000';
        default:
          return undefined;
      }
    }),
  } as any;

  it('blocks login attempts after the configured burst limit', async () => {
    const app = express();
    const routes = createAuthRateLimiters(configService, 'api');
    const loginLimiter = routes.find(
      (route) => route.path === '/api/auth/login',
    );

    if (!loginLimiter) {
      throw new Error('Login limiter route not configured');
    }

    app.post('/api/auth/login', loginLimiter.middleware, (_req, res) =>
      res.status(200).json({ ok: true }),
    );

    await request(app).post('/api/auth/login').expect(200);
    await request(app).post('/api/auth/login').expect(200);
    const blocked = await request(app).post('/api/auth/login').expect(429);

    expect(blocked.body).toEqual({
      statusCode: 429,
      message: 'Too many login attempts. Please wait and try again.',
    });
  });

  it('treats IPv4-mapped IPv6 and IPv4 addresses as the same auth client key', async () => {
    const app = express();
    app.set('trust proxy', 1);

    const mappedIpConfig = {
      get: jest.fn((key: string) => {
        switch (key) {
          case 'AUTH_LOGIN_RATE_LIMIT_MAX':
            return '1';
          case 'AUTH_LOGIN_RATE_LIMIT_WINDOW_MS':
            return '60000';
          case 'AUTH_FORGOT_RATE_LIMIT_MAX':
            return '5';
          case 'AUTH_FORGOT_RATE_LIMIT_WINDOW_MS':
            return '60000';
          case 'AUTH_RESET_RATE_LIMIT_MAX':
            return '5';
          case 'AUTH_RESET_RATE_LIMIT_WINDOW_MS':
            return '60000';
          default:
            return undefined;
        }
      }),
    } as any;

    const routes = createAuthRateLimiters(mappedIpConfig, 'api');
    const loginLimiter = routes.find(
      (route) => route.path === '/api/auth/login',
    );

    if (!loginLimiter) {
      throw new Error('Login limiter route not configured');
    }

    app.post('/api/auth/login', loginLimiter.middleware, (_req, res) =>
      res.status(200).json({ ok: true }),
    );

    await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', '::ffff:203.0.113.77')
      .expect(200);
    await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', '203.0.113.77')
      .expect(429);
  });

  it('applies a stricter limiter to forgot-password requests', async () => {
    const app = express();
    const routes = createAuthRateLimiters(configService, 'api');
    const forgotLimiter = routes.find(
      (route) => route.path === '/api/auth/forgot-password',
    );

    if (!forgotLimiter) {
      throw new Error('Forgot-password limiter route not configured');
    }

    app.post(
      '/api/auth/forgot-password',
      forgotLimiter.middleware,
      (_req, res) => res.status(200).json({ ok: true }),
    );

    await request(app).post('/api/auth/forgot-password').expect(200);
    const blocked = await request(app)
      .post('/api/auth/forgot-password')
      .expect(429);

    expect(blocked.body.message).toBe(
      'Too many password-reset requests. Please wait and try again.',
    );
  });

  it('shares limiter state across app instances when a distributed store is provided', async () => {
    type Bucket = {
      hits: number;
      resetAt: number;
    };

    class FakeRedisClient {
      private readonly buckets = new Map<string, Bucket>();

      async incr(key: string): Promise<number> {
        this.cleanup();
        const now = Date.now();
        const bucket = this.buckets.get(key);
        if (!bucket) {
          this.buckets.set(key, { hits: 1, resetAt: now + 60_000 });
          return 1;
        }
        bucket.hits += 1;
        return bucket.hits;
      }

      async pttl(key: string): Promise<number> {
        this.cleanup();
        const bucket = this.buckets.get(key);
        if (!bucket) {
          return -2;
        }
        return Math.max(1, bucket.resetAt - Date.now());
      }

      async pexpire(key: string, ttlMs: number): Promise<number> {
        const bucket = this.buckets.get(key);
        if (!bucket) {
          return 0;
        }
        bucket.resetAt = Date.now() + ttlMs;
        return 1;
      }

      async decr(key: string): Promise<number> {
        const bucket = this.buckets.get(key);
        if (!bucket) {
          return 0;
        }
        bucket.hits = Math.max(0, bucket.hits - 1);
        if (bucket.hits === 0) {
          this.buckets.delete(key);
        }
        return bucket.hits;
      }

      async del(key: string): Promise<number> {
        return this.buckets.delete(key) ? 1 : 0;
      }

      async get(key: string): Promise<string | null> {
        this.cleanup();
        const bucket = this.buckets.get(key);
        return bucket ? String(bucket.hits) : null;
      }

      private cleanup() {
        const now = Date.now();
        for (const [key, bucket] of this.buckets.entries()) {
          if (bucket.resetAt <= now) {
            this.buckets.delete(key);
          }
        }
      }
    }

    const redisClient = new FakeRedisClient();
    const redisService = {
      isAvailable: () => true,
      getClient: () => redisClient,
    };

    const appA = express();
    const appB = express();
    const routesA = createAuthRateLimiters(configService, 'api', redisService);
    const routesB = createAuthRateLimiters(configService, 'api', redisService);

    const limiterA = routesA.find((route) => route.path === '/api/auth/login');
    const limiterB = routesB.find((route) => route.path === '/api/auth/login');

    if (!limiterA || !limiterB) {
      throw new Error(
        'Login limiter route not configured for shared-store test',
      );
    }

    appA.post('/api/auth/login', limiterA.middleware, (_req, res) =>
      res.status(200).json({ ok: true, node: 'A' }),
    );
    appB.post('/api/auth/login', limiterB.middleware, (_req, res) =>
      res.status(200).json({ ok: true, node: 'B' }),
    );

    await request(appA).post('/api/auth/login').expect(200);
    await request(appB).post('/api/auth/login').expect(200);
    await request(appA).post('/api/auth/login').expect(429);
  });
});

describe('Write endpoint rate-limit integration', () => {
  const configService = {
    get: jest.fn((key: string) => {
      switch (key) {
        case 'WRITE_RATE_LIMIT_MAX':
          return '2';
        case 'WRITE_RATE_LIMIT_WINDOW_MS':
          return '60000';
        case 'WRITE_ADMIN_RATE_LIMIT_MAX':
          return '1';
        case 'WRITE_ADMIN_RATE_LIMIT_WINDOW_MS':
          return '60000';
        default:
          return undefined;
      }
    }),
  } as any;

  it('applies write limits only on mutation methods', async () => {
    const app = express();
    const routes = createWriteRateLimiters(configService, 'api');
    const invoiceLimiter = routes.find(
      (route) => route.path === '/api/invoices',
    );

    if (!invoiceLimiter) {
      throw new Error('Invoice write limiter not configured');
    }

    app.get('/api/invoices', invoiceLimiter.middleware, (_req, res) =>
      res.status(200).json({ ok: true }),
    );
    app.post('/api/invoices', invoiceLimiter.middleware, (_req, res) =>
      res.status(200).json({ ok: true }),
    );

    await request(app).get('/api/invoices').expect(200);
    await request(app).get('/api/invoices').expect(200);

    await request(app)
      .post('/api/invoices')
      .set('X-Company-Id', 'cmp-1')
      .set(
        'Authorization',
        `Bearer ${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{"sub":"u1"}').toString('base64url')}.sig`,
      )
      .expect(200);
    await request(app)
      .post('/api/invoices')
      .set('X-Company-Id', 'cmp-1')
      .set(
        'Authorization',
        `Bearer ${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{"sub":"u1"}').toString('base64url')}.sig`,
      )
      .expect(200);
    await request(app)
      .post('/api/invoices')
      .set('X-Company-Id', 'cmp-1')
      .set(
        'Authorization',
        `Bearer ${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{"sub":"u1"}').toString('base64url')}.sig`,
      )
      .expect(429);
  });

  it('scopes write limiter by tenant and user identity', async () => {
    const app = express();
    const routes = createWriteRateLimiters(configService, 'api');
    const accountingLimiter = routes.find(
      (route) => route.path === '/api/accounting',
    );

    if (!accountingLimiter) {
      throw new Error('Accounting write limiter not configured');
    }

    app.post('/api/accounting/cash-book', accountingLimiter.middleware, (_req, res) =>
      res.status(200).json({ ok: true }),
    );

    const bearer = (sub: string) =>
      `Bearer ${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(
        JSON.stringify({ sub }),
      ).toString('base64url')}.sig`;

    await request(app)
      .post('/api/accounting/cash-book')
      .set('X-Company-Id', 'cmp-1')
      .set('Authorization', bearer('u1'))
      .expect(200);
    await request(app)
      .post('/api/accounting/cash-book')
      .set('X-Company-Id', 'cmp-1')
      .set('Authorization', bearer('u1'))
      .expect(200);
    await request(app)
      .post('/api/accounting/cash-book')
      .set('X-Company-Id', 'cmp-1')
      .set('Authorization', bearer('u1'))
      .expect(429);

    // Different user under same tenant gets an independent bucket.
    await request(app)
      .post('/api/accounting/cash-book')
      .set('X-Company-Id', 'cmp-1')
      .set('Authorization', bearer('u2'))
      .expect(200);

    // Same user under different tenant gets an independent bucket.
    await request(app)
      .post('/api/accounting/cash-book')
      .set('X-Company-Id', 'cmp-2')
      .set('Authorization', bearer('u1'))
      .expect(200);
  });
});
