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
  let redisService: jest.Mocked<Pick<RedisService, 'set' | 'del' | 'keys'>>;
  let otpDeliveryService: jest.Mocked<
    Pick<OtpDeliveryService, 'sendInviteEmail' | 'sendPasswordResetLinkEmail'>
  >;
  let configService: jest.Mocked<Pick<ConfigService, 'get'>>;

  beforeEach(async () => {
    prisma = {
      tenant: {
        findFirst: jest.fn(),
      } as any,
      user: {
        findFirst: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn(),
      } as any,
      company: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
      } as any,
      userCompany: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        upsert: jest.fn(),
        deleteMany: jest.fn(),
        updateMany: jest.fn(),
        createMany: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      } as any,
      subscription: {
        findFirst: jest.fn().mockResolvedValue({
          plan: {
            maxUsers: 5,
            maxCompanies: 5,
          },
        }),
      } as any,
      refreshToken: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      } as any,
      $transaction: jest.fn(),
    };

    redisService = {
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
      keys: jest.fn().mockResolvedValue([]),
    };

    otpDeliveryService = {
      sendInviteEmail: jest.fn().mockResolvedValue(true),
      sendPasswordResetLinkEmail: jest.fn().mockResolvedValue(true),
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
    it('throws ConflictException if email already exists in tenant', async () => {
      (prisma.tenant!.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 't1',
      });
      (prisma.user!.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'u1' });

      await expect(
        service.create('t1', {
          email: 'test@test.com',
          password: 'pass12345',
          firstName: 'Test',
        } as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('creates a user and assigns company access rows', async () => {
      (prisma.tenant!.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 't1',
      });
      (prisma.user!.findFirst as jest.Mock).mockResolvedValueOnce(null);
      (bcrypt.hash as jest.Mock).mockResolvedValueOnce('hashed-pass');

      const txUserCreate = jest.fn().mockResolvedValue({
        id: 'u1',
        tenantId: 't1',
        email: 'test@test.com',
        name: 'Test User',
        phone: null,
        status: 'ACTIVE',
        createdAt: new Date('2026-03-28T00:00:00.000Z'),
        updatedAt: new Date('2026-03-28T00:00:00.000Z'),
        deletedAt: null,
        userCompanies: [],
      });

      const txCompanyFindMany = jest
        .fn()
        .mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
      const txUserCompanyCreateMany = jest.fn().mockResolvedValue({ count: 2 });

      (prisma.$transaction as jest.Mock).mockImplementationOnce(
        async (callback) => {
          const tx = {
            user: { create: txUserCreate },
            company: { findMany: txCompanyFindMany },
            userCompany: { createMany: txUserCompanyCreateMany },
          };
          return callback(tx);
        },
      );

      const result = await service.create('t1', {
        email: 'TEST@TEST.COM',
        firstName: 'Test',
        lastName: 'User',
        password: 'TempPass123!',
        role: 'MANAGER' as any,
        companyIds: ['c1', 'c2'],
      });

      expect(txUserCompanyCreateMany).toHaveBeenCalledWith({
        data: [
          {
            tenantId: 't1',
            userId: 'u1',
            companyId: 'c1',
            role: 'MANAGER',
          },
          {
            tenantId: 't1',
            userId: 'u1',
            companyId: 'c2',
            role: 'MANAGER',
          },
        ],
        skipDuplicates: true,
      });

      expect(result).toEqual(
        expect.objectContaining({
          id: 'u1',
          email: 'test@test.com',
          status: 'ACTIVE',
          isActive: true,
          passwordSetupStatus: 'PENDING_SETUP',
          passwordSetupLinkSentAt: expect.any(Date),
        }),
      );

      expect(otpDeliveryService.sendInviteEmail).toHaveBeenCalledTimes(1);
      expect(otpDeliveryService.sendInviteEmail).toHaveBeenCalledWith(
        'test@test.com',
        expect.stringContaining('http://localhost:3000/accept-invite?token='),
        30,
      );

      expect(redisService.set).toHaveBeenCalledTimes(2);
      expect(redisService.set).toHaveBeenNthCalledWith(
        1,
        expect.stringMatching(/^auth:setup-link:/),
        'u1',
        1800,
      );
      expect(redisService.set).toHaveBeenNthCalledWith(
        2,
        'auth:setup-link:user:u1',
        expect.any(String),
        1800,
      );
    });

    it('throws BadRequestException if one or more companyIds are invalid', async () => {
      (prisma.tenant!.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 't1',
      });
      (prisma.user!.findFirst as jest.Mock).mockResolvedValueOnce(null);
      (bcrypt.hash as jest.Mock).mockResolvedValueOnce('hashed-pass');

      (prisma.$transaction as jest.Mock).mockImplementationOnce(
        async (callback) => {
          const tx = {
            user: {
              create: jest.fn().mockResolvedValue({
                id: 'u1',
                tenantId: 't1',
                email: 'test@test.com',
                name: 'Test User',
                phone: null,
                status: 'ACTIVE',
                createdAt: new Date(),
                updatedAt: new Date(),
                deletedAt: null,
                userCompanies: [],
              }),
            },
            company: { findMany: jest.fn().mockResolvedValue([{ id: 'c1' }]) },
            userCompany: { createMany: jest.fn() },
          };

          return callback(tx);
        },
      );

      await expect(
        service.create('t1', {
          email: 'test@test.com',
          firstName: 'Test',
          password: 'TempPass123!',
          companyIds: ['c1', 'c2-invalid'],
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('company access management', () => {
    it('scopes company access listing to actor tenant for tenant admins', async () => {
      (prisma.user!.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'u1',
        tenantId: 'tenant-1',
      });
      (prisma.userCompany!.findMany as jest.Mock).mockResolvedValueOnce([
        { company: { id: 'c1' } },
      ]);

      await service.getCompanyAccess('u1', {
        role: 'TENANT_ADMIN',
        tenantId: 'tenant-1',
      });

      expect(prisma.userCompany!.findMany).toHaveBeenCalledWith({
        where: { userId: 'u1', tenantId: 'tenant-1' },
        include: {
          company: {
            select: {
              id: true,
              name: true,
              gstin: true,
              address: true,
              phone: true,
              email: true,
              status: true,
            },
          },
        },
      });
    });

    it('clears cache after granting company access', async () => {
      (prisma.user!.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'u1',
        tenantId: 'tenant-1',
      });
      (prisma.company!.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'c1',
        tenantId: 'tenant-1',
      });
      (prisma.userCompany!.findUnique as jest.Mock).mockResolvedValueOnce(null);
      (prisma.userCompany!.upsert as jest.Mock).mockResolvedValueOnce({
        id: 'uc-1',
      });

      await service.addCompanyAccess('u1', 'c1', {
        role: 'TENANT_ADMIN',
        tenantId: 'tenant-1',
      });

      expect(prisma.userCompany!.upsert).toHaveBeenCalledWith({
        where: { userId_companyId: { userId: 'u1', companyId: 'c1' } },
        update: {},
        create: {
          tenantId: 'tenant-1',
          userId: 'u1',
          companyId: 'c1',
          role: 'VIEWER',
        },
      });
      expect(redisService.del).toHaveBeenCalledWith('company-access:u1:c1');
    });

    it('requires target company in actor scope before removal', async () => {
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
    it('clears auth cache when role is updated', async () => {
      (prisma.user!.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'u1',
        tenantId: 'tenant-1',
        email: 'test@test.com',
        name: 'Test User',
        phone: null,
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        userCompanies: [{ companyId: 'c1', role: 'VIEWER' }],
      });

      (prisma.$transaction as jest.Mock).mockImplementationOnce(
        async (callback) => {
          const tx = {
            user: {
              update: jest.fn().mockResolvedValue({
                id: 'u1',
                tenantId: 'tenant-1',
                email: 'test@test.com',
                name: 'Test User',
                phone: null,
                status: 'ACTIVE',
                createdAt: new Date(),
                updatedAt: new Date(),
                deletedAt: null,
                userCompanies: [{ companyId: 'c1', role: 'VIEWER' }],
              }),
            },
            userCompany: {
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
          };
          return callback(tx);
        },
      );

      (redisService.keys as jest.Mock).mockResolvedValueOnce([
        'auth:user:u1:session:s1',
      ]);

      await service.update('u1', 'tenant-1', { role: 'MANAGER' as any });

      expect(redisService.keys).toHaveBeenCalledWith('auth:user:u1:session:*');
      expect(redisService.del).toHaveBeenCalledWith('auth:user:u1:session:s1');
    });

    it('clears auth cache when user is soft deleted', async () => {
      (prisma.user!.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'u1',
        tenantId: 'tenant-1',
        email: 'test@test.com',
        name: 'Test User',
        phone: null,
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        userCompanies: [{ companyId: 'c1', role: 'VIEWER' }],
      });
      (prisma.$transaction as jest.Mock).mockImplementationOnce(
        async (callback) => {
          const tx = {
            user: {
              update: jest.fn().mockResolvedValue({
                id: 'u1',
                tenantId: 'tenant-1',
                email: 'test@test.com',
                name: 'Test User',
                phone: null,
                status: 'INACTIVE',
                createdAt: new Date(),
                updatedAt: new Date(),
                deletedAt: new Date(),
                userCompanies: [{ companyId: 'c1', role: 'VIEWER' }],
              }),
            },
            refreshToken: {
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
          };
          return callback(tx);
        },
      );

      (redisService.keys as jest.Mock).mockResolvedValueOnce([
        'auth:user:u1:session:s1',
      ]);

      await service.softDelete('u1', 'tenant-1');

      expect(redisService.keys).toHaveBeenCalledWith('auth:user:u1:session:*');
      expect(redisService.del).toHaveBeenCalledWith('auth:user:u1:session:s1');
    });
  });
});
