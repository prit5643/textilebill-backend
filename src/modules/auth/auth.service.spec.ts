import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';
import { OtpDeliveryService } from './otp-delivery.service';

jest.mock('bcrypt');

describe('AuthService', () => {
  let service: AuthService;
  let prisma: jest.Mocked<Partial<PrismaService>>;
  let redis: jest.Mocked<Partial<RedisService>>;
  let jwtService: { sign: jest.Mock };
  let configService: { get: jest.Mock };
  let otpDeliveryService: {
    deliver: jest.Mock;
    sendPasswordResetLinkEmail: jest.Mock;
    sendInviteEmail: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findFirst: jest.fn(),
        update: jest.fn(),
      } as any,
      refreshToken: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      } as any,
      otpChallenge: {
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      } as any,
      $transaction: jest.fn(),
    };

    redis = {
      del: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue(null),
      keys: jest.fn().mockResolvedValue([]),
      getTtlSeconds: jest.fn().mockResolvedValue(0),
    };

    jwtService = {
      sign: jest.fn(),
    };

    otpDeliveryService = {
      deliver: jest.fn().mockResolvedValue(true),
      sendPasswordResetLinkEmail: jest.fn().mockResolvedValue(true),
      sendInviteEmail: jest.fn().mockResolvedValue(true),
    };

    configService = {
      get: jest.fn((key: string, defaultValue?: string) => {
        if (key === 'app.url') {
          return 'http://localhost:3000';
        }
        return defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
        { provide: RedisService, useValue: redis },
        { provide: OtpDeliveryService, useValue: otpDeliveryService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('returns null from validateUser when password does not match', async () => {
    (prisma.user!.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'user-1',
      tenantId: 'tenant-1',
      email: 'owner@test.com',
      name: 'Owner User',
      phone: null,
      status: 'ACTIVE',
      deletedAt: null,
      passwordHash: 'hashed-password',
      userCompanies: [],
    });
    (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);

    await expect(service.validateUser('owner@test.com', 'WrongPass1!')).resolves.toBeNull();
  });

  it('issues cookie-ready session tokens on login', async () => {
    (prisma.user!.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'user-1',
      tenantId: 'tenant-1',
      email: 'owner@test.com',
      name: 'Owner User',
      phone: null,
      status: 'ACTIVE',
      deletedAt: null,
      passwordHash: 'hashed-password',
      userCompanies: [
        {
          role: 'ADMIN',
          company: {
            id: 'company-1',
            name: 'Alpha Textiles',
            gstin: null,
            status: 'ACTIVE',
            deletedAt: null,
          },
        },
      ],
    });
    (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);

    jwtService.sign
      .mockReturnValueOnce('access-token')
      .mockReturnValueOnce('session-token');
    (prisma.refreshToken!.create as jest.Mock).mockResolvedValueOnce({ id: 'rt-1' });

    const result = await service.login({
      username: 'owner@test.com',
      password: 'Password1!',
    });

    expect(result).toEqual(
      expect.objectContaining({
        accessToken: 'access-token',
        sessionToken: 'session-token',
        refreshToken: expect.any(String),
        user: expect.objectContaining({
          id: 'user-1',
          role: 'TENANT_ADMIN',
        }),
      }),
    );

    expect(prisma.refreshToken!.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        tenantId: 'tenant-1',
        tokenHash: expect.any(String),
      }),
    });
  });

  it('throws UnauthorizedException on refresh with an invalid token', async () => {
    (prisma.refreshToken!.findFirst as jest.Mock).mockResolvedValueOnce(null);

    await expect(service.refreshTokens('invalid-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('returns generic forgot-password response for unknown users', async () => {
    (prisma.user!.findFirst as jest.Mock).mockResolvedValueOnce(null);

    await expect(service.forgotPassword('missing@test.com')).resolves.toEqual({
      message: 'If the email exists, password reset OTP has been sent',
    });
  });

  it('stores OTP for forgot-password and sends delivery', async () => {
    (prisma.user!.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'user-1',
      tenantId: 'tenant-1',
      email: 'owner@test.com',
      name: 'Owner User',
      phone: null,
      status: 'ACTIVE',
      deletedAt: null,
      passwordHash: 'hashed-password',
      userCompanies: [],
    });

    const response = await service.forgotPassword('owner@test.com');

    expect(response).toEqual(
      expect.objectContaining({
        message: expect.stringContaining('Password reset OTP sent'),
        channel: 'EMAIL',
      }),
    );
    expect(redis.set).toHaveBeenCalledWith(
      'auth:forgot:otp:owner@test.com',
      expect.stringMatching(/^\d{6}$/),
      600,
    );
    expect(otpDeliveryService.deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'EMAIL',
        target: 'owner@test.com',
        purpose: 'PASSWORD_RESET',
      }),
    );
  });

  it('throws on forgot-password when delivery fails', async () => {
    (prisma.user!.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'user-1',
      tenantId: 'tenant-1',
      email: 'owner@test.com',
      name: 'Owner User',
      phone: null,
      status: 'ACTIVE',
      deletedAt: null,
      passwordHash: 'hashed-password',
      userCompanies: [],
    });
    otpDeliveryService.deliver.mockResolvedValueOnce(false);

    await expect(service.forgotPassword('owner@test.com')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('validates and consumes password reset link tokens', async () => {
    (prisma.user!.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'user-1',
      tenantId: 'tenant-1',
      email: 'owner@test.com',
      name: 'Owner User',
      phone: null,
      status: 'ACTIVE',
      deletedAt: null,
      passwordHash: 'hashed-password',
      userCompanies: [],
    });

    await service.requestPasswordResetLink('owner@test.com');

    const setCalls = (redis.set as jest.Mock).mock.calls;
    const resetLinkCall = setCalls.find(
      (call) => typeof call[0] === 'string' && call[0].startsWith('auth:reset-link:'),
    );
    expect(resetLinkCall).toBeTruthy();

    const tokenKey = resetLinkCall![0] as string;

    (redis.get as jest.Mock).mockImplementation(async (key: string) => {
      if (key === tokenKey) {
        return 'user-1';
      }
      return null;
    });
    (redis.getTtlSeconds as jest.Mock).mockResolvedValueOnce(1200);

    const rawToken = 'simulated-token';
    const validateResult = await service.validatePasswordResetToken(rawToken);
    expect(validateResult.valid).toBe(false);
  });

  it('updates password and revokes sessions on resetPassword', async () => {
    (redis.get as jest.Mock).mockResolvedValueOnce('123456');
    (prisma.user!.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'user-1',
      tenantId: 'tenant-1',
      email: 'owner@test.com',
      name: 'Owner User',
      phone: null,
      status: 'ACTIVE',
      deletedAt: null,
      passwordHash: 'hashed-password',
      userCompanies: [],
    });
    (bcrypt.hash as jest.Mock).mockResolvedValueOnce('new-hash');
    (prisma.$transaction as jest.Mock).mockImplementationOnce(async (callback) => {
      const tx = {
        user: { update: jest.fn().mockResolvedValue({ id: 'user-1' }) },
        refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      };
      return callback(tx);
    });

    await service.resetPassword('owner@test.com', '123456', 'NewPass1!');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(redis.del).toHaveBeenCalledWith('auth:forgot:otp:owner@test.com');
    expect(redis.del).toHaveBeenCalledWith('auth:forgot:cooldown:owner@test.com');
  });

  it('rejects verifyLoginOtp for missing challenge', async () => {
    (redis.get as jest.Mock).mockResolvedValueOnce(null);

    await expect(service.verifyLoginOtp('missing', '123456')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
