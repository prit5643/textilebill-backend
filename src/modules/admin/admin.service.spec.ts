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
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      company: {
        findFirst: jest.fn(),
      },
      plan: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      subscription: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
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

    expect(redisService.del).toHaveBeenCalledWith('auth:tenant-active:tenant-1');
    expect(redisService.del).toHaveBeenCalledWith(
      'auth:tenant-subscription:tenant-1',
    );
    expect(redisService.del).toHaveBeenCalledWith('auth:user:user-1:session:s1');
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

    expect(redisService.keys).toHaveBeenCalledWith('auth:user:user-1:session:*');
    expect(redisService.del).toHaveBeenCalledWith('auth:user:user-1:session:s1');
  });

  it('assigns subscription by expiring prior active rows and creating a single active row', async () => {
    prisma.company.findFirst.mockResolvedValueOnce({
      tenantId: 'tenant-1',
    });
    prisma.plan.findUnique.mockResolvedValueOnce({
      id: 'plan-1',
      durationDays: 30,
      price: 999,
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

    expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        deletedAt: null,
        status: 'ACTIVE',
      },
      data: { status: 'EXPIRED' },
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
    const txPlanFindFirst = jest.fn().mockResolvedValue(null);
    const txPlanCreate = jest
      .fn()
      .mockResolvedValue({ id: 'trial-plan', durationDays: 90 });
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
          create: txPlanCreate,
        },
        subscription: { create: txSubscriptionCreate },
      };

      return callback(tx);
    });

    const result = await service.createTenant({
      name: 'Alpha',
      slug: 'alpha',
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

  it('creates a 3-month free trial subscription using default plan when new tenant signs up without planId', async () => {
    (prisma.plan as any).findFirst.mockResolvedValueOnce({
      id: 'plan-free-1',
      name: 'Free Trial',
      durationDays: 90,
      price: 0
    });
    
    // Make sure properties exist in tx
    const tx = {
      tenant: { create: jest.fn().mockResolvedValue({ id: 'tenant-new' }) },
      company: { create: jest.fn().mockResolvedValue({ id: 'company-new' }) },
      user: { create: jest.fn().mockResolvedValue({ id: 'user-new' }), findFirst: jest.fn().mockResolvedValue(null) },
      userCompany: { create: jest.fn() },
      companySettings: { create: jest.fn() },
      accountGroup: { createMany: jest.fn() },
      plan: prisma.plan,
      subscription: { create: jest.fn().mockResolvedValue({ id: 'sub-new' }) }
    };

    (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb: any) => {
      return cb(tx);
    });

    const dto = {
      name: 'New Tenant LLC',
      slug: 'new-tenant-llc',
      email: 'tom@newcompany.test',
      adminFirstName: 'Admin',
      adminLastName: 'Tom',
      companyName: 'New Company',
      pwd: 'Password123'
    };

    const result = await service.createTenant(dto as any);
    
    expect(tx.subscription.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-new',
          planId: 'plan-free-1',
          status: 'ACTIVE'
        })
      })
    );
  });

});
