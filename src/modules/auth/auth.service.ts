import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { OtpPurpose as PrismaOtpPurpose, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { OtpDeliveryService } from './otp-delivery.service';
import { LoginDto } from './dto';
import { getUserAuthCachePattern } from './auth-request-cache.util';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  tenantId: string;
  sessionId: string;
}

export interface SessionClientMetadata {
  deviceId?: string | null;
  userAgent?: string | null;
  ipAddress?: string | null;
}

type OtpRouteChannel = 'EMAIL';
type OtpPurpose = 'LOGIN' | 'VERIFY_EMAIL' | 'RESET_PASSWORD';

type CachedOtpChallenge = {
  requestId: string;
  userId: string;
  tenantId: string;
  target: string;
  purpose: OtpPurpose;
  channel: OtpRouteChannel;
  otp: string;
  attempts: number;
  resendCount: number;
  expiresAt: number;
  dbChallengeId?: string;
};

type PasswordSetupResendInput = {
  email?: string;
  token?: string;
};

type PasswordSetupTokenValidation = {
  valid: boolean;
  status: 'PENDING_SETUP' | 'LINK_EXPIRED';
  email?: string;
  firstName?: string | null;
  expiresInSeconds?: number;
};

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const SESSION_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const OTP_TTL_SECONDS = 10 * 60;
const OTP_LOGIN_TTL_SECONDS = 5 * 60;
const OTP_RESEND_COOLDOWN_SECONDS = 60;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_RESENDS = 3;
const PASSWORD_LINK_TTL_SECONDS = 30 * 60;

const PASSWORD_RESET_LINK_DELIVERY_FAILURE_MESSAGE =
  'We could not send the password reset email right now. Please try again shortly.';
const PASSWORD_RESET_OTP_DELIVERY_FAILURE_MESSAGE =
  'We could not send the password reset OTP right now. Please try again shortly.';
