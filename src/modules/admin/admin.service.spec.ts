import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { EntityStatus } from '@prisma/client';
import { AdminService } from './admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { OtpDeliveryService } from '../auth/otp-delivery.service';

describe('AdminService', () => {
  let service: AdminService;
  let prisma: any;
  let redisService: any;

  beforeEach(async () => {
    prisma = {
      tenant: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      user: {
        groupBy: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      company: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      plan: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      subscription: {
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      auditLog: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation(async (callback: any) => {
        return callback(prisma);
      }),
    };

    redisService = {
      del: jest.fn().mockResolvedValue(undefined),
      keys: jest.fn().mockResolvedValue([]),
      set: jest.fn().mockResolvedValue('OK'),
    };

    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'app.url') {
          return 'http://localhost:3000';
        }
        return undefined;
      }),
    };

    const mockOtpDeliveryService = {
      sendInviteEmail: jest.fn().mockResolvedValue(true),
      sendPasswordResetLinkEmail: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redisService },
        { provide: ConfigService, useValue: configService },
        { provide: OtpDeliveryService, useValue: mockOtpDeliveryService },
      ],
    }).compile();

    service = module.get(AdminService);
  });

  it('clears tenant and user auth caches when tenant status changes', async () => {
    prisma.tenant.findUnique.mockResolvedValueOnce({
      id: 'tenant-1',
      deletedAt: null,
      users: [],
      companies: [],
    });
    prisma.tenant.update.mockResolvedValueOnce({
      id: 'tenant-1',
      status: EntityStatus.INACTIVE,
    });
    prisma.user.findMany.mockResolvedValueOnce([{ id: 'user-1' }]);
    redisService.keys.mockResolvedValueOnce(['auth:user:user-1:session:s1']);

    await service.toggleTenant('tenant-1', false);

    expect(redisService.del).toHaveBeenCalledWith(
      'auth:tenant-active:tenant-1',
    );
    expect(redisService.del).toHaveBeenCalledWith(
      'auth:tenant-subscription:tenant-1',
    );
    expect(redisService.del).toHaveBeenCalledWith(
      'auth:user:user-1:session:s1',
    );
  });

  it('clears the user auth cache when toggling a user', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ id: 'user-1' });
    prisma.user.update.mockResolvedValueOnce({
      id: 'user-1',
      email: 'user@test.com',
      name: 'User',
      status: EntityStatus.INACTIVE,
    });
    redisService.keys.mockResolvedValueOnce(['auth:user:user-1:session:s1']);

    await service.toggleUser('user-1', false);

    expect(redisService.keys).toHaveBeenCalledWith(
      'auth:user:user-1:session:*',
    );
    expect(redisService.del).toHaveBeenCalledWith(
      'auth:user:user-1:session:s1',
    );
  });

  it('assigns subscription by expiring prior active rows and creating a single active row', async () => {
    prisma.company.findFirst.mockResolvedValueOnce({
      tenantId: 'tenant-1',
    });
    prisma.plan.findUnique.mockResolvedValueOnce({
      id: 'plan-1',
      durationDays: 30,
      price: 999,
      status: EntityStatus.ACTIVE,
      deletedAt: null,
    });
    prisma.subscription.findFirst.mockResolvedValueOnce({
      endDate: new Date('2026-03-31T06:00:00.000Z'),
    });
    prisma.subscription.create.mockResolvedValueOnce({
      id: 'sub-2',
      tenantId: 'tenant-1',
      planId: 'plan-1',
      status: 'ACTIVE',
    });

    const result = await service.assignSubscription({
      gstin: '24abcde1234f1z5',
      planId: 'plan-1',
    });

    expect(prisma.subscription.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        tenantId: 'tenant-1',
        deletedAt: null,
        status: 'ACTIVE',
      },
      data: {
        status: 'EXPIRED',
        endDate: expect.any(Date),
      },
    });
    expect(prisma.subscription.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        tenantId: 'tenant-1',
        deletedAt: null,
        status: 'ACTIVE',
        id: { not: 'sub-2' },
      },
      data: {
        status: 'EXPIRED',
        endDate: expect.any(Date),
      },
    });
    expect(prisma.subscription.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        planId: 'plan-1',
        amountPaid: 999,
        status: 'ACTIVE',
        paymentStatus: 'PAID',
        startDate: expect.any(Date),
        endDate: expect.any(Date),
      }),
    });
    expect(redisService.del).toHaveBeenCalledWith(
      'auth:tenant-subscription:tenant-1',
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: 'sub-2',
        tenantId: 'tenant-1',
      }),
    );
  });

  it('createTenant returns setup status without exposing raw password', async () => {
    prisma.tenant.findUnique.mockResolvedValueOnce(null);
    prisma.tenant.findFirst.mockResolvedValueOnce(null);

    const txTenantCreate = jest
      .fn()
      .mockResolvedValue({ id: 'tenant-1', name: 'Alpha', slug: 'alpha' });
    const txCompanyCreate = jest
      .fn()
      .mockResolvedValue({ id: 'company-1', name: 'Alpha' });
    const txUserCreate = jest
      .fn()
      .mockResolvedValue({ id: 'user-1', email: 'admin@alpha.test' });
    const txUserCompanyCreate = jest.fn().mockResolvedValue({ id: 'uc-1' });
    const txPlanFindFirst = jest
      .fn()
      .mockResolvedValue({ id: 'starter-plan', durationDays: 90, price: 499 });
    const txSubscriptionCreate = jest.fn().mockResolvedValue({ id: 'sub-1' });

    prisma.$transaction.mockImplementationOnce(async (callback: any) => {
      const tx = {
        tenant: { create: txTenantCreate },
        company: { create: txCompanyCreate },
        user: { create: txUserCreate },
        userCompany: { create: txUserCompanyCreate },
        plan: {
          findUnique: jest.fn().mockResolvedValue(null),
          findFirst: txPlanFindFirst,
          create: jest.fn(),
        },
        subscription: { create: txSubscriptionCreate },
      };

      return callback(tx);
    });

    const result = await service.createTenant({
      name: 'Alpha',
      email: 'admin@alpha.test',
      adminFirstName: 'Admin',
      adminLastName: 'User',
    });

    expect(result).toMatchObject({
      tenant: { id: 'tenant-1' },
      user: { id: 'user-1' },
      company: { id: 'company-1' },
      passwordSetupStatus: 'PENDING_SETUP',
      passwordSetupDeliveryStatus: 'QUEUED_OR_SENT',
    });
    expect(result).not.toHaveProperty('tempPassword');
    expect(txUserCompanyCreate).toHaveBeenCalledWith({
      data: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        companyId: 'company-1',
        role: 'ADMIN',
      },
    });
    expect(redisService.set).toHaveBeenCalledWith(
      expect.stringMatching(/^auth:setup-link:/),
      'user-1',
      1800,
    );
  });

  it('rejects updateSubscription when both endDate and extendDays are passed', async () => {
    prisma.subscription.findUnique.mockResolvedValueOnce({
      id: 'sub-1',
      tenantId: 'tenant-1',
      status: 'ACTIVE',
      endDate: new Date('2026-04-01T00:00:00.000Z'),
    });

    await expect(
      service.updateSubscription('sub-1', {
        endDate: '2026-04-20',
        extendDays: 10,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects updateSubscription when extendDays is non-positive', async () => {
    prisma.subscription.findUnique.mockResolvedValueOnce({
      id: 'sub-1',
      tenantId: 'tenant-1',
      status: 'ACTIVE',
      endDate: new Date('2026-04-01T00:00:00.000Z'),
    });

    await expect(
      service.updateSubscription('sub-1', {
        extendDays: 0,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('auto-assigns an active configured plan when tenant signs up without planId', async () => {
    prisma.tenant.findUnique.mockResolvedValue(null);
    prisma.tenant.findFirst.mockResolvedValue(null);
    
    (prisma.plan as any).findFirst.mockResolvedValueOnce({
      id: 'plan-starter-1',
      name: 'Starter Plan',
      durationDays: 90,
      price: 1299,
    });

    // Make sure properties exist in tx
    const tx = {
      tenant: { create: jest.fn().mockResolvedValue({ id: 'tenant-new' }) },
      company: { create: jest.fn().mockResolvedValue({ id: 'company-new' }) },
      user: {
        create: jest.fn().mockResolvedValue({ id: 'user-new' }),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      userCompany: { create: jest.fn() },
      companySettings: { create: jest.fn() },
      accountGroup: { createMany: jest.fn() },
      plan: prisma.plan,
      subscription: { create: jest.fn().mockResolvedValue({ id: 'sub-new' }) },
    };

    (prisma.$transaction as jest.Mock).mockImplementationOnce(
      async (cb: any) => {
        return cb(tx);
      },
    );

    const dto = {
      name: 'New Tenant LLC',
      email: 'tom@newcompany.test',
      adminFirstName: 'Admin',
      adminLastName: 'Tom',
      companyName: 'New Company',
      pwd: 'Password123',
    };

    await service.createTenant(dto as any);

    expect(tx.subscription.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-new',
          planId: 'plan-starter-1',
          amountPaid: 1299,
          status: 'ACTIVE',
        }),
      }),
    );
  });

  it('listTenants should count only users with company access in tenant table payload', async () => {
    prisma.tenant.findMany.mockResolvedValueOnce([
      {
        id: 'tenant-1',
        name: 'Tenant One',
        _count: { users: 3, companies: 1 },
        companies: [],
      },
      {
        id: 'tenant-2',
        name: 'Tenant Two',
        _count: { users: 4, companies: 1 },
        companies: [],
      },
    ]);
    prisma.tenant.count.mockResolvedValueOnce(2);
    prisma.user.groupBy.mockResolvedValueOnce([
      { tenantId: 'tenant-1', _count: { _all: 1 } },
      { tenantId: 'tenant-2', _count: { _all: 2 } },
    ]);

    const result = await service.listTenants({ page: 1, limit: 10 });

    expect(prisma.user.groupBy).toHaveBeenCalledWith({
      by: ['tenantId'],
      where: {
        tenantId: { in: ['tenant-1', 'tenant-2'] },
        deletedAt: null,
        userCompanies: { some: {} },
        NOT: {
          userCompanies: {
            some: {
              role: 'OWNER',
            },
          },
        },
      },
      _count: { _all: true },
    });
    expect(result.data[0]._count.users).toBe(1);
    expect(result.data[1]._count.users).toBe(2);
  });

  it('listTenants should expose tenant active flag and company location fields', async () => {
    prisma.tenant.findMany.mockResolvedValueOnce([
      {
        id: 'tenant-1',
        name: 'Tenant One',
        status: EntityStatus.ACTIVE,
        _count: { users: 1, companies: 1 },
        companies: [
          {
            id: 'company-1',
            name: 'Tenant One Co',
            gstin: '24ABCDE1234F1Z5',
            address: 'Ring Road',
            city: 'Surat',
            state: 'Gujarat',
            pincode: '395001',
            phone: '+919876543210',
            email: 'tenant@example.com',
            status: EntityStatus.ACTIVE,
          },
        ],
      },
    ]);
    prisma.tenant.count.mockResolvedValueOnce(1);
    prisma.user.groupBy.mockResolvedValueOnce([
      { tenantId: 'tenant-1', _count: { _all: 1 } },
    ]);

    const result = await service.listTenants({ page: 1, limit: 10 });

    expect(result.data[0]).toEqual(
      expect.objectContaining({
        isActive: true,
        city: 'Surat',
        state: 'Gujarat',
        pincode: '395001',
      }),
    );
  });

  it('listTenants should fallback when city/state columns are missing in DB', async () => {
    prisma.tenant.findMany
      .mockRejectedValueOnce({ code: 'P2022', meta: { column: 'city' } })
      .mockResolvedValueOnce([
        {
          id: 'tenant-1',
          name: 'Tenant One',
          status: EntityStatus.ACTIVE,
          _count: { users: 1, companies: 1 },
          companies: [
            {
              id: 'company-1',
              name: 'Tenant One Co',
              gstin: '24ABCDE1234F1Z5',
              address: 'Ring Road',
              pincode: '395001',
              phone: '+919876543210',
              email: 'tenant@example.com',
              status: EntityStatus.ACTIVE,
            },
          ],
        },
      ]);
    prisma.tenant.count.mockResolvedValueOnce(1);
    prisma.user.groupBy.mockResolvedValueOnce([
      { tenantId: 'tenant-1', _count: { _all: 1 } },
    ]);

    const result = await service.listTenants({ page: 1, limit: 10 });

    expect(prisma.tenant.findMany).toHaveBeenCalledTimes(2);
    expect(result.data[0]).toEqual(
      expect.objectContaining({
        city: null,
        state: null,
      }),
    );
  });

  it('getTenant should request only users who have company access', async () => {
    prisma.tenant.findUnique.mockResolvedValueOnce({
      id: 'tenant-1',
      deletedAt: null,
      users: [],
      companies: [],
    });

    await service.getTenant('tenant-1');

    expect(prisma.tenant.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tenant-1' },
        include: expect.objectContaining({
          users: expect.objectContaining({
            where: {
              deletedAt: null,
              userCompanies: {
                some: {},
              },
              NOT: {
                userCompanies: {
                  some: {
                    role: 'OWNER',
                  },
                },
              },
            },
          }),
        }),
      }),
    );
  });

  it('getTenant should fallback when city/state columns are missing in DB', async () => {
    prisma.tenant.findUnique
      .mockRejectedValueOnce({ code: 'P2022', meta: { column: 'state' } })
      .mockResolvedValueOnce({
        id: 'tenant-1',
        status: EntityStatus.ACTIVE,
        deletedAt: null,
        users: [],
        companies: [
          {
            id: 'company-1',
            tenantId: 'tenant-1',
            name: 'Tenant One Co',
            gstin: '24ABCDE1234F1Z5',
            address: 'Ring Road',
            pincode: '395001',
            phone: '+919876543210',
            email: 'tenant@example.com',
            status: EntityStatus.ACTIVE,
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
          },
        ],
      });

    const result = await service.getTenant('tenant-1');

    expect(prisma.tenant.findUnique).toHaveBeenCalledTimes(2);
    expect(result).toEqual(
      expect.objectContaining({
        city: null,
        state: null,
      }),
    );
  });

  it('updateTenant should persist city and state onto primary company', async () => {
    prisma.tenant.findUnique.mockResolvedValueOnce({
      id: 'tenant-1',
      status: EntityStatus.ACTIVE,
      deletedAt: null,
      users: [],
      companies: [],
    });
    prisma.tenant.update.mockResolvedValueOnce({
      id: 'tenant-1',
      name: 'Tenant One',
    });
    prisma.company.findFirst.mockResolvedValueOnce({ id: 'company-1' });
    prisma.company.update.mockResolvedValueOnce({ id: 'company-1' });
    prisma.user.findMany.mockResolvedValueOnce([]);

    await service.updateTenant('tenant-1', {
      city: 'Surat',
      state: 'Gujarat',
      pincode: '395001',
    });

    expect(prisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'company-1' },
        data: expect.objectContaining({
          city: 'Surat',
          state: 'Gujarat',
          pincode: '395001',
        }),
      }),
    );
  });

  it('toggleTenant should not soft-delete tenant row', async () => {
    prisma.tenant.findUnique.mockResolvedValueOnce({
      id: 'tenant-1',
      status: EntityStatus.ACTIVE,
      deletedAt: null,
      users: [],
      companies: [],
    });
    prisma.tenant.update.mockResolvedValueOnce({
      id: 'tenant-1',
      status: EntityStatus.INACTIVE,
      deletedAt: null,
    });
    prisma.user.findMany.mockResolvedValueOnce([]);

    await service.toggleTenant('tenant-1', false);

    expect(prisma.tenant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tenant-1' },
        data: expect.objectContaining({
          status: EntityStatus.INACTIVE,
          deletedAt: null,
        }),
      }),
    );
  });

  it('listSubscriptions should expose tenant GSTIN from primary active company', async () => {
    prisma.subscription.findMany.mockResolvedValueOnce([
      {
        id: 'sub-1',
        tenantId: 'tenant-1',
        planId: 'plan-1',
        startDate: new Date('2026-04-01T00:00:00.000Z'),
        endDate: new Date('2026-07-01T00:00:00.000Z'),
        status: 'ACTIVE',
        paymentStatus: 'PAID',
        amountPaid: 0,
        tenant: {
          id: 'tenant-1',
          name: 'Mahakali',
          companies: [{ gstin: '24ABCDE1234F1Z5' }],
        },
        plan: { id: 'plan-1', name: 'Starter', description: 'Starter' },
      },
    ]);
    prisma.subscription.count.mockResolvedValueOnce(1);

    const result = await service.listSubscriptions({ page: 1, limit: 10 });

    expect(prisma.subscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          tenant: expect.objectContaining({
            select: expect.objectContaining({
              companies: expect.objectContaining({
                take: 1,
              }),
            }),
          }),
        }),
      }),
    );
    expect(result.data[0]?.tenant).toEqual(
      expect.objectContaining({
        id: 'tenant-1',
        name: 'Mahakali',
        gstin: '24ABCDE1234F1Z5',
      }),
    );
  });

  it('listAllUsers should include only tenant users with company access', async () => {
    prisma.user.findMany.mockResolvedValueOnce([
      {
        id: 'user-1',
        tenantId: 'tenant-1',
        email: 'tenant@demo.test',
        name: 'Tenant User',
        phone: null,
        status: 'ACTIVE',
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
        _count: {
          refreshTokens: 1,
        },
        refreshTokens: [{ createdAt: new Date('2026-04-02T00:00:00.000Z') }],
        tenant: { id: 'tenant-1', name: 'Tenant One', status: 'ACTIVE' },
        userCompanies: [
          { role: 'ADMIN', company: { id: 'company-1', name: 'Main' } },
        ],
      },
    ]);
    prisma.user.count.mockResolvedValueOnce(1);

    const result = await service.listAllUsers({ page: 1, limit: 10 });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
          userCompanies: {
            some: {},
          },
          NOT: {
            userCompanies: {
              some: {
                role: 'OWNER',
              },
            },
          },
        }),
      }),
    );
    expect(prisma.user.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
          userCompanies: {
            some: {},
          },
          NOT: {
            userCompanies: {
              some: {
                role: 'OWNER',
              },
            },
          },
        }),
      }),
    );
    expect(result.data).toHaveLength(1);
    expect(result.data[0].email).toBe('tenant@demo.test');
    expect(result.data[0].passwordSetupStatus).toBe('SETUP_COMPLETED');
    expect(result.data[0].lastLoginAt).toEqual(
      new Date('2026-04-02T00:00:00.000Z'),
    );
  });

  it('getAuditLogs should return paginated rows from persisted audit logs', async () => {
    prisma.auditLog.findMany.mockResolvedValueOnce([
      {
        id: 'log-1',
        action: 'POST USERS',
        entity: 'USERS',
        entityId: 'user-1',
        method: 'POST',
        path: '/admin/users',
        statusCode: 201,
        createdAt: new Date('2026-04-06T10:00:00.000Z'),
        user: { id: 'user-1', email: 'admin@test.com', name: 'Admin' },
        company: { id: 'company-1', name: 'Acme' },
      },
    ]);
    prisma.auditLog.count.mockResolvedValueOnce(1);

    const result = await service.getAuditLogs({
      page: 1,
      limit: 50,
      companyId: 'company-1',
      entity: 'USERS',
    });

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: 'company-1',
          entity: {
            equals: 'USERS',
            mode: 'insensitive',
          },
        }),
      }),
    );
    expect(result.data).toHaveLength(1);
    expect(result.meta.total).toBe(1);
  });
});
