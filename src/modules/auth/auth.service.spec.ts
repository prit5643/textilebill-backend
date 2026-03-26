import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';
import {
  ForbiddenException,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { getUserAuthCachePattern } from './auth-request-cache.util';
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
        findUnique: jest.fn(),
        update: jest.fn(),
      } as any,
      userCompanyAccess: {
        findMany: jest.fn(),
      } as any,
      refreshToken: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        deleteMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      } as any,
      otpChallenge: {
        create: jest.fn(),
        update: jest.fn(),
      } as any,
      passwordLifecycleToken: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findFirstOrThrow: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
      } as any,
      auditLog: {
        create: jest.fn(),
      } as any,
      $transaction: jest.fn(),
    };

    redis = {
      del: jest.fn(),
      set: jest.fn(),
      get: jest.fn(),
      keys: jest.fn().mockResolvedValue([]),
      isAvailable: jest.fn(() => true),
    };

    jwtService = { sign: jest.fn() };
    otpDeliveryService = {
      deliver: jest.fn().mockResolvedValue(true),
      sendPasswordResetLinkEmail: jest.fn().mockResolvedValue(true),
      sendInviteEmail: jest.fn().mockResolvedValue(true),
    };
    configService = {
      get: jest.fn((key: string, defaultValue?: string) => {
        switch (key) {
          case 'app.url':
            return 'http://localhost:3000';
          case 'app.corsOrigin':
            return 'http://localhost:3000';
          case 'jwt.refreshExpiresIn':
            return '7d';
          default:
            return defaultValue;
        }
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

  describe('login', () => {
    it('normalizes email identifiers before password validation', async () => {
      (prisma.user!.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'user-1',
        email: 'owner@test.com',
        username: 'owner',
        role: 'TENANT_ADMIN',
        tenantId: 'tenant-1',
        firstName: 'Owner',
        lastName: 'User',
        passwordHash: 'hashed-password',
        passwordChangedAt: null,
        emailVerifiedAt: new Date('2026-03-01T00:00:00.000Z'),
        phoneVerifiedAt: null,
        tenant: { isActive: true },
      });
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);

      await service.validateUser(' Owner@Test.com ', 'Password1!');

      expect(prisma.user!.findFirst).toHaveBeenCalledWith({
        where: {
          OR: [
            { username: 'Owner@Test.com' },
            { email: 'owner@test.com' },
            { phone: 'Owner@Test.com' },
          ],
          isActive: true,
        },
        select: expect.any(Object),
      });
    });

    it('returns cookie-ready session tokens and non-sensitive browser session data', async () => {
      (prisma.user!.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'user-1',
        email: 'owner@test.com',
        username: 'owner',
        role: 'TENANT_ADMIN',
        tenantId: 'tenant-1',
        firstName: 'Owner',
        lastName: 'User',
        avatarUrl: null,
        passwordHash: 'hashed-password',
        passwordChangedAt: null,
        emailVerifiedAt: new Date('2026-03-01T00:00:00.000Z'),
        phoneVerifiedAt: null,
        tenant: { isActive: true },
      });
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);
      jwtService.sign
        .mockReturnValueOnce('access-token')
        .mockReturnValueOnce('session-token');
      (prisma.refreshToken!.create as jest.Mock).mockResolvedValueOnce({
        id: 'refresh-row-1',
      });
      (prisma.user!.update as jest.Mock).mockResolvedValueOnce({
        id: 'user-1',
      });
      (prisma.user!.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'user-1',
        email: 'owner@test.com',
        username: 'owner',
        role: 'TENANT_ADMIN',
        firstName: 'Owner',
        lastName: 'User',
        tenantId: 'tenant-1',
        avatarUrl: null,
        passwordChangedAt: null,
        emailVerifiedAt: new Date('2026-03-01T00:00:00.000Z'),
        phoneVerifiedAt: null,
      });
      (prisma.userCompanyAccess!.findMany as jest.Mock).mockResolvedValueOnce([
        {
          company: {
            id: 'company-1',
            name: 'Alpha Textiles',
            gstin: '24ABCDE1234F1Z5',
            city: 'Surat',
            state: 'GJ',
            isActive: true,
          },
        },
      ]);

      const result = await service.login({
        username: 'owner@test.com',
        password: 'Password1!',
      });

      expect(result).toEqual({
        accessToken: 'access-token',
        sessionToken: 'session-token',
        refreshToken: expect.any(String),
        user: {
          id: 'user-1',
          email: 'owner@test.com',
          username: 'owner',
          role: 'TENANT_ADMIN',
          firstName: 'Owner',
          lastName: 'User',
          tenantId: 'tenant-1',
          avatarUrl: null,
          mustChangePassword: true,
          emailVerified: true,
          phoneVerified: false,
          hasVerifiedContact: true,
        },
        companies: [
          {
            id: 'company-1',
            name: 'Alpha Textiles',
            gstin: '24ABCDE1234F1Z5',
            city: 'Surat',
            state: 'GJ',
            isActive: true,
          },
        ],
      });
      expect(prisma.refreshToken!.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          token: result.refreshToken,
          tokenHash: expect.any(String),
        }),
      });
      expect(redis.set).toHaveBeenCalledWith(
        `refresh:${result.refreshToken}`,
        'user-1',
        7 * 24 * 60 * 60,
      );
    });

    it('blocks password login for unverified accounts that do not qualify for legacy backfill', async () => {
      (prisma.user!.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'user-1',
        email: 'owner@test.com',
        username: 'owner',
        role: 'TENANT_ADMIN',
        tenantId: 'tenant-1',
        firstName: 'Owner',
        lastName: 'User',
        avatarUrl: null,
        passwordHash: 'hashed-password',
        passwordChangedAt: null,
        emailVerifiedAt: null,
        phoneVerifiedAt: null,
        tenant: { isActive: true },
      });
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);

      await expect(
        service.login({
          username: 'owner@test.com',
          password: 'Password1!',
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.refreshToken!.create).not.toHaveBeenCalled();
    });
  });

  describe('getCurrentSession', () => {
    it('returns the browser session payload for the authenticated user', async () => {
      (prisma.user!.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'user-1',
        email: 'owner@test.com',
        username: 'owner',
        role: 'TENANT_ADMIN',
        firstName: 'Owner',
        lastName: 'User',
        tenantId: 'tenant-1',
        avatarUrl: 'https://cdn.example.com/avatar.png',
        passwordChangedAt: new Date('2026-03-01T00:00:00.000Z'),
        emailVerifiedAt: null,
        phoneVerifiedAt: null,
      });
      (prisma.userCompanyAccess!.findMany as jest.Mock).mockResolvedValueOnce([
        {
          company: {
            id: 'company-1',
            name: 'Alpha Textiles',
            gstin: null,
            city: 'Surat',
            state: 'GJ',
            isActive: true,
          },
        },
        {
          company: {
            id: 'company-2',
            name: 'Inactive Textiles',
            gstin: null,
            city: 'Ahmedabad',
            state: 'GJ',
            isActive: false,
          },
        },
      ]);

      await expect(service.getCurrentSession('user-1')).resolves.toEqual({
        user: {
          id: 'user-1',
          email: 'owner@test.com',
          username: 'owner',
          role: 'TENANT_ADMIN',
          firstName: 'Owner',
          lastName: 'User',
          tenantId: 'tenant-1',
          avatarUrl: 'https://cdn.example.com/avatar.png',
          mustChangePassword: false,
          emailVerified: false,
          phoneVerified: false,
          hasVerifiedContact: false,
        },
        companies: [
          {
            id: 'company-1',
            name: 'Alpha Textiles',
            gstin: null,
            city: 'Surat',
            state: 'GJ',
            isActive: true,
          },
        ],
      });
    });
  });

  describe('OTP authentication and verification', () => {
    it('creates an OTP login challenge for a known identifier', async () => {
      (prisma.user!.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'user-1',
        email: 'owner@test.com',
        username: 'owner',
        phone: '+919876543210',
        emailVerifiedAt: null,
        phoneVerifiedAt: null,
      });
      (prisma.otpChallenge!.create as jest.Mock).mockResolvedValueOnce({
        id: 'otp-request-1',
      });

      const result = await service.requestLoginOtp('owner@test.com', 'EMAIL');

      expect(result).toEqual(
        expect.objectContaining({
          message: 'OTP sent successfully.',
          requestId: expect.any(String),
          channel: 'EMAIL',
          targetHint: 'ow***@test.com',
          expiresInSeconds: 300,
          resendCooldownSeconds: 32,
        }),
      );
      expect(prisma.otpChallenge!.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          purpose: 'LOGIN',
          requestedChannel: 'EMAIL',
          deliveredChannel: 'EMAIL',
          targetIdentifier: 'owner@test.com',
        }),
      });
      expect(redis.set).toHaveBeenCalledWith(
        expect.stringMatching(/^auth:otp:challenge:/),
        expect.any(String),
        300,
      );
      expect(otpDeliveryService.deliver).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'EMAIL',
          target: 'owner@test.com',
          purpose: 'LOGIN',
        }),
      );
    });

    it('returns a masked verification status payload for the current user', async () => {
      (prisma.user!.findUnique as jest.Mock).mockResolvedValueOnce({
        email: 'owner@test.com',
        phone: '+919876543210',
        emailVerifiedAt: new Date('2026-03-01T00:00:00.000Z'),
        phoneVerifiedAt: null,
      });

      await expect(service.getVerificationStatus('user-1')).resolves.toEqual({
        email: { value: 'ow***@test.com', verified: true },
        hasVerifiedContact: true,
      });
    });

    it('creates an email contact-verification challenge for an unverified contact', async () => {
      (prisma.user!.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'user-1',
        email: 'owner@test.com',
        phone: '+919876543210',
        emailVerifiedAt: null,
        phoneVerifiedAt: null,
      });
      (prisma.otpChallenge!.create as jest.Mock).mockResolvedValueOnce({
        id: 'verify-request-1',
      });

      const result = await service.requestContactVerification('user-1', 'EMAIL');

      expect(result).toEqual(
        expect.objectContaining({
          message: 'Verification OTP sent successfully.',
          channel: 'EMAIL',
          targetHint: 'ow***@test.com',
        }),
      );
      expect(prisma.otpChallenge!.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          purpose: 'VERIFY_EMAIL',
          requestedChannel: 'EMAIL',
          deliveredChannel: 'EMAIL',
          targetIdentifier: 'owner@test.com',
        }),
      });
      expect(otpDeliveryService.deliver).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'EMAIL',
          target: 'owner@test.com',
          purpose: 'VERIFY_EMAIL',
        }),
      );
    });

    it('marks the requested contact as verified and clears OTP state', async () => {
      (redis.get as jest.Mock).mockResolvedValueOnce(
        JSON.stringify({
          requestId: 'verify-request-1',
          userId: 'user-1',
          otp: '123456',
          purpose: 'VERIFY_EMAIL',
          channel: 'EMAIL',
          target: 'owner@test.com',
          resendCount: 0,
        }),
      );

      await expect(
        service.verifyContactOtp('user-1', 'verify-request-1', '123456'),
      ).resolves.toEqual({ message: 'Contact verified successfully' });

      expect(prisma.user!.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { emailVerifiedAt: expect.any(Date) },
      });
      expect(prisma.otpChallenge!.update).toHaveBeenCalledWith({
        where: { id: 'verify-request-1' },
        data: { verifiedAt: expect.any(Date) },
      });
      expect(redis.del).toHaveBeenCalledWith(
        'auth:otp:challenge:verify-request-1',
      );
      expect(redis.del).toHaveBeenCalledWith(
        'auth:otp:cooldown:verify-request-1',
      );
    });
  });

  describe('changePassword', () => {
    it('should throw UnauthorizedException if the user is not found', async () => {
      (prisma.user!.findUnique as jest.Mock).mockResolvedValueOnce(null);

      await expect(
        service.changePassword('u1', 'oldPass', 'newPass'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if old password does not match', async () => {
      (prisma.user!.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'u1',
        passwordHash: 'hash',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);

      await expect(
        service.changePassword('u1', 'wrongOld', 'newPass'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should execute an atomic transaction and clear redis cache on success', async () => {
      (prisma.user!.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'u1',
        passwordHash: 'oldHash',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);
      (bcrypt.hash as jest.Mock).mockResolvedValueOnce('newHash');

      // Mock finding active refresh tokens
      (prisma.refreshToken!.findMany as jest.Mock).mockResolvedValueOnce([
        { token: 'token1' },
      ]);

      (prisma.$transaction as jest.Mock).mockResolvedValueOnce(undefined);
      (redis.del as jest.Mock).mockResolvedValue(undefined);

      await service.changePassword('u1', 'oldPass', 'newPass');

      // Verify the transaction was called
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);

      // Verify redis cache was cleared for the existing tokens and auth context
      expect(redis.del).toHaveBeenCalledWith('refresh:token1');
      expect(redis.keys).toHaveBeenCalledWith(getUserAuthCachePattern('u1'));
    });
  });

  describe('logout', () => {
    it('revokes the refresh token and clears redis when the token exists', async () => {
      (prisma.refreshToken!.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'token-id',
        token: 'refresh-token-1',
      });

      await service.logout('refresh-token-1');

      expect(prisma.refreshToken!.update).toHaveBeenCalledWith({
        where: { id: 'token-id' },
        data: { revokedAt: expect.any(Date) },
      });
      expect(redis.del).toHaveBeenCalledWith('refresh:refresh-token-1');
    });

    it('does nothing when the refresh token is not found', async () => {
      (prisma.refreshToken!.findFirst as jest.Mock).mockResolvedValueOnce(
        null,
      );

      await service.logout('missing-token');

      expect(prisma.refreshToken!.update).not.toHaveBeenCalled();
      expect(redis.del).not.toHaveBeenCalled();
    });
  });

  describe('refreshTokens', () => {
    it('rotates refresh tokens and issues a new cookie-ready token set', async () => {
      (prisma.refreshToken!.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'refresh-row-1',
        token: 'refresh-token-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        user: {
          id: 'user-1',
          email: 'owner@test.com',
          role: 'TENANT_ADMIN',
          tenantId: 'tenant-1',
        },
      });
      jwtService.sign
        .mockReturnValueOnce('access-token-2')
        .mockReturnValueOnce('session-token-2');
      (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb) => {
        const tx = {
          refreshToken: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            create: jest.fn().mockResolvedValue({ id: 'refresh-row-2' }),
          },
        };
        return cb(tx as any);
      });

      const result = await service.refreshTokens('refresh-token-1');

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(redis.del).toHaveBeenCalledWith('refresh:refresh-token-1');
      expect(redis.set).toHaveBeenCalledWith(
        `refresh:${result.refreshToken}`,
        'user-1',
        expect.any(Number),
      );
      expect(result).toEqual({
        accessToken: 'access-token-2',
        sessionToken: 'session-token-2',
        refreshToken: expect.any(String),
      });
    });

    it('returns Unauthorized deterministically when token was already rotated in a parallel request', async () => {
      (prisma.refreshToken!.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'refresh-row-1',
        token: 'refresh-token-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        user: {
          id: 'user-1',
          email: 'owner@test.com',
          role: 'TENANT_ADMIN',
          tenantId: 'tenant-1',
        },
      });
      jwtService.sign
        .mockReturnValueOnce('access-token-2')
        .mockReturnValueOnce('session-token-2');
      (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb) => {
        const tx = {
          refreshToken: {
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            create: jest.fn(),
          },
        };
        return cb(tx as any);
      });

      await expect(service.refreshTokens('refresh-token-1')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(redis.del).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('rejects missing or expired refresh tokens', async () => {
      (prisma.refreshToken!.findFirst as jest.Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'refresh-row-1',
          token: 'refresh-token-1',
          revokedAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
          user: {
            id: 'user-1',
            email: 'owner@test.com',
            role: 'TENANT_ADMIN',
            tenantId: 'tenant-1',
          },
        })
        .mockResolvedValueOnce({
          id: 'refresh-row-2',
          token: 'refresh-token-2',
          revokedAt: null,
          expiresAt: new Date(Date.now() - 60_000),
          user: {
            id: 'user-1',
            email: 'owner@test.com',
            role: 'TENANT_ADMIN',
            tenantId: 'tenant-1',
          },
        });

      await expect(service.refreshTokens('missing-token')).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.refreshTokens('revoked-token')).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.refreshTokens('expired-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('allows only one winner across truly parallel refresh attempts on the same token', async () => {
      (prisma.refreshToken!.findFirst as jest.Mock).mockResolvedValue({
        id: 'refresh-row-1',
        token: 'refresh-token-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        user: {
          id: 'user-1',
          email: 'owner@test.com',
          role: 'TENANT_ADMIN',
          tenantId: 'tenant-1',
        },
      });

      jwtService.sign.mockReturnValue('token-value');

      let rotateCount = 0;
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb) => {
        const tx = {
          refreshToken: {
            updateMany: jest.fn().mockImplementation(async () => {
              rotateCount += 1;
              return { count: rotateCount === 1 ? 1 : 0 };
            }),
            create: jest.fn().mockResolvedValue({ id: 'refresh-row-next' }),
          },
        };
        return cb(tx as any);
      });

      const [first, second] = await Promise.allSettled([
        service.refreshTokens('refresh-token-1'),
        service.refreshTokens('refresh-token-1'),
      ]);

      const fulfilledCount = [first, second].filter(
        (entry) => entry.status === 'fulfilled',
      ).length;
      const rejectedCount = [first, second].filter(
        (entry) => entry.status === 'rejected',
      ).length;

      expect(fulfilledCount).toBe(1);
      expect(rejectedCount).toBe(1);
      expect(redis.del).toHaveBeenCalledTimes(1);
      expect(redis.set).toHaveBeenCalledTimes(1);
    });
  });

  describe('forgotPassword', () => {
    it('stores an OTP when the email exists and delivery succeeds', async () => {
      const loggerSpy = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => {});
      (prisma.user!.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'user-1',
        email: 'owner@test.com',
        phone: null,
        isActive: true,
      });

      const response = await service.forgotPassword('owner@test.com');

      expect(response).toEqual(
        expect.objectContaining({
          message: 'If the email exists, an OTP has been sent',
          resendCooldownSeconds: 32,
        }),
      );
      expect(response.resendAvailableInSeconds).toBeGreaterThanOrEqual(1);
      expect(response.resendAvailableInSeconds).toBeLessThanOrEqual(32);
      expect(redis.set).toHaveBeenNthCalledWith(
        1,
        'auth:forgot:otp:owner@test.com',
        expect.stringMatching(/^\d{6}$/),
        600,
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        'Password reset OTP sent for owner@test.com via EMAIL',
      );
      loggerSpy.mockRestore();
    });

    it('clears OTP state and surfaces a retry message when delivery fails', async () => {
      otpDeliveryService.deliver.mockResolvedValueOnce(false);
      (prisma.user!.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'user-1',
        email: 'owner@test.com',
        phone: null,
        isActive: true,
      });

      await expect(service.forgotPassword('owner@test.com')).rejects.toThrow(
        'We could not send the password reset OTP right now. Please try again shortly.',
      );

      expect(redis.set).toHaveBeenCalledWith(
        'auth:forgot:otp:owner@test.com',
        expect.stringMatching(/^\d{6}$/),
        600,
      );
      expect(redis.set).toHaveBeenCalledWith(
        'auth:forgot:cooldown:owner@test.com',
        '1',
        32,
      );
      expect(redis.del).toHaveBeenCalledWith('auth:forgot:otp:owner@test.com');
      expect(redis.del).toHaveBeenCalledWith(
        'auth:forgot:cooldown:owner@test.com',
      );
    });

    it('does not reveal whether the email exists', async () => {
      (prisma.user!.findFirst as jest.Mock).mockResolvedValueOnce(null);
      (redis.set as jest.Mock).mockResolvedValueOnce(undefined);

      await expect(service.forgotPassword('missing@test.com')).resolves.toEqual(
        {
          message: 'If the email exists, an OTP has been sent',
          resendCooldownSeconds: 32,
          resendAvailableInSeconds: 32,
        },
      );
      expect(redis.set).toHaveBeenCalled();
    });
  });

  describe('requestPasswordResetLink', () => {
    function mockPasswordResetLinkTokenLifecycle() {
      (prisma.$transaction as jest.Mock).mockImplementation(async (callback) =>
        callback({
          passwordLifecycleToken: {
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            create: jest.fn().mockResolvedValue({ id: 'token-row-1' }),
          },
        } as any),
      );
    }

    it('returns resend metadata when email delivery succeeds', async () => {
      (prisma.user!.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'user-1',
        tenantId: 'tenant-1',
        firstName: 'Owner',
        email: 'owner@test.com',
        phone: null,
        isActive: true,
      });
      (redis.get as jest.Mock).mockResolvedValueOnce(null);
      (prisma.passwordLifecycleToken!.findFirst as jest.Mock).mockResolvedValueOnce(null);
      mockPasswordResetLinkTokenLifecycle();
      otpDeliveryService.sendPasswordResetLinkEmail.mockResolvedValueOnce(true);

      const response = await service.requestPasswordResetLink('owner@test.com');

      expect(response).toEqual(
        expect.objectContaining({
          message: 'If the email exists, a password reset link has been sent',
          status: 'RESEND_AVAILABLE',
          resendCount: 0,
          remainingResends: 3,
          resendCooldownSeconds: 32,
        }),
      );
      expect(otpDeliveryService.sendPasswordResetLinkEmail).toHaveBeenCalledWith(
        'owner@test.com',
        expect.stringMatching(
          /^http:\/\/localhost:3000\/reset-password\?token=/,
        ),
        30,
      );
      expect(redis.set).toHaveBeenCalledWith(
        'auth:reset-link:resend-cooldown:user-1',
        '1',
        32,
      );
    });

    it('throws service unavailable when reset-link delivery fails', async () => {
      (prisma.user!.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'user-1',
        tenantId: 'tenant-1',
        firstName: 'Owner',
        email: 'owner@test.com',
        phone: null,
        isActive: true,
      });
      (redis.get as jest.Mock).mockResolvedValueOnce(null);
      (prisma.passwordLifecycleToken!.findFirst as jest.Mock).mockResolvedValueOnce(null);
      mockPasswordResetLinkTokenLifecycle();
      otpDeliveryService.sendPasswordResetLinkEmail.mockResolvedValueOnce(false);

      let capturedError: unknown;
      try {
        await service.requestPasswordResetLink('owner@test.com');
      } catch (error) {
        capturedError = error;
      }

      expect(capturedError).toBeInstanceOf(ServiceUnavailableException);
      expect((capturedError as Error).message).toBe(
        'We could not send the password reset email right now. Please try again shortly.',
      );

      expect(redis.set).toHaveBeenCalledWith(
        'auth:reset-link:resend-cooldown:user-1',
        '1',
        32,
      );
    });
  });

  describe('resetPassword', () => {
    it('rejects invalid or expired OTPs', async () => {
      (redis.get as jest.Mock).mockResolvedValueOnce(null);

      await expect(
        service.resetPassword('owner@test.com', '123456', 'NewPassword1!'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects unknown users after OTP validation', async () => {
      (redis.get as jest.Mock).mockResolvedValueOnce('123456');
      (prisma.user!.findFirst as jest.Mock).mockResolvedValueOnce(null);

      await expect(
        service.resetPassword('owner@test.com', '123456', 'NewPassword1!'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('updates the password, revokes active sessions, and clears OTP state', async () => {
      (redis.get as jest.Mock).mockResolvedValueOnce('123456');
      (prisma.user!.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'user-1',
        email: 'owner@test.com',
        phone: null,
        tenantId: 'tenant-1',
        firstName: 'Owner',
        isActive: true,
      });
      (bcrypt.hash as jest.Mock).mockResolvedValueOnce('hashed-password');
      (prisma.refreshToken!.findMany as jest.Mock).mockResolvedValueOnce([
        { token: 'refresh-token-1' },
        { token: 'refresh-token-2' },
      ]);
      (prisma.$transaction as jest.Mock).mockResolvedValueOnce(undefined);

      await service.resetPassword('owner@test.com', '123456', 'NewPassword1!');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(redis.del).toHaveBeenCalledWith('auth:forgot:otp:owner@test.com');
      expect(redis.del).toHaveBeenCalledWith('auth:forgot:cooldown:owner@test.com');
      expect(redis.del).toHaveBeenCalledWith('refresh:refresh-token-1');
      expect(redis.del).toHaveBeenCalledWith('refresh:refresh-token-2');
      expect(redis.keys).toHaveBeenCalledWith(getUserAuthCachePattern('user-1'));
      expect(redis.del).toHaveBeenCalledWith('auth:setup:resend-cooldown:user-1');
    });
  });

  describe('session management', () => {
    it('lists active sessions for the authenticated user', async () => {
      (prisma.refreshToken!.findMany as jest.Mock).mockResolvedValueOnce([
        {
          id: 'session-1',
          createdAt: new Date('2026-03-01T00:00:00.000Z'),
          expiresAt: new Date('2026-03-08T00:00:00.000Z'),
          lastUsedAt: new Date('2026-03-02T00:00:00.000Z'),
          deviceId: 'device-1',
          userAgent: 'Mozilla/5.0',
          ipAddress: '10.0.0.1',
        },
      ]);

      await expect(service.getUserSessions('user-1')).resolves.toEqual([
        {
          id: 'session-1',
          createdAt: new Date('2026-03-01T00:00:00.000Z'),
          expiresAt: new Date('2026-03-08T00:00:00.000Z'),
          lastUsedAt: new Date('2026-03-02T00:00:00.000Z'),
          deviceId: 'device-1',
          userAgent: 'Mozilla/5.0',
          ipAddress: '10.0.0.1',
        },
      ]);
      expect(prisma.refreshToken!.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          revokedAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
        select: {
          id: true,
          createdAt: true,
          expiresAt: true,
          lastUsedAt: true,
          deviceId: true,
          userAgent: true,
          ipAddress: true,
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('revokes a single active session', async () => {
      (prisma.refreshToken!.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'session-1',
        token: 'refresh-token-1',
      });

      await service.revokeSession('user-1', 'session-1');

      expect(prisma.refreshToken!.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: { revokedAt: expect.any(Date) },
      });
      expect(redis.del).toHaveBeenCalledWith('refresh:refresh-token-1');
    });

    it('rejects revocation for missing sessions', async () => {
      (prisma.refreshToken!.findFirst as jest.Mock).mockResolvedValueOnce(null);

      await expect(
        service.revokeSession('user-1', 'session-404'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