const SETUP_LINK_INVALID_MESSAGE =
  'This setup link is invalid or no longer available. Request a new setup link and try again.';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly otpDeliveryService: OtpDeliveryService,
  ) {}

  async validateUser(identifier: string, password: string): Promise<any> {
    const user = await this.findUserForAuthIdentifier(identifier);
    if (!user) {
      return null;
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      return null;
    }

    return this.buildSessionUser(user);
  }

  async login(dto: LoginDto, metadata?: SessionClientMetadata) {
    const user = await this.validateUser(dto.username, dto.password);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.issueSession(user, metadata);
  }

  async refreshTokens(refreshToken: string, metadata?: SessionClientMetadata) {
    const hashedToken = this.hashOpaqueToken(refreshToken);
    const storedToken = await this.prisma.refreshToken.findFirst({
      where: {
        tokenHash: hashedToken,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: {
        user: {
          include: {
            userCompanies: {
              include: {
                company: {
                  select: {
                    id: true,
                    name: true,
                    gstin: true,
                    status: true,
                    deletedAt: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!storedToken || !storedToken.user) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (storedToken.user.status !== 'ACTIVE' || storedToken.user.deletedAt) {
      throw new ForbiddenException('Your account has been deactivated.');
    }

    await this.prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revokedAt: new Date() },
    });

    const user = this.buildSessionUser(storedToken.user);
    const next = await this.issueSession(user, metadata);

    return {
      accessToken: next.accessToken,
      sessionToken: next.sessionToken,
      refreshToken: next.refreshToken,
    };
  }

  async logout(refreshToken: string): Promise<void> {
    const hashedToken = this.hashOpaqueToken(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashedToken, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async getCurrentSession(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: {
        userCompanies: {
          include: {
            company: {
              select: {
                id: true,
                name: true,
                gstin: true,
                status: true,
                deletedAt: true,
              },
            },
          },
        },
      },
    });

    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('User not found');
    }

    return {
      user: this.buildSessionUser(user),
    };
  }

  async getUserSessions(userId: string) {
    return this.prisma.refreshToken.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        createdAt: true,
        expiresAt: true,
        deviceId: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeSession(userId: string, tokenId: string) {
    const token = await this.prisma.refreshToken.findFirst({
      where: {
        id: tokenId,
        userId,
        revokedAt: null,
      },
      select: { id: true },
    });

    if (!token) {
      throw new BadRequestException('Session not found');
    }

    await this.prisma.refreshToken.update({
      where: { id: tokenId },
      data: { revokedAt: new Date() },
    });
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        passwordHash: true,
        status: true,
      },
    });

    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('User not found');
    }

    const passwordMatches = await bcrypt.compare(
      currentPassword,
      user.passwordHash,
    );
    if (!passwordMatches) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash: hashedPassword },
      });

      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    await this.clearUserAuthCache(userId);
  }

  async requestLoginOtp(identifier: string, preferredChannel: OtpRouteChannel) {
    const user = await this.findUserForAuthIdentifier(identifier);

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const channel = preferredChannel || 'EMAIL';
    const otp = this.generateOtpCode();
    const requestId = randomUUID();
    const expiresAt = Date.now() + OTP_LOGIN_TTL_SECONDS * 1000;

    const dbChallenge = await this.prisma.otpChallenge.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        purpose: PrismaOtpPurpose.LOGIN,
        otpHash: this.hashOpaqueToken(otp),
        expiresAt: new Date(expiresAt),
      },
      select: { id: true },
    });

    const challenge: CachedOtpChallenge = {
      requestId,
      userId: user.id,
      tenantId: user.tenantId,
      target: user.email,
      purpose: 'LOGIN',
      channel,
      otp: this.hashOpaqueToken(otp),
      attempts: 0,
      resendCount: 0,
      expiresAt,
      dbChallengeId: dbChallenge.id,
    };

    await this.storeOtpChallenge(challenge, OTP_LOGIN_TTL_SECONDS);

    const delivered = await this.otpDeliveryService.deliver({
      channel,
      target: challenge.target,
      maskedTarget: this.maskContact(challenge.target),
      otp,
      purpose: 'LOGIN',
    });

    if (!delivered) {
      await this.redisService.del(this.getOtpChallengeKey(requestId));
      throw new ServiceUnavailableException(
        'We could not send OTP right now. Please try again shortly.',
      );
    }

    return {
      message: 'OTP sent successfully',
      requestId,
      channel,
      targetHint: this.maskContact(challenge.target),
      expiresInSeconds: OTP_LOGIN_TTL_SECONDS,
      resendCooldownSeconds: OTP_RESEND_COOLDOWN_SECONDS,
    };
  }

  async verifyLoginOtp(
    requestId: string,
    otp: string,
    metadata?: SessionClientMetadata,
  ) {
    const challenge = await this.getOtpChallenge(requestId);

    if (!challenge || challenge.purpose !== 'LOGIN') {
      throw new BadRequestException('Invalid or expired OTP request');
    }

    if (challenge.expiresAt < Date.now()) {
      await this.invalidateOtpChallenge(challenge);
      throw new BadRequestException('OTP request has expired');
    }

    if (challenge.otp !== this.hashOpaqueToken(otp.trim())) {
      challenge.attempts += 1;

      if (challenge.dbChallengeId) {
        await this.prisma.otpChallenge.update({
          where: { id: challenge.dbChallengeId },
          data: { attempts: challenge.attempts },
        });
      }

      if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
        await this.invalidateOtpChallenge(challenge);
        throw new BadRequestException('OTP verification failed too many times');
      }

      await this.storeOtpChallenge(
        challenge,
        this.getRemainingTtlSeconds(challenge),
      );
      throw new BadRequestException('Invalid OTP');
    }

    if (challenge.dbChallengeId) {
      await this.prisma.otpChallenge.update({
        where: { id: challenge.dbChallengeId },
        data: { usedAt: new Date() },
      });
    }

    await this.redisService.del(this.getOtpChallengeKey(requestId));
    await this.redisService.del(this.getOtpCooldownKey(requestId));

    const user = await this.findUserById(challenge.userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return this.issueSession(this.buildSessionUser(user), metadata);
  }

  async resendOtp(requestId: string) {
    const challenge = await this.getOtpChallenge(requestId);

    if (!challenge) {
      throw new BadRequestException('Invalid or expired OTP request');
    }

    if (challenge.expiresAt < Date.now()) {
      await this.invalidateOtpChallenge(challenge);
      throw new BadRequestException('OTP request has expired');
    }

    if (challenge.resendCount >= OTP_MAX_RESENDS) {
      throw new BadRequestException('OTP resend limit reached');
    }

    const cooldownKey = this.getOtpCooldownKey(requestId);
    const cooldownSeconds = await this.redisService.getTtlSeconds(cooldownKey);
    if (cooldownSeconds > 0) {
      throw new BadRequestException(
        `Please wait ${cooldownSeconds}s before requesting another OTP`,
      );
    }

    const newOtp = this.generateOtpCode();
    challenge.otp = this.hashOpaqueToken(newOtp);
    challenge.resendCount += 1;

    const ttlSeconds = this.getRemainingTtlSeconds(challenge);
    await this.storeOtpChallenge(challenge, ttlSeconds);
    await this.redisService.set(cooldownKey, '1', OTP_RESEND_COOLDOWN_SECONDS);

    if (challenge.dbChallengeId) {
      await this.prisma.otpChallenge.update({
        where: { id: challenge.dbChallengeId },
        data: {
          otpHash: challenge.otp,
          expiresAt: new Date(Date.now() + ttlSeconds * 1000),
        },
      });
    }

    const delivered = await this.otpDeliveryService.deliver({
      channel: challenge.channel,
      target: challenge.target,
      maskedTarget: this.maskContact(challenge.target),
      otp: newOtp,
      purpose: challenge.purpose === 'VERIFY_EMAIL' ? 'VERIFY_EMAIL' : 'LOGIN',
    });

    if (!delivered) {
      throw new ServiceUnavailableException(
        'We could not resend OTP right now. Please try again shortly.',
      );
    }

    return {
      message: 'OTP resent successfully',
      requestId,
      resendCount: challenge.resendCount,
      channel: challenge.channel,
      targetHint: this.maskContact(challenge.target),
      expiresInSeconds: ttlSeconds,
      resendCooldownSeconds: OTP_RESEND_COOLDOWN_SECONDS,
    };
  }

  async forgotPassword(
    identifier: string,
    preferredChannel: OtpRouteChannel = 'EMAIL',
  ) {
    const normalized = identifier.trim().toLowerCase();
    const user = await this.findUserForAuthIdentifier(normalized);

    if (!user) {
      return {
        message: 'If the email exists, password reset OTP has been sent',
      };
    }

    const cooldownKey = this.getForgotPasswordCooldownKey(normalized);
    const cooldownSeconds = await this.redisService.getTtlSeconds(cooldownKey);
    if (cooldownSeconds > 0) {
      throw new BadRequestException(
        `Please wait ${cooldownSeconds}s before requesting another OTP`,
      );
    }

    const otp = this.generateOtpCode();
    await this.redisService.set(
      this.getForgotPasswordOtpKey(normalized),
      this.hashOpaqueToken(otp),
      OTP_TTL_SECONDS,
    );
    await this.redisService.set(cooldownKey, '1', OTP_RESEND_COOLDOWN_SECONDS);

    const delivered = await this.otpDeliveryService.deliver({
      channel: preferredChannel,
      target: user.email,
      maskedTarget: this.maskContact(user.email),
      otp,
      purpose: 'PASSWORD_RESET',
    });

    if (!delivered) {
      await this.redisService.del(this.getForgotPasswordOtpKey(normalized));
      await this.redisService.del(cooldownKey);
      throw new ServiceUnavailableException(
        PASSWORD_RESET_OTP_DELIVERY_FAILURE_MESSAGE,
      );
    }

    return {
      message: `Password reset OTP sent for ${normalized} via ${preferredChannel}`,
      channel: preferredChannel,
      targetHint: this.maskContact(user.email),
      expiresInSeconds: OTP_TTL_SECONDS,
    };
  }

  async resetPassword(
    identifier: string,
    otp: string,
    newPassword: string,
  ): Promise<void> {
    const normalized = identifier.trim().toLowerCase();
    const storedOtpHash = await this.redisService.get(
      this.getForgotPasswordOtpKey(normalized),
    );

    if (!storedOtpHash || storedOtpHash !== this.hashOpaqueToken(otp.trim())) {
      throw new BadRequestException('Invalid OTP');
    }

    const user = await this.findUserForAuthIdentifier(normalized);
    if (!user) {
      throw new BadRequestException('User not found');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash: hashedPassword },
      });

      await tx.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    await this.redisService.del(this.getForgotPasswordOtpKey(normalized));
    await this.redisService.del(this.getForgotPasswordCooldownKey(normalized));
    await this.clearUserAuthCache(user.id);
  }

  async requestPasswordResetLink(identifier: string) {
    const user = await this.findUserForAuthIdentifier(identifier);

    if (!user) {
      return {
        message: 'If the email exists, a password reset link has been sent',
      };
    }

    const token = randomUUID();
    await this.redisService.set(
      this.getPasswordResetLinkKey(token),
      user.id,
      PASSWORD_LINK_TTL_SECONDS,
    );

    const resetLink = this.buildPublicLink('/reset-password', token);
    const delivered = await this.otpDeliveryService.sendPasswordResetLinkEmail(
      user.email,
      resetLink,
      PASSWORD_LINK_TTL_SECONDS / 60,
    );

    if (!delivered) {
      await this.redisService.del(this.getPasswordResetLinkKey(token));
      throw new ServiceUnavailableException(
        PASSWORD_RESET_LINK_DELIVERY_FAILURE_MESSAGE,
      );
    }

    return {
      message: 'If the email exists, a password reset link has been sent',
    };
  }

  async validatePasswordResetToken(token: string) {
    const key = this.getPasswordResetLinkKey(token);
    const userId = await this.redisService.get(key);
    if (!userId) {
      return {
        valid: false,
        status: 'LINK_EXPIRED',
      };
    }

    return {
      valid: true,
      status: 'ACTIVE',
      expiresInSeconds: await this.redisService.getTtlSeconds(key),
    };
  }

  async resetPasswordWithLink(
    token: string,
    newPassword: string,
  ): Promise<void> {
    const key = this.getPasswordResetLinkKey(token);
    const userId = await this.redisService.get(key);

    if (!userId) {
      throw new BadRequestException('Invalid or expired password reset link');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash: hashedPassword },
      });

      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    await this.redisService.del(key);
    await this.clearUserAuthCache(userId);
  }

  async getVerificationStatus(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        email: true,
        phone: true,
        status: true,
      },
    });

    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('User not found');
    }

    const emailVerification = await this.prisma.otpChallenge.findFirst({
      where: {
        userId,
        purpose: PrismaOtpPurpose.VERIFY_EMAIL,
        usedAt: { not: null },
      },
      select: { usedAt: true },
      orderBy: { usedAt: 'desc' },
    });

    const emailVerified = Boolean(emailVerification?.usedAt);
    const whatsappVerified = false;

    return {
      email: {
        value: user.email,
        verified: emailVerified,
      },
      whatsapp: {
        value: user.phone,
        verified: whatsappVerified,
      },
      hasVerifiedContact: emailVerified || whatsappVerified,
    };
  }

  async requestContactVerification(userId: string, channel: OtpRouteChannel) {
    const user = await this.findUserById(userId);
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('User not found');
    }

    const otp = this.generateOtpCode();
    const requestId = randomUUID();
    const expiresAt = Date.now() + OTP_LOGIN_TTL_SECONDS * 1000;

    const dbChallenge = await this.prisma.otpChallenge.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        purpose: PrismaOtpPurpose.VERIFY_EMAIL,
        otpHash: this.hashOpaqueToken(otp),
        expiresAt: new Date(expiresAt),
      },
      select: { id: true },
    });

    const challenge: CachedOtpChallenge = {
      requestId,
      userId: user.id,
      tenantId: user.tenantId,
      target: user.email,
      purpose: 'VERIFY_EMAIL',
      channel,
      otp: this.hashOpaqueToken(otp),
      attempts: 0,
      resendCount: 0,
      expiresAt,
      dbChallengeId: dbChallenge.id,
    };

    await this.storeOtpChallenge(challenge, OTP_LOGIN_TTL_SECONDS);

    const delivered = await this.otpDeliveryService.deliver({
      channel,
      target: challenge.target,
      maskedTarget: this.maskContact(challenge.target),
      otp,
      purpose: 'VERIFY_EMAIL',
    });

    if (!delivered) {
      await this.redisService.del(this.getOtpChallengeKey(requestId));
      throw new ServiceUnavailableException('Could not send verification OTP');
    }

    return {
      message: 'Verification OTP sent',
      requestId,
      channel,
      targetHint: this.maskContact(challenge.target),
      expiresInSeconds: OTP_LOGIN_TTL_SECONDS,
    };
  }

  async verifyContactOtp(userId: string, requestId: string, otp: string) {
    const challenge = await this.getOtpChallenge(requestId);

    if (!challenge || challenge.purpose !== 'VERIFY_EMAIL') {
      throw new BadRequestException('Invalid or expired OTP request');
    }

    if (challenge.userId !== userId) {
      throw new ForbiddenException('OTP request does not belong to this user');
    }

    if (challenge.expiresAt < Date.now()) {
      await this.invalidateOtpChallenge(challenge);
      throw new BadRequestException('OTP request has expired');
    }

    if (challenge.otp !== this.hashOpaqueToken(otp.trim())) {
      throw new BadRequestException('Invalid OTP');
    }

    if (challenge.dbChallengeId) {
      await this.prisma.otpChallenge.update({
        where: { id: challenge.dbChallengeId },
        data: { usedAt: new Date() },
      });
    }

    await this.redisService.del(this.getOtpChallengeKey(requestId));
    await this.redisService.del(this.getOtpCooldownKey(requestId));

    return {
      message: 'Contact verified successfully',
      channel: challenge.channel,
    };
  }

  async validateInviteToken(token: string) {
    return this.validatePasswordSetupToken(token);
  }

  async validatePasswordSetupToken(token: string) {
    const setupKey = this.getSetupLinkKey(token);
    const userId = await this.redisService.get(setupKey);
    if (!userId) {
      return {
        valid: false,
        status: 'LINK_EXPIRED',
      } satisfies PasswordSetupTokenValidation;
    }

    const user = await this.findUserById(userId);
    const [firstName] = (user?.name ?? '').trim().split(/\s+/).filter(Boolean);

    return {
      valid: true,
      status: 'PENDING_SETUP',
      email: user?.email,
      firstName: firstName ?? null,
      expiresInSeconds: await this.redisService.getTtlSeconds(setupKey),
    } satisfies PasswordSetupTokenValidation;
  }

  async acceptInvite(
    token: string,
    newPassword: string,
    metadata?: SessionClientMetadata,
  ) {
    const key = this.getSetupLinkKey(token);
    const userId = await this.redisService.get(key);

    if (!userId) {
      throw new BadRequestException(SETUP_LINK_INVALID_MESSAGE);
    }

    const user = await this.findUserById(userId);
    if (!user || user.status !== 'ACTIVE' || user.deletedAt) {
      throw new BadRequestException(SETUP_LINK_INVALID_MESSAGE);
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash: hashedPassword },
      });

      await tx.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      // Completing the invite link proves ownership of the email address.
      // Create a VERIFY_EMAIL challenge that is already used so that
      // getVerificationStatus() returns emailVerified = true immediately.
      await tx.otpChallenge.create({
        data: {
          tenantId: user.tenantId,
          userId: user.id,
          purpose: PrismaOtpPurpose.VERIFY_EMAIL,
          otpHash: this.hashOpaqueToken(randomUUID()),
          expiresAt: new Date(),
          usedAt: new Date(),
        },
      });
    });

    await this.redisService.del(key);
    await this.redisService.del(this.getUserPasswordSetupStateKey(user.id));
    await this.clearUserAuthCache(user.id);

    return this.issueSession(this.buildSessionUser(user), metadata);
  }

  async resendPasswordSetupLink(input: PasswordSetupResendInput) {
    const email = input.email?.trim().toLowerCase();
    const token = input.token?.trim();

    let userId: string | null = null;

    if (token) {
      userId = await this.redisService.get(this.getSetupLinkKey(token));
    }

    if (!userId && email) {
      const user = await this.findUserForAuthIdentifier(email);
      userId = user?.id ?? null;
    }

    if (!userId) {
      return {
        message:
          'If an eligible account exists, a password setup link has been sent',
      };
    }

    const user = await this.findUserById(userId);
    if (!user || user.status !== 'ACTIVE' || user.deletedAt) {
      return {
        message:
          'If an eligible account exists, a password setup link has been sent',
      };
    }

    const setupToken = randomUUID();
    await this.redisService.set(
      this.getSetupLinkKey(setupToken),
      user.id,
      PASSWORD_LINK_TTL_SECONDS,
    );
    await this.redisService.set(
      this.getUserPasswordSetupStateKey(user.id),
      setupToken,
      PASSWORD_LINK_TTL_SECONDS,
    );

    const inviteLink = this.buildPublicLink('/accept-invite', setupToken);
    const delivered = await this.otpDeliveryService.sendInviteEmail(
      user.email,
      inviteLink,
      PASSWORD_LINK_TTL_SECONDS / 60,
    );

    if (!delivered) {
      await this.redisService.del(this.getSetupLinkKey(setupToken));
      throw new ServiceUnavailableException(
        'We could not send the setup email right now. Please try again shortly.',
      );
    }

    return {
      message:
        'If an eligible account exists, a password setup link has been sent',
      expiresAt: new Date(Date.now() + PASSWORD_LINK_TTL_SECONDS * 1000),
    };
  }

  private async issueSession(user: any, metadata?: SessionClientMetadata) {
    const sessionId = randomUUID();

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      sessionId,
    };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    });

    const sessionToken = this.jwtService.sign(payload, {
      expiresIn: SESSION_TOKEN_TTL_SECONDS,
    });

    const refreshToken = `${randomUUID()}${randomUUID()}`;

    await this.prisma.refreshToken.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        tokenHash: this.hashOpaqueToken(refreshToken),
        deviceId: metadata?.deviceId ?? null,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
      },
    });

    return {
      user,
      accessToken,
      sessionToken,
      refreshToken,
    };
  }

  private async findUserForAuthIdentifier(identifier: string) {
    const normalized = identifier.trim();

    return this.prisma.user.findFirst({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        OR: [
          { email: { equals: normalized, mode: 'insensitive' } },
          { phone: normalized },
        ],
      },
      include: {
        userCompanies: {
          include: {
            company: {
              select: {
                id: true,
                name: true,
                gstin: true,
                status: true,
                deletedAt: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async findUserById(userId: string) {
    return this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: {
        userCompanies: {
          include: {
            company: {
              select: {
                id: true,
                name: true,
                gstin: true,
                status: true,
                deletedAt: true,
              },
            },
          },
        },
      },
    });
  }

  private buildSessionUser(user: any) {
    const activeAssignments = (user.userCompanies ?? []).filter(
      (row: any) =>
        row.company &&
        row.company.status === 'ACTIVE' &&
        !row.company.deletedAt,
    );

    const effectiveRole = this.toLegacyRole(
      this.getHighestRole(activeAssignments),
    );
    const [firstName, ...restNameParts] = (user?.name ?? '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const lastName = restNameParts.length ? restNameParts.join(' ') : null;

    return {
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      name: user.name,
      firstName: firstName || null,
      lastName,
      phone: user.phone,
      status: user.status,
      role: effectiveRole,
      companies: activeAssignments.map((row: any) => ({
        id: row.company.id,
        name: row.company.name,
        gstin: row.company.gstin,
        role: row.role,
      })),
    };
  }

  private getHighestRole(
    assignments: Array<{ role: UserRole }>,
  ): UserRole | null {
    if (!assignments.length) {
      return null;
    }

    const rank: Record<UserRole, number> = {
      OWNER: 5,
      ADMIN: 4,
      MANAGER: 3,
      ACCOUNTANT: 2,
      VIEWER: 1,
    };

    return assignments
      .map((row) => row.role)
      .sort((a, b) => rank[b] - rank[a])[0];
  }

  private toLegacyRole(role: UserRole | null): string {
    if (!role) {
      return 'VIEWER';
    }

    switch (role) {
      case 'OWNER':
        return 'SUPER_ADMIN';
      case 'ADMIN':
        return 'TENANT_ADMIN';
      case 'MANAGER':
        return 'MANAGER';
      case 'ACCOUNTANT':
        return 'ACCOUNTANT';
      case 'VIEWER':
      default:
        return 'VIEWER';
    }
  }

  private hashOpaqueToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private generateOtpCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private getOtpChallengeKey(requestId: string): string {
    return `auth:otp:challenge:${requestId}`;
  }

  private getOtpCooldownKey(requestId: string): string {
    return `auth:otp:cooldown:${requestId}`;
  }

  private getForgotPasswordOtpKey(identifier: string): string {
    return `auth:forgot:otp:${identifier.toLowerCase()}`;
  }

  private getForgotPasswordCooldownKey(identifier: string): string {
    return `auth:forgot:cooldown:${identifier.toLowerCase()}`;
  }

  private getPasswordResetLinkKey(token: string): string {
    return `auth:reset-link:${this.hashOpaqueToken(token)}`;
  }

  private getSetupLinkKey(token: string): string {
    return `auth:setup-link:${this.hashOpaqueToken(token)}`;
  }

  private getUserPasswordSetupStateKey(userId: string): string {
    return `auth:setup-link:user:${userId}`;
  }

  private async storeOtpChallenge(
    challenge: CachedOtpChallenge,
    ttlSeconds: number,
  ) {
    await this.redisService.set(
      this.getOtpChallengeKey(challenge.requestId),
      JSON.stringify(challenge),
      ttlSeconds,
    );
  }

  private async getOtpChallenge(
    requestId: string,
  ): Promise<CachedOtpChallenge | null> {
    const raw = await this.redisService.get(this.getOtpChallengeKey(requestId));
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as CachedOtpChallenge;
    } catch {
      return null;
    }
  }

  private getRemainingTtlSeconds(challenge: CachedOtpChallenge) {
    const seconds = Math.floor((challenge.expiresAt - Date.now()) / 1000);
    return Math.max(1, seconds);
  }

  private async invalidateOtpChallenge(challenge: CachedOtpChallenge) {
    await this.redisService.del(this.getOtpChallengeKey(challenge.requestId));
    await this.redisService.del(this.getOtpCooldownKey(challenge.requestId));

    if (challenge.dbChallengeId) {
      await this.prisma.otpChallenge.updateMany({
        where: { id: challenge.dbChallengeId, usedAt: null },
        data: { usedAt: new Date() },
      });
    }
  }

  private maskContact(target: string) {
    const atIndex = target.indexOf('@');
    if (atIndex === -1) {
      if (target.length <= 4) {
        return `${target.slice(0, 1)}***`;
      }
      return `${target.slice(0, 2)}***${target.slice(-2)}`;
    }

    const local = target.slice(0, atIndex);
    const domain = target.slice(atIndex + 1);

    const localMasked =
      local.length <= 2 ? `${local.slice(0, 1)}***` : `${local.slice(0, 2)}***`;

    return `${localMasked}@${domain}`;
  }

  private resolvePublicAppUrl(): string {
    const appUrl = this.configService.get<string>('app.url');
    const baseUrl = appUrl
      ?.split(',')
      .map((value) => value.trim())
      .find((value) => value.length > 0);

    if (!baseUrl) {
      throw new Error('APP_URL is required to build password links.');
    }

    return baseUrl.replace(/\/+$/, '');
  }

  private buildPublicLink(
    path: '/accept-invite' | '/reset-password',
    token: string,
  ): string {
    const url = new URL(path, `${this.resolvePublicAppUrl()}/`);
    url.searchParams.set('token', token);
    return url.toString();
  }

  private async clearUserAuthCache(userId: string) {
    const keys = await this.redisService.keys(getUserAuthCachePattern(userId));
    for (const key of keys) {
      await this.redisService.del(key);
    }
  }
}
