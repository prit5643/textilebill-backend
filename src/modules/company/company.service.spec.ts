import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
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
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn(),
      } as any,
      companySettings: {
        upsert: jest.fn().mockResolvedValue({ id: 'settings-1' }),
      } as any,
      tenant: {
        update: jest.fn(),
      } as any,
      user: {
        findMany: jest.fn().mockResolvedValue([]),
      } as any,
      $transaction: jest.fn(),
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
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'app.secretKey' ? 'test-app-secret' : undefined,
            ),
          },
        },
      ],
    }).compile();

    service = module.get<CompanyService>(CompanyService);
  });

  it('filters company lists by user access for non-admin roles', async () => {
    await service.findAllForActor('tenant-1', 1, 25, {
      userId: 'user-1',
      role: 'STAFF',
    });

    expect(prisma.company!.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: 'tenant-1',
          userAccess: {
            some: {
              userId: 'user-1',
            },
          },
        },
      }),
    );
    expect(prisma.company!.count).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        userAccess: {
          some: {
            userId: 'user-1',
          },
        },
      },
    });
  });

  it('does not add a user-access filter for tenant admins', async () => {
    await service.findAllForActor('tenant-1', 1, 25, {
      userId: 'admin-1',
      role: 'TENANT_ADMIN',
    });

    expect(prisma.company!.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: 'tenant-1',
        },
      }),
    );
    expect(prisma.company!.count).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
      },
    });
  });

  it('uses header view projection for lightweight switcher payloads', async () => {
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
        city: true,
        state: true,
        isActive: true,
      }),
    );
    expect(queryArg.select.tenantId).toBeUndefined();
  });

  it('uses default list projection without heavy relations', async () => {
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
        city: true,
        state: true,
        isActive: true,
      }),
    );
    expect(queryArg.include).toBeUndefined();
  });

  it('encrypts credential fields when updating company settings', async () => {
    (prisma.company!.findFirst as jest.Mock).mockResolvedValue({
      id: 'company-1',
      tenantId: 'tenant-1',
      settings: null,
      financialYears: [],
      _count: { products: 0, accounts: 0, invoices: 0 },
    } as any);

    await service.updateSettings('company-1', 'tenant-1', {
      ewayBillPassword: 'eway-pass',
      einvoicePassword: 'einvoice-pass',
    } as any);

    expect(prisma.companySettings!.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          ewayBillPassword: null,
          einvoicePassword: null,
          ewayBillPasswordEnc: expect.any(String),
          einvoicePasswordEnc: expect.any(String),
        }),
      }),
    );
  });

  it('syncs tenant profile fields when updating the only active company', async () => {
    (prisma.company!.findFirst as jest.Mock).mockResolvedValue({
      id: 'company-1',
      tenantId: 'tenant-1',
      settings: null,
      financialYears: [],
      _count: { products: 0, accounts: 0, invoices: 0 },
    } as any);

    const companyUpdate = jest.fn().mockResolvedValue({
      id: 'company-1',
      tenantId: 'tenant-1',
      name: 'Alpha Textiles',
      gstin: '24ABCDE1234F1Z5',
      city: 'Surat',
    });
    const activeCompanies = jest.fn().mockResolvedValue([{ id: 'company-1' }]);
    const tenantUpdate = jest.fn().mockResolvedValue({ id: 'tenant-1' });

    (prisma.$transaction as jest.Mock).mockImplementationOnce(async (callback) =>
      callback({
        company: {
          update: companyUpdate,
          findMany: activeCompanies,
        },
        tenant: {
          update: tenantUpdate,
        },
      }),
    );

    await service.update('company-1', 'tenant-1', {
      name: 'Alpha Textiles',
      gstin: '24ABCDE1234F1Z5',
      city: 'Surat',
    } as any);

    expect(tenantUpdate).toHaveBeenCalledWith({
      where: { id: 'tenant-1' },
      data: {
        name: 'Alpha Textiles',
        gstin: '24ABCDE1234F1Z5',
        city: 'Surat',
      },
    });
  });

  it('does not sync tenant profile when tenant has multiple active companies', async () => {
    (prisma.company!.findFirst as jest.Mock).mockResolvedValue({
      id: 'company-1',
      tenantId: 'tenant-1',
      settings: null,
      financialYears: [],
      _count: { products: 0, accounts: 0, invoices: 0 },
    } as any);

    const tenantUpdate = jest.fn().mockResolvedValue({ id: 'tenant-1' });

    (prisma.$transaction as jest.Mock).mockImplementationOnce(async (callback) =>
      callback({
        company: {
          update: jest.fn().mockResolvedValue({
            id: 'company-1',
            tenantId: 'tenant-1',
            gstin: '24ABCDE1234F1Z5',
          }),
          findMany: jest
            .fn()
            .mockResolvedValue([{ id: 'company-1' }, { id: 'company-2' }]),
        },
        tenant: {
          update: tenantUpdate,
        },
      }),
    );

    await service.update('company-1', 'tenant-1', {
      gstin: '24ABCDE1234F1Z5',
    } as any);

    expect(tenantUpdate).not.toHaveBeenCalled();
  });
});
