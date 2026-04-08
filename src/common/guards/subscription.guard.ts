import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../modules/prisma/prisma.service';
import { RedisService } from '../../modules/redis/redis.service';
import {
  TENANT_ACTIVE_CACHE_TTL_SECONDS,
  getActiveSubscriptionCacheTtlSeconds,
  getTenantActiveCacheKey,
  getTenantSubscriptionCacheKey,
  SUBSCRIPTION_NEGATIVE_CACHE_TTL_SECONDS,
} from '../../modules/auth/auth-request-cache.util';

@Injectable()
export class SubscriptionGuard implements CanActivate {
  private readonly deactivatedMessage = 'Your account has been deactivated.';
  private readonly inactiveSubscriptionMessage =
    'Your subscription is inactive or has ended. Contact your administrator.';
  private static readonly DAY_IN_MS = 24 * 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Skip if no user (let JwtAuthGuard handle authentication)
    // or if the route is public
    if (!user) {
      return true;
    }

    // Super admin bypasses subscription check
    if (user.role === 'SUPER_ADMIN') {
      return true;
    }

    if (!user.tenantId) {
      throw new ForbiddenException('No tenant associated with this user');
    }

    const tenantActiveCacheKey = getTenantActiveCacheKey(user.tenantId);
    const cachedTenantActive = await this.redisService.get(tenantActiveCacheKey);

    if (cachedTenantActive === '0') {
      throw new ForbiddenException(this.deactivatedMessage);
    }

    const cacheKey = getTenantSubscriptionCacheKey(user.tenantId);
    const cached = await this.redisService.get(cacheKey);

    if (cached === '1') {
      return true;
    }

    if (cached === '0') {
      throw new ForbiddenException(this.inactiveSubscriptionMessage);
    }

    const now = new Date();
    const latestSubscription = await this.prisma.subscription.findFirst({
      where: {
        tenantId: user.tenantId,
        deletedAt: null,
        status: 'ACTIVE',
        tenant: {
          status: 'ACTIVE',
          deletedAt: null,
        },
      },
      orderBy: {
        endDate: 'desc',
      },
      select: {
        id: true,
        endDate: true,
      },
    });

    const activeSubscription = latestSubscription
      ? this.resolveActiveSubscription(latestSubscription, now)
      : null;

    if (!activeSubscription) {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: user.tenantId },
        select: { status: true, deletedAt: true },
      });
      const tenantIsActive =
        tenant?.status === 'ACTIVE' && (tenant?.deletedAt ?? null) === null;

      await this.redisService.set(
        tenantActiveCacheKey,
        tenantIsActive ? '1' : '0',
        TENANT_ACTIVE_CACHE_TTL_SECONDS,
      );
      await this.redisService.set(
        cacheKey,
        '0',
        SUBSCRIPTION_NEGATIVE_CACHE_TTL_SECONDS,
      );

      if (!tenantIsActive) {
        throw new ForbiddenException(this.deactivatedMessage);
      }

      throw new ForbiddenException(this.inactiveSubscriptionMessage);
    }

    await this.redisService.set(
      cacheKey,
      '1',
      Math.min(
        TENANT_ACTIVE_CACHE_TTL_SECONDS,
        getActiveSubscriptionCacheTtlSeconds(activeSubscription.endDate, now),
      ),
    );

    return true;
  }

  private resolveActiveSubscription(
    subscription: { id: string; endDate: Date },
    now: Date,
  ): { id: string; endDate: Date } | null {
    const effectiveEndDate = this.normalizeEndDate(subscription.endDate);
    if (effectiveEndDate < now) {
      return null;
    }

    return {
      id: subscription.id,
      endDate: effectiveEndDate,
    };
  }

  private normalizeEndDate(endDate: Date): Date {
    // Backward-compatible handling for historical rows that stored date-only
    // values at 00:00:00.000 UTC. Treat them as valid through that day.
    if (
      endDate.getUTCHours() === 0 &&
      endDate.getUTCMinutes() === 0 &&
      endDate.getUTCSeconds() === 0 &&
      endDate.getUTCMilliseconds() === 0
    ) {
      return new Date(endDate.getTime() + SubscriptionGuard.DAY_IN_MS - 1);
    }

    return endDate;
  }
}
