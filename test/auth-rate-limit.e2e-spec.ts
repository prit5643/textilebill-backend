import * as express from 'express';
import * as request from 'supertest';
import { createAuthRateLimiters } from '../src/modules/auth/auth-rate-limit.util';

describe('Auth abuse-protection smoke (e2e)', () => {
  it('returns HTTP 429 when login requests exceed configured limits', async () => {
    const app = express();
    const configService = {
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

    const loginLimiter = createAuthRateLimiters(configService, 'api').find(
      (route) => route.path === '/api/auth/login',
    );

    if (!loginLimiter) {
      throw new Error('Missing login limiter');
    }

    app.post('/api/auth/login', loginLimiter.middleware, (_req, res) =>
      res.status(200).json({ ok: true }),
    );

    await request(app).post('/api/auth/login').expect(200);
    await request(app).post('/api/auth/login').expect(429);
  });
});
