import { ConfigService } from '@nestjs/config';
import { ForbiddenException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import {
  getTenantActiveCacheKey,
  getUserAuthCacheKey,
  TENANT_ACTIVE_CACHE_TTL_SECONDS,
  USER_AUTH_CACHE_TTL_SECONDS,
} from '../auth-request-cache.util';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let prisma: jest.Mocked<Partial<PrismaService>>;
  let redisService: jest.Mocked<Pick<RedisService, 'get' | 'set'>>;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
      } as any,
      tenant: {
        findUnique: jest.fn(),
      } as any,
    };

    redisService = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };

    strategy = new JwtStrategy(
      {
        get: jest.fn((key: string) => {
          if (key === 'jwt.secret') {
            return 'jwt-secret';
          }
          return undefined;
        }),
      } as unknown as ConfigService,
      prisma as PrismaService,
      redisService as unknown as RedisService,
    );
  });

  it('accepts active users with active tenant', async () => {
    (prisma.user!.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'user-1',
      email: 'owner@test.com',
      status: 'ACTIVE',
      deletedAt: null,
      tenantId: 'tenant-1',
    });
    (prisma.tenant!.findUnique as jest.Mock).mockResolvedValue({
      status: 'ACTIVE',
      deletedAt: null,
    });

    await expect(
      strategy.validate({
        sub: 'user-1',
        sessionId: 'session-1',
        email: 'owner@test.com',
        role: 'ADMIN',
        tenantId: 'tenant-1',
      }),
    ).resolves.toEqual({
      id: 'user-1',
      email: 'owner@test.com',
      role: 'ADMIN',
      tenantId: 'tenant-1',
      sessionId: 'session-1',
    });

    expect(redisService.set).toHaveBeenCalledWith(
      getUserAuthCacheKey('user-1', 'session-1'),
      JSON.stringify({
        id: 'user-1',
        email: 'owner@test.com',
        role: 'ADMIN',
        tenantId: 'tenant-1',
        isActive: true,
        passwordChangedAt: null,
      }),
      USER_AUTH_CACHE_TTL_SECONDS,
    );

    expect(redisService.set).toHaveBeenCalledWith(
      getTenantActiveCacheKey('tenant-1'),
      '1',
      TENANT_ACTIVE_CACHE_TTL_SECONDS,
    );
  });

  it('skips Prisma user lookup when user auth context exists in cache', async () => {
    redisService.get.mockImplementation(async (key: string) => {
      if (key === getUserAuthCacheKey('user-1', 'session-1')) {
        return JSON.stringify({
          id: 'user-1',
          email: 'owner@test.com',
          role: 'ADMIN',
          tenantId: 'tenant-1',
          isActive: true,
          passwordChangedAt: null,
        });
      }

      if (key === getTenantActiveCacheKey('tenant-1')) {
        return '1';
      }

      return null;
    });

    await expect(
      strategy.validate({
        sub: 'user-1',
        sessionId: 'session-1',
        email: 'stale@test.com',
        role: 'MANAGER',
        tenantId: 'tenant-stale',
      }),
    ).resolves.toEqual({
      id: 'user-1',
      email: 'owner@test.com',
      role: 'ADMIN',
      tenantId: 'tenant-1',
      sessionId: 'session-1',
    });

    expect(prisma.user!.findUnique).not.toHaveBeenCalled();
  });

  it('rejects inactive users', async () => {
    (prisma.user!.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'user-1',
      email: 'owner@test.com',
      status: 'INACTIVE',
      deletedAt: null,
      tenantId: 'tenant-1',
    });

    await expect(
      strategy.validate({
        sub: 'user-1',
        sessionId: 'session-1',
        email: 'owner@test.com',
        role: 'ADMIN',
        tenantId: 'tenant-1',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects users whose tenant is inactive', async () => {
    redisService.get.mockImplementation(async (key: string) => {
      if (key === getUserAuthCacheKey('user-1', 'session-1')) {
        return JSON.stringify({
          id: 'user-1',
          email: 'owner@test.com',
          role: 'ADMIN',
          tenantId: 'tenant-1',
          isActive: true,
          passwordChangedAt: null,
        });
      }
      return null;
    });

    (prisma.tenant!.findUnique as jest.Mock).mockResolvedValueOnce({
      status: 'INACTIVE',
      deletedAt: null,
    });

    await expect(
      strategy.validate({
        sub: 'user-1',
        sessionId: 'session-1',
        email: 'owner@test.com',
        role: 'ADMIN',
        tenantId: 'tenant-1',
      }),
    ).rejects.toThrow(ForbiddenException);

    expect(prisma.user!.findUnique).not.toHaveBeenCalled();
    expect(prisma.tenant!.findUnique).toHaveBeenCalledWith({
      where: { id: 'tenant-1' },
      select: { status: true, deletedAt: true },
    });
  });
});
