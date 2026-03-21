import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AdminService } from './admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { OtpDeliveryService } from '../auth/otp-delivery.service';

describe('AdminService', () => {
  let service: AdminService;
  let prisma: jest.Mocked<Partial<PrismaService>>;
  let redisService: jest.Mocked<Pick<RedisService, 'del' | 'keys'>>;
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    prisma = {
      tenant: {
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      } as any,
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      } as any,
      plan: {
        findUnique: jest.fn(),
      } as any,
      subscription: {
        create: jest.fn(),
      } as any,
      auditLog: {
        create: jest.fn(),
      } as any,
      passwordLifecycleToken: {
        create: jest.fn(),
      } as any,
      $transaction: jest.fn(),
    };

    redisService = {
      del: jest.fn().mockResolvedValue(undefined),
      keys: jest.fn().mockResolvedValue([]),
    };

    configService = { get: jest.fn() };

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

  it('clears the tenant-active cache when tenant status changes', async () => {
    (prisma.tenant!.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'tenant-1',
      users: [],
      companies: [],
      subscriptions: [],
    });
    (prisma.tenant!.update as jest.Mock).mockResolvedValueOnce({
      id: 'tenant-1',
      isActive: false,
    });

    await service.toggleTenant('tenant-1', false);

    expect(redisService.del).toHaveBeenCalledWith(
      'auth:tenant-active:tenant-1',
    );
  });

  it('clears the user auth cache when toggling a user', async () => {
    (prisma.user!.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'user-1',
      role: 'STAFF',
    });
    (prisma.user!.update as jest.Mock).mockResolvedValueOnce({
      id: 'user-1',
      isActive: false,
    });

    (redisService.keys as jest.Mock).mockResolvedValueOnce([
      'auth:user:user-1:session:s1',
    ]);

    await service.toggleUser('user-1', false);

    expect(redisService.keys).toHaveBeenCalledWith('auth:user:user-1:session:*');
    expect(redisService.del).toHaveBeenCalledWith('auth:user:user-1:session:s1');
  });

  it('clears the tenant subscription cache after assigning a subscription', async () => {
    (prisma.plan!.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'plan-1',
      durationDays: 30,
      price: 999,
    });
    (prisma.tenant!.findMany as jest.Mock).mockResolvedValueOnce([
      {
        id: 'tenant-1',
        name: 'Alpha',
        slug: 'alpha',
        gstin: '24ABCDE1234F1Z5',
        isActive: true,
        subscriptions: [],
      },
    ]);
    (prisma.subscription!.create as jest.Mock).mockResolvedValueOnce({
      id: 'sub-1',
    });

    await service.assignSubscription({
      gstin: '24ABCDE1234F1Z5',
      planId: 'plan-1',
    });

    expect(redisService.del).toHaveBeenCalledWith(
      'auth:tenant-subscription:tenant-1',
    );
  });

  it('creates a tenant without exposing temporary passwords in the response', async () => {
    (prisma.tenant!.findUnique as jest.Mock).mockResolvedValueOnce(null);
    let capturedUserCreateData: Record<string, unknown> | null = null;
    let capturedTokenCreateData: Record<string, unknown> | null = null;
    (prisma.$transaction as jest.Mock).mockImplementationOnce(
      async (callback) => {
        const tx = {
          tenant: {
            create: jest
              .fn()
              .mockResolvedValue({ id: 'tenant-1', name: 'Alpha' }),
          },
          user: {
            create: jest.fn().mockImplementation(async ({ data }) => {
              capturedUserCreateData = data;
              return { id: 'user-1', email: 'admin@alpha.test' };
            }),
          },
          passwordLifecycleToken: {
            create: jest.fn().mockImplementation(async ({ data }) => {
              capturedTokenCreateData = data;
              return { id: 'token-1', ...data };
            }),
          },
          company: {
            create: jest
              .fn()
              .mockResolvedValue({ id: 'company-1', name: 'Alpha' }),
          },
          userCompanyAccess: {
            create: jest.fn().mockResolvedValue({ id: 'uca-1' }),
          },
          plan: {
            findUnique: jest.fn().mockResolvedValue(null),
          },
        };

        return callback(tx);
      },
    );

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
    });
    expect(result).not.toHaveProperty('tempPassword');
    expect(result).toMatchObject({
      passwordSetupStatus: 'PENDING_SETUP',
      passwordSetupDeliveryStatus: 'QUEUED_OR_SENT',
    });
    expect(capturedUserCreateData).toEqual(
      expect.objectContaining({
        email: 'admin@alpha.test',
        username: 'alpha_admin',
        role: 'TENANT_ADMIN',
      }),
    );
    expect(capturedUserCreateData).toEqual(
      expect.objectContaining({
        passwordHash: expect.any(String),
        inviteToken: expect.any(String),
        inviteTokenExpiresAt: expect.any(Date),
      }),
    );
    expect(capturedTokenCreateData).toEqual(
      expect.objectContaining({
        userId: 'user-1',
        tenantId: 'tenant-1',
        type: 'SETUP_PASSWORD',
        status: 'ACTIVE',
      }),
    );
  });

  it('syncs tenant GSTIN to companies with missing GSTIN on tenant update', async () => {
    (prisma.tenant!.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'tenant-1',
      users: [],
      companies: [],
      subscriptions: [],
    });

    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const update = jest.fn().mockResolvedValue({
      id: 'tenant-1',
      gstin: '24ABCDE1234F1Z5',
    });
    const findMany = jest.fn().mockResolvedValue([{ id: 'company-1' }]);
    const updateSingleCompany = jest.fn().mockResolvedValue({ id: 'company-1' });

    (prisma.$transaction as jest.Mock).mockImplementationOnce(async (callback) => {
      const tx = {
        tenant: {
          update,
        },
        company: {
          updateMany,
          findMany,
          update: updateSingleCompany,
        },
      };

      return callback(tx);
    });

    await service.updateTenant('tenant-1', { gstin: '24ABCDE1234F1Z5' });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        OR: [{ gstin: null }, { gstin: '' }],
      },
      data: { gstin: '24ABCDE1234F1Z5' },
    });
  });
});
