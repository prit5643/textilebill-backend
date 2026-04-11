import {
  ExecutionContext,
  CallHandler,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { RedisService } from '../../modules/redis/redis.service';
import { of, throwError } from 'rxjs';

describe('IdempotencyInterceptor', () => {
  let interceptor: IdempotencyInterceptor;
  let mockRedisService: jest.Mocked<Partial<RedisService>>;

  beforeEach(() => {
    mockRedisService = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      isAvailable: jest.fn().mockReturnValue(true),
    };
    interceptor = new IdempotencyInterceptor(
      mockRedisService as unknown as RedisService,
    );
  });

  const createMockContext = (
    method: string,
    headers: any = {},
    originalUrl = '/test',
    user: any = { id: 'u1' },
    body: any = {},
  ): ExecutionContext => {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          method,
          headers,
          originalUrl,
          user,
          body,
        }),
      }),
    } as unknown as ExecutionContext;
  };

  const createMockCallHandler = (
    returnValue: any = { success: true },
    throwErr?: any,
  ): CallHandler => {
    return {
      handle: () => (throwErr ? throwError(() => throwErr) : of(returnValue)),
    };
  };

  it('should skip idempotency logic for GET requests', async () => {
    const context = createMockContext('GET');
    const next = createMockCallHandler();

    const result = await interceptor.intercept(context, next);
    result.subscribe((res) => {
      expect(res).toEqual({ success: true });
    });
    expect(mockRedisService.get).not.toHaveBeenCalled();
  });

  describe('Explicit Idempotency Key', () => {
    it('should return cached response if key exists', async () => {
      const context = createMockContext('POST', { 'idempotency-key': 'abc' });
      const next = createMockCallHandler();

      // Simulate cached response
      (mockRedisService.get as jest.Mock).mockResolvedValueOnce(
        JSON.stringify({ cached: true }),
      );

      const result = await interceptor.intercept(context, next);

      // Since it's returning a direct observable, subscribe and assert
      result.subscribe((res) => {
        expect(res).toEqual({ cached: true });
      });
      expect(mockRedisService.get).toHaveBeenCalledWith('idempotent:u1:abc');
      // The handler must bypass calling next.handle() since we used cache
    });

    it('should fail-open and proceed if Redis throws an error', async () => {
      const context = createMockContext('POST', { 'idempotency-key': 'abc' });
      const next = createMockCallHandler({ newResponse: true });

      (mockRedisService.get as jest.Mock).mockRejectedValueOnce(
        new Error('Redis Down'),
      );
      (mockRedisService.set as jest.Mock).mockResolvedValueOnce(undefined);

      const result = await interceptor.intercept(context, next);

      result.subscribe((res) => {
        expect(res).toEqual({ newResponse: true });
      });
    });
  });

  describe('Implicit Lock (Barrier Gate)', () => {
    it('skips implicit barrier lock for auth login endpoint', async () => {
      const context = createMockContext('POST', {}, '/api/auth/login', null, {
        username: 'owner@test.com',
      });
      const next = createMockCallHandler();

      const result = await interceptor.intercept(context, next);
      result.subscribe((res) => {
        expect(res).toEqual({ success: true });
      });

      expect(mockRedisService.get).not.toHaveBeenCalled();
      expect(mockRedisService.set).not.toHaveBeenCalled();
    });

    it('should throw HTTP 409 Conflict if locked', async () => {
      const context = createMockContext('POST');
      const next = createMockCallHandler();

      // Simulate lock existing
      (mockRedisService.get as jest.Mock).mockResolvedValueOnce('1');

      try {
        await interceptor.intercept(context, next);
        fail('Should have thrown Conflict Error');
      } catch (err: any) {
        expect(err).toBeInstanceOf(HttpException);
        expect(err.getStatus()).toBe(HttpStatus.CONFLICT);
      }
    });

    it('should fall-through and not clear lock on 500 error', async () => {
      const context = createMockContext('POST');
      const error = new HttpException(
        'Internal',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      const next = createMockCallHandler(null, error);

      (mockRedisService.get as jest.Mock).mockResolvedValueOnce(null);
      (mockRedisService.set as jest.Mock).mockResolvedValueOnce(undefined);

      const result = await interceptor.intercept(context, next);

      result.subscribe({
        error: (err) => {
          expect(err.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
          // Del should not be called because status is 500
          expect(mockRedisService.del).not.toHaveBeenCalled();
        },
      });
    });
  });
});
