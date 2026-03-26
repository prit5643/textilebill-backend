import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { OtpDeliveryService } from '../auth/otp-delivery.service';
import { ConfigService } from '@nestjs/config';

jest.mock('bcrypt');

describe('UsersService', () => {
  let service: UsersService;
  let prisma: jest.Mocked<Partial<PrismaService>>;
  let redisService: jest.Mocked<Pick<RedisService, 'del' | 'keys'>>;
  let otpDeliveryService: jest.Mocked<Pick<OtpDeliveryService, 'sendInviteEmail'>>;
  let configService: jest.Mocked<Pick<ConfigService, 'get'>>;

  beforeEach(async () => {
    prisma = {
      tenant: {
        findUnique: jest.fn(),
        update: jest.fn(),
      } as any,
      user: {
        findFirst: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      } as any,
      company: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
      } as any,
      userCompanyAccess: {
        findMany: jest.fn(),
        upsert: jest.fn(),
        deleteMany: jest.fn(),
      } as any,
      $transaction: jest.fn(),
    };

    redisService = {
      del: jest.fn().mockResolvedValue(undefined),
      keys: jest.fn().mockResolvedValue([]),
    };

    otpDeliveryService = {
      sendInviteEmail: jest.fn().mockResolvedValue(true),
    };

    configService = {
      get: jest.fn().mockReturnValue('http://localhost:3000'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redisService },
        { provide: OtpDeliveryService, useValue: otpDeliveryService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  describe('create', () => {
    it('throws ConflictException if email or username already exists', async () => {
      (prisma.tenant!.findUnique as jest.Mock).mockResolvedValueOnce({ id: 't1', subscriptions: [], users: [] });
      (prisma.user!.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'u1' });

      await expect(
        service.create('t1', {
          email: 'test@test.com',
          password: 'pass',
          firstName: 'Test',
        }),
      ).rejects.toThrow(
        'Identity is global across tenants',
      );
    });

    it('creates a user and returns non-sensitive profile fields only', async () => {
      (prisma.tenant!.findUnique as jest.Mock).mockResolvedValueOnce({ id: 't1', subscriptions: [], users: [] });
      (prisma.user!.findFirst as jest.Mock).mockResolvedValueOnce(null);
      (bcrypt.hash as jest.Mock).mockResolvedValueOnce('hashedPass');

      const createdUser = {
        id: 'u1',
        email: 'test@test.com',
        username: 'tester',
        isActive: true,
      };

      (prisma.$transaction as jest.Mock).mockImplementationOnce(
        async (callback) => {
          const tx = {
            user: { create: jest.fn().mockResolvedValue(createdUser) },
            passwordLifecycleToken: {
              updateMany: jest.fn().mockResolvedValue({ count: 0 }),
              create: jest.fn().mockResolvedValue({ id: 'token-1' }),
            },
            company: {
              findMany: jest
                .fn()
                .mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]),
            },
            userCompanyAccess: { createMany: jest.fn().mockResolvedValue({}) },
          };
          return callback(tx);
        },
      );

      const result = await service.create('t1', {
        email: 'TEST@TEST.COM',
        username: 'tester',
        password: 'pass',
        firstName: 'Test',
        companyIds: ['c1', 'c2'],
      });

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(result).toEqual(
        expect.objectContaining({
          id: createdUser.id,
          email: createdUser.email,
          isActive: createdUser.isActive,
          passwordSetupStatus: 'PENDING_SETUP',
          passwordSetupLinkSentAt: expect.any(Date),
        }),
      );
      expect(result).not.toHaveProperty('tempPassword');
      expect(otpDeliveryService.sendInviteEmail).toHaveBeenCalledTimes(1);
      expect(otpDeliveryService.sendInviteEmail).toHaveBeenCalledWith(
        'test@test.com',
        expect.stringContaining('http://localhost:3000/accept-invite?token='),
        30,
      );
    });

    it('throws BadRequestException if one or more companyIds are invalid', async () => {
      (prisma.tenant!.findUnique as jest.Mock).mockResolvedValueOnce({ id: 't1', subscriptions: [], users: [] });
      (prisma.user!.findFirst as jest.Mock).mockResolvedValueOnce(null);
      (bcrypt.hash as jest.Mock).mockResolvedValueOnce('hashedPass');

      (prisma.$transaction as jest.Mock).mockImplementationOnce(
        async (callback) => {
          const tx = {
            user: { create: jest.fn().mockResolvedValue({ id: 'u1' }) },
            passwordLifecycleToken: {
              updateMany: jest.fn().mockResolvedValue({ count: 0 }),
              create: jest.fn().mockResolvedValue({ id: 'token-1' }),
            },
            company: { findMany: jest.fn().mockResolvedValue([{ id: 'c1' }]) },
          };
          return callback(tx);
        },
      );

      await expect(
        service.create('t1', {
          email: 'test@test.com',
          username: 'tester',
          password: 'pass',
          firstName: 'Test',
          companyIds: ['c1', 'c2_invalid'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('retries generated usernames until it finds an unused value', async () => {
      (prisma.tenant!.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 't1',
        subscriptions: [],
        users: [],
      });
      (prisma.user!.findFirst as jest.Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'existing-user' })
        .mockResolvedValueOnce(null);
      (bcrypt.hash as jest.Mock).mockResolvedValueOnce('hashedPass');

      const createSpy = jest.fn().mockResolvedValue({
        id: 'u1',
        email: 'retry@test.com',
        username: 'test.user_5678',
        isActive: true,
      });

      jest
        .spyOn(service as any, 'generateUsername')
        .mockReturnValueOnce('test.user_1234')
        .mockReturnValueOnce('test.user_5678');

      (prisma.$transaction as jest.Mock).mockImplementationOnce(async (callback) => {
        const tx = {
          user: { create: createSpy },
          passwordLifecycleToken: {
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            create: jest.fn().mockResolvedValue({ id: 'token-1' }),
          },
          company: { findMany: jest.fn().mockResolvedValue([]) },
          userCompanyAccess: { createMany: jest.fn().mockResolvedValue({}) },
        };
        return callback(tx);
      });

      await service.create('t1', {
        email: 'retry@test.com',
        firstName: 'Test',
        lastName: 'User',
      });

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            username: 'test.user_5678',
          }),
        }),
      );
    });
  });

  describe('company access management', () => {
    it('scopes company access listing to the actor tenant', async () => {
      (prisma.user!.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'u1',
        tenantId: 'tenant-1',
      });
      (prisma.userCompanyAccess!.findMany as jest.Mock).mockResolvedValueOnce([
        { company: { id: 'c1' } },
      ]);

      await service.getCompanyAccess('u1', {
        role: 'TENANT_ADMIN',
        tenantId: 'tenant-1',
      });

      expect(prisma.userCompanyAccess!.findMany).toHaveBeenCalledWith({
        where: { userId: 'u1', company: { tenantId: 'tenant-1' } },
        include: {
          company: {
            select: {
              id: true,
              name: true,
              gstin: true,
              city: true,
              state: true,
            },
          },
        },
      });
    });

    it('rejects cross-tenant company assignments', async () => {
      (prisma.user!.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'u1',
        tenantId: 'tenant-1',
      });
      (prisma.company!.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'c1',
        tenantId: 'tenant-2',
      });

      await expect(
        service.addCompanyAccess('u1', 'c1', {
          role: 'SUPER_ADMIN',
          tenantId: undefined,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('clears the company-access cache after granting access', async () => {
      (prisma.user!.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'u1',
        tenantId: 'tenant-1',
      });
      (prisma.company!.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'c1',
        tenantId: 'tenant-1',
      });
      (prisma.userCompanyAccess!.upsert as jest.Mock).mockResolvedValueOnce({
        id: 'uca-1',
      });

      await service.addCompanyAccess('u1', 'c1', {
        role: 'TENANT_ADMIN',
        tenantId: 'tenant-1',
      });

      expect(prisma.userCompanyAccess!.upsert).toHaveBeenCalledWith({
        where: { userId_companyId: { userId: 'u1', companyId: 'c1' } },
        update: {},
        create: { userId: 'u1', companyId: 'c1' },
      });
      expect(redisService.del).toHaveBeenCalledWith('company-access:u1:c1');
    });

    it('requires the target company to exist in the actor scope before removal', async () => {
      (prisma.user!.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'u1',
        tenantId: 'tenant-1',
      });
      (prisma.company!.findFirst as jest.Mock).mockResolvedValueOnce(null);

      await expect(
        service.removeCompanyAccess('u1', 'missing-company', {
          role: 'TENANT_ADMIN',
          tenantId: 'tenant-1',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('auth cache invalidation', () => {
    it('clears the cached auth context when a user role changes', async () => {
      (prisma.user!.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'u1',
        tenantId: 'tenant-1',
        email: 'test@test.com',
        username: 'tester',
        role: 'STAFF',
        firstName: 'Test',
        lastName: 'User',
        phone: null,
        avatarUrl: null,
        isActive: true,
        lastLoginAt: null,
        passwordChangedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (prisma.user!.update as jest.Mock).mockResolvedValueOnce({
        id: 'u1',
        role: 'MANAGER',
      });

      (redisService.keys as jest.Mock).mockResolvedValueOnce([
        'auth:user:u1:session:s1',
      ]);

      await service.update('u1', 'tenant-1', { role: 'MANAGER' as any });

      expect(redisService.keys).toHaveBeenCalledWith('auth:user:u1:session:*');
      expect(redisService.del).toHaveBeenCalledWith('auth:user:u1:session:s1');
    });

    it('clears the cached auth context when a user is soft-deleted', async () => {
      (prisma.user!.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'u1',
        tenantId: 'tenant-1',
        email: 'test@test.com',
        username: 'tester',
        role: 'STAFF',
        firstName: 'Test',
        lastName: 'User',
        phone: null,
        avatarUrl: null,
        isActive: true,
        lastLoginAt: null,
        passwordChangedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (prisma.user!.update as jest.Mock).mockResolvedValueOnce({
        id: 'u1',
        isActive: false,
      });

      (redisService.keys as jest.Mock).mockResolvedValueOnce([
        'auth:user:u1:session:s1',
      ]);

      await service.softDelete('u1', 'tenant-1');

      expect(redisService.keys).toHaveBeenCalledWith('auth:user:u1:session:*');
      expect(redisService.del).toHaveBeenCalledWith('auth:user:u1:session:s1');
    });
  });

  describe('tenant profile synchronization', () => {
    it('syncs tenant phone when tenant admin updates own profile phone', async () => {
      (prisma.user!.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'u-admin',
        tenantId: 'tenant-1',
        email: 'admin@tenant.test',
        username: 'tenant_admin',
        role: 'TENANT_ADMIN',
        firstName: 'Admin',
        lastName: 'User',
        phone: '+919900000001',
        avatarUrl: null,
      });

      (prisma.user!.update as jest.Mock).mockResolvedValueOnce({
        id: 'u-admin',
        tenantId: 'tenant-1',
        email: 'admin@tenant.test',
        username: 'tenant_admin',
        role: 'TENANT_ADMIN',
        firstName: 'Admin',
        lastName: 'User',
        phone: '+919900000002',
        avatarUrl: null,
      });

      await service.updateMyProfile('u-admin', 'tenant-1', {
        phone: '+919900000002',
      } as any);

      expect(prisma.tenant!.update).toHaveBeenCalledWith({
        where: { id: 'tenant-1' },
        data: { phone: '+919900000002' },
      });
    });

    it('does not sync tenant phone when a non-tenant-admin updates own profile', async () => {
      (prisma.user!.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'u-staff',
        tenantId: 'tenant-1',
        email: 'staff@tenant.test',
        username: 'staff_user',
        role: 'STAFF',
        firstName: 'Staff',
        lastName: 'User',
        phone: '+919900000003',
        avatarUrl: null,
      });

      (prisma.user!.update as jest.Mock).mockResolvedValueOnce({
        id: 'u-staff',
        tenantId: 'tenant-1',
        email: 'staff@tenant.test',
        username: 'staff_user',
        role: 'STAFF',
        firstName: 'Staff',
        lastName: 'User',
        phone: '+919900000004',
        avatarUrl: null,
      });

      await service.updateMyProfile('u-staff', 'tenant-1', {
        phone: '+919900000004',
      } as any);

      expect(prisma.tenant!.update).not.toHaveBeenCalled();
    });
  });
});
