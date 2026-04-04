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
  getTenantSubscriptionCacheKey,
  SUBSCRIPTION_NEGATIVE_CACHE_TTL_SECONDS,
} from '../../modules/auth/auth-request-cache.util';

@Injectable()
export class SubscriptionGuard implements CanActivate {
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

    const cacheKey = getTenantSubscriptionCacheKey(user.tenantId);
    const cached = await this.redisService.get(cacheKey);

    if (cached === '1') {
      return true;
    }

    if (cached === '0') {
      throw new ForbiddenException(
        'Your tenant is inactive or has no active subscription. Contact your administrator.',
      );
    }

    const now = new Date();
    const activeSubscription = await this.prisma.subscription.findFirst({
      where: {
        tenantId: user.tenantId,
        deletedAt: null,
        status: 'ACTIVE',
        endDate: {
          gte: now,
        },
        tenant: {
          status: 'ACTIVE',
          deletedAt: null,
        },
      },
      select: {
        id: true,
        endDate: true,
      },
    });

    if (!activeSubscription) {
      await this.redisService.set(
        cacheKey,
        '0',
        SUBSCRIPTION_NEGATIVE_CACHE_TTL_SECONDS,
      );
      throw new ForbiddenException(
        'Your tenant is inactive or has no active subscription. Contact your administrator.',
      );
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
}
