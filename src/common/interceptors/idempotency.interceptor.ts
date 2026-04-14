import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { RedisService } from '../../modules/redis/redis.service';

/**
 * Interceptor to prevent duplicate submissions (e.g., double-clicking a submit button).
 *
 * Works in two ways:
 * 1. Explicit: Looks for an `Idempotency-Key` header. If found, caches the response for 24h.
 * 2. Implicit (Barrier): If no key is provided, applies a short 5-second lock based on
 *    User ID + HTTP Method + URL Path to prevent immediate double-clicks.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(private readonly redisService: RedisService) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();
    const method = request.method;

    // Only apply to mutations
    if (
      method !== 'POST' &&
      method !== 'PUT' &&
      method !== 'PATCH' &&
      method !== 'DELETE'
    ) {
      return next.handle();
    }

    const idempotencyKey = request.headers['idempotency-key'];
    const userId = request.user?.id || 'anonymous';
    const path = request.originalUrl;
    const actorKey = this.getActorKey(request, userId);

    // 1. Explicit Idempotency Key (Cache results)
    if (idempotencyKey) {
      const cacheKey = `idempotent:${actorKey}:${idempotencyKey}`;
      let cachedResponse: string | null = null;
      try {
        cachedResponse = await this.redisService.get(cacheKey);
      } catch (redisErr) {
        this.logger.warn(
          `Redis connection failed while fetching idempotency key. Failing open.`,
          redisErr,
        );
        // Proceed without idempotency protection
      }

      if (cachedResponse) {
        this.logger.debug(
          `Returning cached idempotent response for key: ${idempotencyKey}`,
        );
        try {
          return of(JSON.parse(cachedResponse));
        } catch {
          // Fallback if parsing fails
        }
      }

      return next.handle().pipe(
        tap((response) => {
          // Cache successful response for 24 hours
          this.redisService
            .set(cacheKey, JSON.stringify(response), 60 * 60 * 24)
            .catch((err: any) => {
              this.logger.warn('Failed to cache idempotent response', err);
            });
        }),
      );
    }

    if (this.shouldSkipImplicitBarrier(path)) {
      return next.handle();
    }

    // 2. Implicit Short-lived Lock (Barrier to prevent immediate double-clicks)
    const lockKey = `lock:${actorKey}:${method}:${path}`;
    let isLocked: string | null = null;

    try {
      isLocked = await this.redisService.get(lockKey);
    } catch {
      this.logger.warn(
        `Redis connection failed while checking barrier lock. Failing open.`,
      );
    }

    if (isLocked) {
      this.logger.warn(
        `Blocked duplicate request to ${method} ${path} for actor ${actorKey}`,
      );
      throw new HttpException(
        'Request is already processing. Please wait.',
        HttpStatus.CONFLICT, // 409 Conflict
      );
    }

    // Set a short lock (e.g., 5 seconds)
    try {
      await this.redisService.set(lockKey, '1', 5);
    } catch {
      // Ignore if setting the lock fails, don't crash the request
    }

    return next.handle().pipe(
      tap({
        next: () => {
          // Clear lock once the request succeeds so normal sequential actions are not blocked.
          this.redisService.del(lockKey).catch(() => {});
        },
        error: (err: any) => {
          const status = err?.getStatus
            ? err.getStatus()
            : HttpStatus.INTERNAL_SERVER_ERROR;

          // Do NOT clear the lock if it's a Rate Limit (429) or Server Error (500)
          // To prevent spamming retries against an already distressed server.
          if (
            status !== HttpStatus.TOO_MANY_REQUESTS &&
            status !== HttpStatus.INTERNAL_SERVER_ERROR
          ) {
            try {
              this.redisService.del(lockKey).catch(() => {});
            } catch {
              // Ignored
            }
          }
        },
      }),
    );
  }

  private getActorKey(request: any, userId: string): string {
    if (userId !== 'anonymous') {
      return userId;
    }

    const path = String(request?.originalUrl || '');
    if (!path.includes('/auth/')) {
      return 'anonymous';
    }

    const body = request?.body || {};
    const identityCandidate =
      body.username || body.email || body.identifier || body.requestId;

    if (!identityCandidate) {
      return 'anonymous';
    }

    const normalized = String(identityCandidate).trim().toLowerCase();
    return normalized || 'anonymous';
  }

  private shouldSkipImplicitBarrier(path: string): boolean {
    return /^\/api\/auth\/(login|refresh|otp\/request|otp\/verify|otp\/resend)$/.test(
      path,
    );
  }
}
