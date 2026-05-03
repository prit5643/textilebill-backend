import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../modules/prisma/prisma.service';
import { RedisService } from '../../modules/redis/redis.service';
import { SubscriptionGuard } from './subscription.guard';
import {
  TENANT_ACTIVE_CACHE_TTL_SECONDS,
  getTenantActiveCacheKey,
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
      tenant: {
        findUnique: jest.fn(),
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

  it('allows cached active tenants without hitting the database', async () => {
    redisService.get.mockResolvedValueOnce('1').mockResolvedValueOnce('1');
    const context = createContext({
      user: { id: 'user-1', role: 'TENANT_ADMIN', tenantId: 'tenant-1' },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.subscription!.findFirst).not.toHaveBeenCalled();
  });

  it('rejects cached inactive tenants immediately', async () => {
    redisService.get.mockResolvedValueOnce('0');
    const context = createContext({
      user: { id: 'user-1', role: 'TENANT_ADMIN', tenantId: 'tenant-1' },
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.subscription!.findFirst).not.toHaveBeenCalled();
  });

  it('queries Prisma on cache miss and stores a positive tenant-active TTL', async () => {
    (prisma.subscription!.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'sub-1',
      endDate: new Date('2026-03-15T23:59:59.999Z'),
    });
    const context = createContext({
      user: { id: 'user-1', role: 'TENANT_ADMIN', tenantId: 'tenant-1' },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.subscription!.findFirst).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
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
    expect(redisService.set).toHaveBeenCalledWith(
      getTenantSubscriptionCacheKey('tenant-1'),
      '1',
      expect.any(Number),
    );
    const ttl = (redisService.set as jest.Mock).mock.calls[0][2];
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(TENANT_ACTIVE_CACHE_TTL_SECONDS);
  });

  it('stores minimum positive cache TTL when subscription expires imminently', async () => {
    (prisma.subscription!.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'sub-1',
      endDate: new Date('2026-03-12T00:00:00.200Z'),
    });
    const context = createContext({
      user: { id: 'user-1', role: 'TENANT_ADMIN', tenantId: 'tenant-1' },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(redisService.set).toHaveBeenCalledWith(
      getTenantSubscriptionCacheKey('tenant-1'),
      '1',
      1,
    );
  });

  it('treats midnight endDate as active through that day', async () => {
    jest.setSystemTime(new Date('2026-03-12T12:00:00.000Z'));
    (prisma.subscription!.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'sub-1',
      endDate: new Date('2026-03-12T00:00:00.000Z'),
    });
    const context = createContext({
      user: { id: 'user-1', role: 'TENANT_ADMIN', tenantId: 'tenant-1' },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(redisService.set).toHaveBeenCalledWith(
      getTenantSubscriptionCacheKey('tenant-1'),
      '1',
      expect.any(Number),
    );
  });

  it('caches missing active subscription briefly and fails closed', async () => {
    (prisma.subscription!.findFirst as jest.Mock).mockResolvedValueOnce(null);
    (prisma.tenant!.findUnique as jest.Mock).mockResolvedValueOnce({
      status: 'ACTIVE',
      deletedAt: null,
    });
    const context = createContext({
      user: { id: 'user-1', role: 'TENANT_ADMIN', tenantId: 'tenant-1' },
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(redisService.set).toHaveBeenCalledWith(
      getTenantActiveCacheKey('tenant-1'),
      '1',
      TENANT_ACTIVE_CACHE_TTL_SECONDS,
    );
    expect(redisService.set).toHaveBeenCalledWith(
      getTenantSubscriptionCacheKey('tenant-1'),
      '0',
      SUBSCRIPTION_NEGATIVE_CACHE_TTL_SECONDS,
    );
  });

  it('returns deactivated message when tenant is inactive during subscription miss', async () => {
    (prisma.subscription!.findFirst as jest.Mock).mockResolvedValueOnce(null);
    (prisma.tenant!.findUnique as jest.Mock).mockResolvedValueOnce({
      status: 'INACTIVE',
      deletedAt: null,
    });
    const context = createContext({
      user: { id: 'user-1', role: 'TENANT_ADMIN', tenantId: 'tenant-1' },
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      'Your account has been deactivated.',
    );

    expect(redisService.set).toHaveBeenCalledWith(
      getTenantActiveCacheKey('tenant-1'),
      '0',
      TENANT_ACTIVE_CACHE_TTL_SECONDS,
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
