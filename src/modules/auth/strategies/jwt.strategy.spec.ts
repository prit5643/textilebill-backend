import { ConfigService } from '@nestjs/config';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
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

  it('accepts active users with a current token', async () => {
    (prisma.user!.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'user-1',
      email: 'owner@test.com',
      isActive: true,
      role: 'TENANT_ADMIN',
      tenantId: 'tenant-1',
      passwordChangedAt: new Date('2026-03-01T00:00:00.000Z'),
      tenant: { isActive: true },
    });
    (prisma.tenant!.findUnique as jest.Mock).mockResolvedValueOnce({
      isActive: true,
    });

    await expect(
      strategy.validate({
        sub: 'user-1',
        sessionId: 'session-1',
        email: 'owner@test.com',
        role: 'TENANT_ADMIN',
        tenantId: 'tenant-1',
        iat: Math.floor(new Date('2026-03-02T00:00:00.000Z').getTime() / 1000),
      }),
    ).resolves.toEqual({
      id: 'user-1',
      email: 'owner@test.com',
      role: 'TENANT_ADMIN',
      tenantId: 'tenant-1',
      sessionId: 'session-1',
    });
    expect(redisService.set).toHaveBeenCalledWith(
      getUserAuthCacheKey('user-1', 'session-1'),
      JSON.stringify({
        id: 'user-1',
        email: 'owner@test.com',
        role: 'TENANT_ADMIN',
        tenantId: 'tenant-1',
        isActive: true,
        passwordChangedAt: '2026-03-01T00:00:00.000Z',
      }),
      USER_AUTH_CACHE_TTL_SECONDS,
    );
    expect(redisService.set).toHaveBeenCalledWith(
      getTenantActiveCacheKey('tenant-1'),
      '1',
      TENANT_ACTIVE_CACHE_TTL_SECONDS,
    );
  });

  it('skips Prisma user lookups when the cached auth context is present', async () => {
    redisService.get.mockImplementation(async (key: string) => {
      if (key === getUserAuthCacheKey('user-1', 'session-1')) {
        return JSON.stringify({
          id: 'user-1',
          email: 'owner@test.com',
          role: 'TENANT_ADMIN',
          tenantId: 'tenant-1',
          isActive: true,
          passwordChangedAt: '2026-03-01T00:00:00.000Z',
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
        role: 'STAFF',
        tenantId: 'tenant-stale',
        iat: Math.floor(new Date('2026-03-02T00:00:00.000Z').getTime() / 1000),
      }),
    ).resolves.toEqual({
      id: 'user-1',
      email: 'owner@test.com',
      role: 'TENANT_ADMIN',
      tenantId: 'tenant-1',
      sessionId: 'session-1',
    });

    expect(prisma.user!.findUnique).not.toHaveBeenCalled();
  });

  it('rejects tokens issued before the last password change', async () => {
    (prisma.user!.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'user-1',
      email: 'owner@test.com',
      isActive: true,
      role: 'TENANT_ADMIN',
      tenantId: 'tenant-1',
      passwordChangedAt: new Date('2026-03-02T00:00:00.000Z'),
      tenant: { isActive: true },
    });
    (prisma.tenant!.findUnique as jest.Mock).mockResolvedValueOnce({
      isActive: true,
    });

    await expect(
      strategy.validate({
        sub: 'user-1',
        sessionId: 'session-1',
        email: 'owner@test.com',
        role: 'TENANT_ADMIN',
        tenantId: 'tenant-1',
        iat: Math.floor(new Date('2026-03-01T00:00:00.000Z').getTime() / 1000),
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects users whose tenant has been deactivated', async () => {
    redisService.get.mockImplementation(async (key: string) => {
      if (key === getUserAuthCacheKey('user-1', 'session-1')) {
        return JSON.stringify({
          id: 'user-1',
          email: 'owner@test.com',
          role: 'TENANT_ADMIN',
          tenantId: 'tenant-1',
          isActive: true,
          passwordChangedAt: null,
        });
      }

      return null;
    });
    (prisma.tenant!.findUnique as jest.Mock).mockResolvedValueOnce({
      isActive: false,
    });

    await expect(
      strategy.validate({
        sub: 'user-1',
        sessionId: 'session-1',
        email: 'owner@test.com',
        role: 'TENANT_ADMIN',
        tenantId: 'tenant-1',
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.user!.findUnique).not.toHaveBeenCalled();
    expect(prisma.tenant!.findUnique).toHaveBeenCalledWith({
      where: { id: 'tenant-1' },
      select: { isActive: true },
    });
  });
});
