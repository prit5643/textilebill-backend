import { Test, TestingModule } from '@nestjs/testing';
import { CompanyService } from './company.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

describe('CompanyService', () => {
  let service: CompanyService;
  let prisma: jest.Mocked<Partial<PrismaService>>;
  let redisService: jest.Mocked<Pick<RedisService, 'del' | 'keys'>>;

  beforeEach(async () => {
    prisma = {
      company: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn(),
        update: jest.fn(),
      } as any,
      user: {
        findMany: jest.fn().mockResolvedValue([]),
      } as any,
    };

    redisService = {
      del: jest.fn().mockResolvedValue(undefined),
      keys: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompanyService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redisService },
      ],
    }).compile();

    service = module.get<CompanyService>(CompanyService);
  });

  it('filters company lists by userCompanies for non-admin roles', async () => {
    await service.findAllForActor('tenant-1', 1, 25, {
      userId: 'user-1',
      role: 'STAFF',
    });

    expect(prisma.company!.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: 'tenant-1',
          deletedAt: null,
          userCompanies: { some: { userId: 'user-1' } },
        },
      }),
    );
  });

  it('does not add userCompanies filter for tenant admins', async () => {
    await service.findAllForActor('tenant-1', 1, 25, {
      userId: 'admin-1',
      role: 'TENANT_ADMIN',
    });

    expect(prisma.company!.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: 'tenant-1',
          deletedAt: null,
        },
      }),
    );
  });

  it('uses header projection for company switcher payloads', async () => {
    await service.findAllForActor(
      'tenant-1',
      1,
      25,
      { userId: 'user-1', role: 'STAFF' },
      'header',
    );

    const queryArg = (prisma.company!.findMany as jest.Mock).mock.calls[0][0];
    expect(queryArg.select).toEqual(
      expect.objectContaining({
        id: true,
        name: true,
        gstin: true,
        status: true,
      }),
    );
    expect(queryArg.select.tenantId).toBeUndefined();
  });

  it('uses default projection for company listing pages', async () => {
    await service.findAllForActor('tenant-1', 1, 25, {
      userId: 'admin-1',
      role: 'TENANT_ADMIN',
    });

    const queryArg = (prisma.company!.findMany as jest.Mock).mock.calls[0][0];
    expect(queryArg.select).toEqual(
      expect.objectContaining({
        id: true,
        tenantId: true,
        name: true,
        gstin: true,
        address: true,
        phone: true,
        email: true,
        status: true,
      }),
    );
    expect(queryArg.include).toBeUndefined();
  });

  it('clears tenant/user caches when company is updated', async () => {
    (prisma.company!.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'company-1',
      tenantId: 'tenant-1',
      deletedAt: null,
      financialYears: [],
      _count: { products: 0, accounts: 0, invoices: 0 },
    });
    (prisma.company!.update as jest.Mock).mockResolvedValueOnce({
      id: 'company-1',
      name: 'Alpha Textiles',
    });
    (prisma.user!.findMany as jest.Mock).mockResolvedValueOnce([{ id: 'user-1' }]);
    (redisService.keys as jest.Mock).mockResolvedValueOnce([
      'auth:user:user-1:session:s1',
    ]);

    await service.update('company-1', 'tenant-1', {
      name: 'Alpha Textiles',
    } as any);

    expect(redisService.del).toHaveBeenCalledWith('auth:tenant-active:tenant-1');
    expect(redisService.del).toHaveBeenCalledWith(
      'auth:tenant-subscription:tenant-1',
    );
    expect(redisService.del).toHaveBeenCalledWith('auth:user:user-1:session:s1');
  });
});
