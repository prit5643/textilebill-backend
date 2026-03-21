import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../modules/prisma/prisma.service';
import { RedisService } from '../../modules/redis/redis.service';
import {
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
        'Your plan has ended. You cannot create invoices until renewal.',
      );
    }

    const now = new Date();
    const activeSubscription = await this.prisma.subscription.findFirst({
      where: {
        tenantId: user.tenantId,
        status: 'ACTIVE',
        endDate: {
          gte: now,
        },
      },
      orderBy: {
        endDate: 'asc',
      },
      select: {
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
        'Your plan has ended. You cannot create invoices until renewal.',
      );
    }

    await this.redisService.set(
      cacheKey,
      '1',
      getActiveSubscriptionCacheTtlSeconds(activeSubscription.endDate, now),
    );

    return true;
  }
}
