import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RequireCompanyAccess } from '../decorators';
import { PrismaService } from '../../modules/prisma/prisma.service';
import { RedisService } from '../../modules/redis/redis.service';
import { CompanyAccessGuard } from './company-access.guard';

class HeaderScopedController {
  @RequireCompanyAccess()
  handler() {}
}

class ParamScopedController {
  @RequireCompanyAccess({ source: 'param', key: 'id' })
  handler() {}
}

class BodyScopedController {
  @RequireCompanyAccess({ source: 'body', key: 'companyId' })
  handler() {}
}

class PublicController {
  handler() {}
}

describe('CompanyAccessGuard', () => {
  let guard: CompanyAccessGuard;
  let prisma: jest.Mocked<Pick<PrismaService, 'company'>>;
  let redisService: jest.Mocked<Pick<RedisService, 'get' | 'set'>>;

  beforeEach(() => {
    prisma = {
      company: {
        findFirst: jest.fn(),
      },
    } as unknown as jest.Mocked<Pick<PrismaService, 'company'>>;

    redisService = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<Pick<RedisService, 'get' | 'set'>>;

    guard = new CompanyAccessGuard(
      new Reflector(),
      prisma as unknown as PrismaService,
      redisService as unknown as RedisService,
    );
  });

  it('skips routes without company-access metadata', async () => {
    const context = createContext(
      { user: { id: 'user-1', role: 'MANAGER', tenantId: 'tenant-1' } },
      PublicController,
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.company.findFirst).not.toHaveBeenCalled();
  });

  it('rejects header-scoped routes without a company header', async () => {
    const context = createContext(
      { user: { id: 'user-1', role: 'MANAGER', tenantId: 'tenant-1' } },
      HeaderScopedController,
    );

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('allows cached access without hitting the database', async () => {
    const request = {
      companyId: 'company-1',
      user: { id: 'user-1', role: 'MANAGER', tenantId: 'tenant-1' },
    };
    redisService.get.mockResolvedValueOnce('1');

    const context = createContext(request, HeaderScopedController);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.company.findFirst).not.toHaveBeenCalled();
    expect(request.companyId).toBe('company-1');
  });

  it('validates param-scoped company access for tenant-wide admins', async () => {
    (prisma.company.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'company-9',
    });

    const context = createContext(
      {
        params: { id: 'company-9' },
        user: { id: 'admin-1', role: 'ADMIN', tenantId: 'tenant-1' },
      },
      ParamScopedController,
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.company.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'company-9',
        tenantId: 'tenant-1',
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: { id: true },
    });
  });

  it('rejects body-scoped company access when the user has no assignment', async () => {
    (prisma.company.findFirst as jest.Mock).mockResolvedValueOnce(null);

    const context = createContext(
      {
        body: { companyId: 'company-7' },
        user: { id: 'staff-1', role: 'MANAGER', tenantId: 'tenant-1' },
      },
      BodyScopedController,
    );

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.company.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'company-7',
        tenantId: 'tenant-1',
        status: 'ACTIVE',
        deletedAt: null,
        userCompanies: {
          some: {
            userId: 'staff-1',
            tenantId: 'tenant-1',
          },
        },
      },
      select: { id: true },
    });
    expect(redisService.set).toHaveBeenCalledWith(
      'company-access:staff-1:company-7',
      '0',
      60,
    );
  });

  it('allows super admins to access any existing company', async () => {
    (prisma.company.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'company-1',
    });

    const context = createContext(
      {
        companyId: 'company-1',
        user: { id: 'super-1', role: 'SUPER_ADMIN' },
      },
      HeaderScopedController,
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.company.findFirst).toHaveBeenCalledWith({
      where: { id: 'company-1', status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    expect(redisService.set).toHaveBeenCalledWith(
      'company-access:super-1:company-1',
      '1',
      300,
    );
  });
});

function createContext(
  request: Record<string, unknown>,
  controller: new () => unknown,
): ExecutionContext {
  return {
    getHandler: () => controller.prototype.handler,
    getClass: () => controller,
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as ExecutionContext;
}
