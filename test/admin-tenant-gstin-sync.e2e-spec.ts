import { CanActivate, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { ConfigService } from '@nestjs/config';
import { AdminController } from '../src/modules/admin/admin.controller';
import { AdminService } from '../src/modules/admin/admin.service';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { RedisService } from '../src/modules/redis/redis.service';
import { OtpDeliveryService } from '../src/modules/auth/otp-delivery.service';
import {
  JwtAuthGuard,
  RolesGuard,
  SubscriptionGuard,
} from '../src/common/guards';

describe('Admin tenant GST sync (e2e)', () => {
  let app: INestApplication;
  let companyUpdateMany: jest.Mock;
  let jwtGuardSpy: jest.SpyInstance;
  let subscriptionGuardSpy: jest.SpyInstance;
  let rolesGuardSpy: jest.SpyInstance;

  beforeEach(async () => {
    companyUpdateMany = jest.fn().mockResolvedValue({ count: 1 });

    const prisma = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'tenant-1',
          users: [],
          companies: [],
          subscriptions: [],
        }),
        update: jest.fn().mockResolvedValue({
          id: 'tenant-1',
          name: 'PRIT',
          gstin: '27ABCDE1234F2Z5',
        }),
      },
      company: {
        updateMany: companyUpdateMany,
        findMany: jest.fn().mockResolvedValue([{ id: 'company-1' }]),
        update: jest.fn().mockResolvedValue({ id: 'company-1' }),
      },
      $transaction: jest.fn().mockImplementation(async (callback) => {
        const tx = {
          tenant: {
            update: prisma.tenant.update,
          },
          company: {
            updateMany: prisma.company.updateMany,
            findMany: prisma.company.findMany,
            update: prisma.company.update,
          },
        };

        return callback(tx);
      }),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        AdminService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: RedisService,
          useValue: { del: jest.fn(), keys: jest.fn().mockResolvedValue([]) },
        },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        {
          provide: OtpDeliveryService,
          useValue: {
            sendInviteEmail: jest.fn().mockResolvedValue(true),
            sendPasswordResetLinkEmail: jest.fn().mockResolvedValue(true),
          },
        },
      ],
    }).compile();

    jwtGuardSpy = jest
      .spyOn(JwtAuthGuard.prototype, 'canActivate')
      .mockReturnValue(true);
    subscriptionGuardSpy = jest
      .spyOn(SubscriptionGuard.prototype, 'canActivate')
      .mockResolvedValue(true);
    rolesGuardSpy = jest
      .spyOn(RolesGuard.prototype, 'canActivate')
      .mockReturnValue(true);

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    jwtGuardSpy.mockRestore();
    subscriptionGuardSpy.mockRestore();
    rolesGuardSpy.mockRestore();
    await app.close();
  });

  it('syncs tenant GSTIN into company GSTIN when admin updates tenant', async () => {
    await request(app.getHttpServer())
      .put('/admin/tenants/tenant-1')
      .send({ gstin: '27ABCDE1234F2Z5' })
      .expect(200);

    expect(companyUpdateMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        OR: [{ gstin: null }, { gstin: '' }],
      },
      data: {
        gstin: '27ABCDE1234F2Z5',
      },
    });
  });
});
