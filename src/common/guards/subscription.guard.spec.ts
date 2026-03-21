import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../modules/prisma/prisma.service';
import { RedisService } from '../../modules/redis/redis.service';
import { SubscriptionGuard } from './subscription.guard';
import {
  getTenantSubscriptionCacheKey,
  SUBSCRIPTION_NEGATIVE_CACHE_TTL_SECONDS,
} from '../../modules/auth/auth-request-cache.util';

describe('SubscriptionGuard', () => {
  let guard: SubscriptionGuard;
  let prisma: jest.Mocked<Partial<PrismaService>>;
  let redisService: jest.Mocked<Pick<RedisService, 'get' | 'set'>>;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-12T00:00:00.000Z'));

    prisma = {
      subscription: {
        findFirst: jest.fn(),
      } as any,
    };

    redisService = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };

    guard = new SubscriptionGuard(
      prisma as PrismaService,
      redisService as unknown as RedisService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('skips the check when authentication has not populated request.user', async () => {
    const context = createContext({});

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.subscription!.findFirst).not.toHaveBeenCalled();
  });

  it('bypasses subscription checks for super admins', async () => {
    const context = createContext({
      user: { id: 'super-1', role: 'SUPER_ADMIN' },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.subscription!.findFirst).not.toHaveBeenCalled();
  });

  it('allows cached active subscriptions without hitting the database', async () => {
    redisService.get.mockResolvedValueOnce('1');
    const context = createContext({
      user: { id: 'user-1', role: 'TENANT_ADMIN', tenantId: 'tenant-1' },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.subscription!.findFirst).not.toHaveBeenCalled();
  });

  it('rejects cached inactive subscriptions immediately', async () => {
    redisService.get.mockResolvedValueOnce('0');
    const context = createContext({
      user: { id: 'user-1', role: 'TENANT_ADMIN', tenantId: 'tenant-1' },
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.subscription!.findFirst).not.toHaveBeenCalled();
  });

  it('queries Prisma on cache miss and stores a bounded positive TTL', async () => {
    (prisma.subscription!.findFirst as jest.Mock).mockResolvedValueOnce({
      endDate: new Date('2026-03-12T00:10:00.000Z'),
    });
    const context = createContext({
      user: { id: 'user-1', role: 'TENANT_ADMIN', tenantId: 'tenant-1' },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.subscription!.findFirst).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        status: 'ACTIVE',
        endDate: {
          gte: new Date('2026-03-12T00:00:00.000Z'),
        },
      },
      orderBy: {
        endDate: 'asc',
      },
      select: {
        endDate: true,
      },
    });
    expect(redisService.set).toHaveBeenCalledWith(
      getTenantSubscriptionCacheKey('tenant-1'),
      '1',
      300,
    );
  });

  it('caches missing subscriptions briefly and fails closed', async () => {
    (prisma.subscription!.findFirst as jest.Mock).mockResolvedValueOnce(null);
    const context = createContext({
      user: { id: 'user-1', role: 'TENANT_ADMIN', tenantId: 'tenant-1' },
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(redisService.set).toHaveBeenCalledWith(
      getTenantSubscriptionCacheKey('tenant-1'),
      '0',
      SUBSCRIPTION_NEGATIVE_CACHE_TTL_SECONDS,
    );
  });
});

function createContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as ExecutionContext;
}
