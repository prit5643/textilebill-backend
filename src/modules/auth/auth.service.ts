import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PasswordTokenStatus, PasswordTokenType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { LoginDto } from './dto/login.dto';
import { getUserAuthCachePattern } from './auth-request-cache.util';
import { OtpDeliveryService } from './otp-delivery.service';
import {
  generatePasswordLifecycleToken,
  hashPasswordLifecycleToken,
} from './password-token.util';

export interface JwtPayload {
  sub: string; // userId
  sessionId: string;
  email: string;
  role: string;
  tenantId: string;
  iat?: number;
}

export interface SessionTokenSet {
  accessToken: string;
  sessionToken: string;
  refreshToken: string;
}

export interface SessionClientMetadata {
  deviceId?: string | null;
  userAgent?: string | null;
  ipAddress?: string | null;
}

export interface AuthSessionPayload {
  user: {
    id: string;
    email: string;
    username: string;
    role: string;
    firstName: string | null;
    lastName: string | null;
    tenantId: string;
    avatarUrl?: string | null;
    mustChangePassword: boolean;
    emailVerified: boolean;
    phoneVerified: boolean;
    hasVerifiedContact: boolean;
  };
  companies: Array<{
    id: string;
    name: string;
    gstin: string | null;
    city: string | null;
    state: string | null;
    isActive?: boolean;
  }>;
}

type OtpRouteChannel = 'EMAIL';
type OtpDeliveryChannel = 'EMAIL';
type OtpPurpose = 'LOGIN' | 'VERIFY_EMAIL' | 'PASSWORD_RESET';

type OtpChallengePayload = {
  requestId: string;
  userId: string;
  otp: string;
  purpose: OtpPurpose;
  channel: OtpDeliveryChannel;
  target: string;
  resendCount: number;
};

const OTP_TTL_SECONDS = 300;
const OTP_RESEND_COOLDOWN_SECONDS = 32;
const OTP_MAX_RESEND_COUNT = 3;
const PASSWORD_SETUP_LINK_EXPIRY_MINUTES = 30;
const PASSWORD_SETUP_RESEND_COOLDOWN_SECONDS = 32;
const PASSWORD_SETUP_MAX_RESEND_COUNT = 3;
const PASSWORD_RESET_LINK_EXPIRY_MINUTES = 30;
const PASSWORD_RESET_RESEND_COOLDOWN_SECONDS = 32;
const PASSWORD_RESET_MAX_RESEND_COUNT = 3;

const REFRESH_TOKEN_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const INVALID_REFRESH_TOKEN_MESSAGE =
  'Your session is invalid or has expired. Please sign in again.';
const INVALID_OTP_REQUEST_MESSAGE =
  'This verification request is invalid or has expired. Request a new code and try again.';
const INVALID_OTP_MESSAGE =
  'The code you entered is invalid or has expired. Request a new code and try again.';
const PASSWORD_RESET_OTP_DELIVERY_FAILED_MESSAGE =
  'We could not send the password reset OTP right now. Please try again shortly.';
const PASSWORD_RESET_LINK_DELIVERY_FAILED_MESSAGE =
  'We could not send the password reset email right now. Please try again shortly.';
const INVALID_INVITE_LINK_MESSAGE =
  'This setup link is invalid or no longer available. Request a new setup link and try again.';
const EXPIRED_INVITE_LINK_MESSAGE =
  'This setup link has expired. Request a new setup link from your administrator.';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private lastRefreshTokenCleanupAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly otpDeliveryService: OtpDeliveryService,
  ) {}

  async validateUser(username: string, password: string): Promise<any> {
    const normalizedIdentifier = username.trim();
    const normalizedEmail = normalizedIdentifier.toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { username: normalizedIdentifier },
          { email: normalizedEmail },
          { phone: normalizedIdentifier },
        ],
        isActive: true,
      },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        tenantId: true,
        firstName: true,
        lastName: true,
        phone: true,
        passwordHash: true, // Need this to compare
        passwordChangedAt: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        tenant: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const result = { ...user };
    delete (result as any).passwordHash;
    return result;
  }

  async login(
    dto: LoginDto,
    metadata?: SessionClientMetadata,
  ): Promise<SessionTokenSet & AuthSessionPayload> {
    const user = await this.ensureLegacyPasswordLoginCompatibility(
      await this.validateUser(dto.username, dto.password),
    );

    if (!this.hasAnyVerifiedContact(user)) {
      throw new ForbiddenException(
        'Password sign-in is unavailable until you verify your email with OTP.',
      );
    }

    const tokens = await this.generateTokens(user, metadata);

    // Update last login
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const session = await this.buildAuthSessionPayload(user.id);

    return {
      ...tokens,
      ...session,
    };
  }

  async refreshTokens(
    refreshToken: string,
    metadata?: SessionClientMetadata,
  ): Promise<SessionTokenSet> {
    await this.cleanupRefreshTokensIfDue();
    const refreshTokenHash = this.hashRefreshToken(refreshToken);
    const storedToken = await this.prisma.refreshToken.findFirst({
      where: {
        OR: [{ tokenHash: refreshTokenHash }, { token: refreshToken }],
      },
      include: { user: { include: { tenant: true } } },
    });

    if (
      !storedToken ||
      storedToken.revokedAt ||
      storedToken.expiresAt < new Date()
    ) {
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN_MESSAGE);
    }

    const newRefreshToken = randomUUID();
    const refreshTokenLifetimeMs = this.getRefreshTokenLifetimeMs();
    const expiresAt = new Date(Date.now() + refreshTokenLifetimeMs);

    const payload: JwtPayload = {
      sub: storedToken.user.id,
      sessionId: newRefreshToken,
      email: storedToken.user.email,
      role: storedToken.user.role,
      tenantId: storedToken.user.tenantId,
    };

    const accessToken = this.jwtService.sign(payload);
    const sessionToken = this.jwtService.sign(payload, {
      expiresIn: this.configService.get<string>('jwt.refreshExpiresIn', '7d'),
    });

    const rotated = await this.prisma.$transaction(async (tx) => {
      const revokeResult = await tx.refreshToken.updateMany({
        where: {
          id: storedToken.id,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { revokedAt: new Date() },
      });

      if (revokeResult.count === 0) {
        return false;
      }

      await tx.refreshToken.create({
        data: {
          userId: storedToken.user.id,
          token: newRefreshToken,
          tokenHash: this.hashRefreshToken(newRefreshToken),
          expiresAt,
          deviceId: metadata?.deviceId ?? storedToken.deviceId ?? null,
          userAgent: metadata?.userAgent ?? storedToken.userAgent ?? null,
          ipAddress: metadata?.ipAddress ?? storedToken.ipAddress ?? null,
          lastUsedAt: new Date(),
        },
      });

      return true;
    });

    if (!rotated) {
      // Deterministic response for parallel refresh attempts on an already-rotated token.
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN_MESSAGE);
    }

    // Update Redis only after DB transaction succeeds.
    await this.redisService.del(`refresh:${refreshToken}`);
    await this.redisService.set(
      `refresh:${newRefreshToken}`,
      storedToken.user.id,
      Math.floor(refreshTokenLifetimeMs / 1000),
    );

    return {
      accessToken,
      sessionToken,
      refreshToken: newRefreshToken,
    };
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = this.hashRefreshToken(refreshToken);
    const token = await this.prisma.refreshToken.findFirst({
      where: {
        OR: [{ tokenHash }, { token: refreshToken }],
      },
    });

    if (token) {
      await this.prisma.refreshToken.update({
        where: { id: token.id },
        data: { revokedAt: new Date() },
      });
      await this.redisService.del(`refresh:${refreshToken}`);
    }
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    const activeTokens = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null },
    });

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          passwordHash: hashedPassword,
          passwordChangedAt: new Date(),
        },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    // Clear cached refresh tokens
    for (const token of activeTokens) {
      if (token.token) {
        await this.redisService.del(`refresh:${token.token}`);
      }
    }

    await this.clearUserAuthCache(userId);
  }

  async getCurrentSession(userId: string): Promise<AuthSessionPayload> {
    return this.buildAuthSessionPayload(userId);
  }

  async requestLoginOtp(identifier: string, preferredChannel: OtpRouteChannel) {
    if (!this.redisService.isAvailable()) {
      throw new ServiceUnavailableException(
        'OTP service is temporarily unavailable. Please try again shortly.',
      );
    }

    const user = await this.findUserForOtpIdentifier(identifier);
    if (!user) {
      return {
        message: 'If the account exists, an OTP has been sent.',
        requestId: null,
        expiresInSeconds: OTP_TTL_SECONDS,
      };
    }

    const primary = this.resolvePrimaryOtpRoute(user, preferredChannel);
    if (!primary) {
      throw new BadRequestException(
        'This account does not have an email address available for OTP delivery. Contact your administrator.',
      );
    }

    const otpTarget = this.resolveOtpDeliveryTarget(primary.target);

    const challenge = await this.createOtpChallenge({
      userId: user.id,
      purpose: 'LOGIN',
      channel: primary.channel,
      target: otpTarget,
    });

    const dispatch = await this.dispatchOtp(challenge);
    if (!dispatch.delivered) {
      throw new ServiceUnavailableException(
        this.getOtpDeliveryFailureMessage(primary.target, dispatch.errorMessage),
      );
    }

    return {
      message: 'OTP sent successfully.',
      requestId: challenge.requestId,
      channel: dispatch.channel,
      targetHint: this.maskContact(dispatch.target),
      expiresInSeconds: OTP_TTL_SECONDS,
      resendCooldownSeconds: OTP_RESEND_COOLDOWN_SECONDS,
    };
  }

  async verifyLoginOtp(requestId: string, otp: string) {
    const challenge = await this.getOtpChallenge(requestId);
    if (!challenge || challenge.purpose !== 'LOGIN') {
      throw new UnauthorizedException(INVALID_OTP_REQUEST_MESSAGE);
    }

    if (challenge.otp !== otp.trim()) {
      throw new UnauthorizedException(INVALID_OTP_MESSAGE);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: challenge.userId },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        tenantId: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        passwordChangedAt: true,
        phone: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException(INVALID_OTP_REQUEST_MESSAGE);
    }

    const verifyPatch = {
      emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
    };

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        ...verifyPatch,
        lastLoginAt: new Date(),
      },
    });

    await this.prisma.otpChallenge.update({
      where: { id: challenge.requestId },
      data: {
        verifiedAt: new Date(),
      },
    });

    await this.redisService.del(this.getOtpChallengeKey(requestId));
    await this.redisService.del(this.getOtpCooldownKey(requestId));

    const tokens = await this.generateTokens(user);
    const session = await this.buildAuthSessionPayload(user.id);

    return {
      ...tokens,
      ...session,
    };
  }

  async resendOtp(requestId: string) {
    if (!this.redisService.isAvailable()) {
      throw new ServiceUnavailableException(
        'OTP service is temporarily unavailable. Please try again shortly.',
      );
    }

    const challenge = await this.getOtpChallenge(requestId);
    if (!challenge) {
      throw new UnauthorizedException(INVALID_OTP_REQUEST_MESSAGE);
    }

    const cooldownKey = this.getOtpCooldownKey(requestId);
    const inCooldown = await this.redisService.get(cooldownKey);
    if (inCooldown) {
      const retryAfterSeconds = Math.max(
        1,
        await this.redisService.getTtlSeconds(cooldownKey),
      );
      throw new HttpException(
        {
          message:
            'An OTP was sent recently. Please wait a few seconds before requesting another one.',
          retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (challenge.resendCount >= OTP_MAX_RESEND_COUNT) {
      throw new HttpException(
        'The maximum number of OTP resend attempts has been reached. Start again to receive a new code.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    challenge.otp = this.generateOtpCode();
    challenge.resendCount += 1;
    await this.storeOtpChallenge(challenge);

    const dispatch = await this.dispatchOtp(challenge);
    if (!dispatch.delivered) {
      throw new ServiceUnavailableException(
        this.getOtpDeliveryFailureMessage(challenge.target, dispatch.errorMessage),
      );
    }

    await this.redisService.set(
      cooldownKey,
      '1',
      OTP_RESEND_COOLDOWN_SECONDS,
    );

    await this.prisma.otpChallenge.update({
      where: { id: challenge.requestId },
      data: {
        deliveredChannel: dispatch.channel,
        targetIdentifier: dispatch.target,
        resendCount: challenge.resendCount,
        lastSentAt: new Date(),
      },
    });

    return {
      message: 'OTP resent successfully.',
      requestId,
      channel: dispatch.channel,
      targetHint: this.maskContact(dispatch.target),
      resendCooldownSeconds: OTP_RESEND_COOLDOWN_SECONDS,
      resendCount: challenge.resendCount,
    };
  }

  async getVerificationStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        phone: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return {
      email: {
        value: this.maskContact(user.email),
        verified: !!user.emailVerifiedAt,
      },
      hasVerifiedContact: !!(user.emailVerifiedAt || user.phoneVerifiedAt),
    };
  }

  async requestContactVerification(
    userId: string,
    channel: OtpDeliveryChannel,
  ) {
    if (!this.redisService.isAvailable()) {
      throw new ServiceUnavailableException(
        'OTP service is temporarily unavailable. Please try again shortly.',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        phone: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const purpose: OtpPurpose = 'VERIFY_EMAIL';
    const target = user.email;
    const alreadyVerified = !!user.emailVerifiedAt;

    if (!target) {
      throw new BadRequestException(
        'Email contact is not available for this account.',
      );
    }

    if (alreadyVerified) {
      return {
        message: 'This contact is already verified.',
      };
    }

    const challenge = await this.createOtpChallenge({
      userId,
      purpose,
      channel,
      target,
    });

    const dispatch = await this.dispatchOtp(challenge);
    if (!dispatch.delivered) {
      throw new ServiceUnavailableException(
        'Unable to deliver OTP right now. Please try again.',
      );
    }

    return {
      message: 'Verification OTP sent successfully.',
      requestId: challenge.requestId,
      channel: dispatch.channel,
      targetHint: this.maskContact(dispatch.target),
      expiresInSeconds: OTP_TTL_SECONDS,
      resendCooldownSeconds: OTP_RESEND_COOLDOWN_SECONDS,
    };
  }

  async verifyContactOtp(userId: string, requestId: string, otp: string) {
    const challenge = await this.getOtpChallenge(requestId);
    if (!challenge) {
      throw new UnauthorizedException(INVALID_OTP_REQUEST_MESSAGE);
    }

    if (challenge.userId !== userId) {
      throw new ForbiddenException(
        'This verification request does not belong to the current user.',
      );
    }

    if (challenge.purpose !== 'VERIFY_EMAIL') {
      throw new UnauthorizedException(
        'This verification request is not valid for contact verification.',
      );
    }

    if (challenge.otp !== otp.trim()) {
      throw new UnauthorizedException(INVALID_OTP_MESSAGE);
    }

    const data = { emailVerifiedAt: new Date() };

    await this.prisma.user.update({
      where: { id: userId },
      data,
    });

    await this.prisma.otpChallenge.update({
      where: { id: requestId },
      data: { verifiedAt: new Date() },
    });

    await this.redisService.del(this.getOtpChallengeKey(requestId));
    await this.redisService.del(this.getOtpCooldownKey(requestId));

    return { message: 'Contact verified successfully' };
  }

  // ─── Invite-link acceptance ───────────────────────────────────────────────

  async validateInviteToken(token: string) {
    const tokenRecord = await this.findActivePasswordTokenByRawToken(
      token,
      PasswordTokenType.SETUP_PASSWORD,
    );

    if (tokenRecord) {
      const cooldownKey = this.getPasswordSetupResendCooldownKey(tokenRecord.userId);
      const cooldownTtl = await this.redisService.getTtlSeconds(cooldownKey);

      return {
        valid: true,
        email: tokenRecord.user.email,
        firstName: tokenRecord.user.firstName ?? null,
        expiresAt: tokenRecord.expiresAt,
        expiresInSeconds: Math.max(
          0,
          Math.floor((tokenRecord.expiresAt.getTime() - Date.now()) / 1000),
        ),
        status: tokenRecord.user.passwordChangedAt
          ? 'SETUP_COMPLETED'
          : 'PENDING_SETUP',
        resendCount: tokenRecord.resendCount,
        remainingResends: Math.max(0, tokenRecord.maxResends - tokenRecord.resendCount),
        resendAvailableInSeconds: Math.max(0, cooldownTtl),
      };
    }

    // Legacy fallback for old invite links issued before DB-backed tokens.
    const user = await this.prisma.user.findUnique({
      where: { inviteToken: token },
      select: {
        id: true,
        email: true,
        firstName: true,
        inviteTokenExpiresAt: true,
        passwordChangedAt: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive) {
      throw new BadRequestException(INVALID_INVITE_LINK_MESSAGE);
    }

    if (!user.inviteTokenExpiresAt || user.inviteTokenExpiresAt < new Date()) {
      throw new BadRequestException(EXPIRED_INVITE_LINK_MESSAGE);
    }

    return {
      valid: true,
      email: user.email,
      firstName: user.firstName ?? null,
      expiresAt: user.inviteTokenExpiresAt,
      expiresInSeconds: Math.max(
        0,
        Math.floor(
          (user.inviteTokenExpiresAt.getTime() - Date.now()) / 1000,
        ),
      ),
      status: user.passwordChangedAt ? 'SETUP_COMPLETED' : 'PENDING_SETUP',
      resendCount: 0,
      remainingResends: PASSWORD_SETUP_MAX_RESEND_COUNT,
    };
  }

  async validatePasswordSetupToken(token: string) {
    return this.validateInviteToken(token);
  }

  async acceptInvite(token: string, newPassword: string) {
    const dbToken = await this.findActivePasswordTokenByRawToken(
      token,
      PasswordTokenType.SETUP_PASSWORD,
    );

    const user = dbToken
      ? dbToken.user
      : await this.prisma.user.findUnique({
          where: { inviteToken: token },
          select: {
            id: true,
            email: true,
            username: true,
            role: true,
            tenantId: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
            passwordChangedAt: true,
            phone: true,
            emailVerifiedAt: true,
            phoneVerifiedAt: true,
            isActive: true,
            inviteTokenExpiresAt: true,
          },
        });

    if (!user || !user.isActive) {
      throw new BadRequestException(INVALID_INVITE_LINK_MESSAGE);
    }

    if (
      !dbToken &&
      (!user.inviteTokenExpiresAt || user.inviteTokenExpiresAt < new Date())
    ) {
      throw new BadRequestException(EXPIRED_INVITE_LINK_MESSAGE);
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          passwordChangedAt: new Date(),
          inviteToken: null,
          inviteTokenExpiresAt: null,
          // Mark email verified since they accessed via email link
          emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
          lastLoginAt: new Date(),
        },
      });

      await tx.passwordLifecycleToken.updateMany({
        where: {
          userId: user.id,
          type: PasswordTokenType.SETUP_PASSWORD,
          status: PasswordTokenStatus.ACTIVE,
        },
        data: {
          status: PasswordTokenStatus.USED,
          usedAt: new Date(),
        },
      });
    });

    this.logger.log(
      `[INVITE] accepted: userId=${user.id} email=${user.email}`,
    );

    await this.logPasswordLifecycleEvent(user.id, 'PASSWORD_SETUP_COMPLETED', {
      channel: 'SETUP_LINK',
      email: user.email,
    });

    const tokens = await this.generateTokens(user);
    const session = await this.buildAuthSessionPayload(user.id);

    return { ...tokens, ...session };
  }

  private async generateTokens(
    user: any,
    metadata?: SessionClientMetadata,
  ): Promise<SessionTokenSet> {
    await this.cleanupRefreshTokensIfDue();
    const refreshToken = randomUUID();
    const refreshTokenLifetimeMs = this.getRefreshTokenLifetimeMs();
    const expiresAt = new Date(Date.now() + refreshTokenLifetimeMs);

    const payload: JwtPayload = {
      sub: user.id,
      sessionId: refreshToken,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    };

    const accessToken = this.jwtService.sign(payload);
    const sessionToken = this.jwtService.sign(payload, {
      expiresIn: this.configService.get<string>('jwt.refreshExpiresIn', '7d'),
    });

    // Store refresh token in DB
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: refreshToken,
        tokenHash: this.hashRefreshToken(refreshToken),
        expiresAt,
        deviceId: metadata?.deviceId ?? null,
        userAgent: metadata?.userAgent ?? null,
        ipAddress: metadata?.ipAddress ?? null,
        lastUsedAt: new Date(),
      },
    });

    // Also cache in Redis for fast lookup
    await this.redisService.set(
      `refresh:${refreshToken}`,
      user.id,
      Math.floor(refreshTokenLifetimeMs / 1000),
    );

    return { accessToken, sessionToken, refreshToken };
  }

  private hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async cleanupRefreshTokensIfDue(): Promise<void> {
    const now = Date.now();
    if (now - this.lastRefreshTokenCleanupAt < REFRESH_TOKEN_CLEANUP_INTERVAL_MS) {
      return;
    }

    this.lastRefreshTokenCleanupAt = now;
    const cutoff = new Date(now - 30 * 24 * 60 * 60 * 1000);

    const refreshTokenRepo = this.prisma.refreshToken as {
      deleteMany?: (args: unknown) => Promise<unknown>;
    };
    if (typeof refreshTokenRepo.deleteMany !== 'function') {
      return;
    }

    await refreshTokenRepo.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date(now) } },
          { revokedAt: { lt: cutoff } },
        ],
      },
    });
  }

  async forgotPassword(
    identifier: string,
    preferredChannel: OtpDeliveryChannel = 'EMAIL',
  ): Promise<{
    message: string;
    resendCooldownSeconds: number;
    resendAvailableInSeconds: number;
    channel?: OtpDeliveryChannel;
    targetHint?: string;
  }> {
    const normalizedIdentifier = this.normalizeRecoveryIdentifier(identifier);
    const cooldownKey = this.getForgotPasswordCooldownKey(normalizedIdentifier);
    const otpKey = this.getForgotPasswordOtpKey(normalizedIdentifier);

    const inCooldown = await this.redisService.get(cooldownKey);
    if (inCooldown) {
      const retryAfterSeconds = Math.max(
        1,
        await this.redisService.getTtlSeconds(cooldownKey),
      );
      return {
        message: 'If the email exists, an OTP has been sent',
        resendCooldownSeconds: OTP_RESEND_COOLDOWN_SECONDS,
        resendAvailableInSeconds: retryAfterSeconds,
      };
    }

    const user = await this.findUserForRecoveryIdentifier(normalizedIdentifier);
    if (!user) {
      // Don't reveal if email exists
      await this.redisService.set(cooldownKey, '1', OTP_RESEND_COOLDOWN_SECONDS);
      return {
        message: 'If the email exists, an OTP has been sent',
        resendCooldownSeconds: OTP_RESEND_COOLDOWN_SECONDS,
        resendAvailableInSeconds: OTP_RESEND_COOLDOWN_SECONDS,
      };
    }

    const otpRoute = this.resolveRecoveryOtpRoute(user, preferredChannel);
    if (!otpRoute) {
      throw new BadRequestException(
        'This account does not have an email address available for OTP recovery.',
      );
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await this.redisService.set(otpKey, otp, 600); // 10 min
    await this.redisService.set(cooldownKey, '1', OTP_RESEND_COOLDOWN_SECONDS);

    try {
      const delivery = await this.deliverOtp(
        otpRoute.channel,
        otpRoute.target,
        otp,
        'PASSWORD_RESET',
      );

      if (!delivery.delivered) {
        this.logger.warn(
          `Failed to send password reset OTP for ${normalizedIdentifier} via ${otpRoute.channel}. ${delivery.errorMessage ?? 'Check delivery configuration.'}`,
        );
        throw new ServiceUnavailableException(
          PASSWORD_RESET_OTP_DELIVERY_FAILED_MESSAGE,
        );
      }
    } catch (error) {
      await this.redisService.del(otpKey);
      await this.redisService.del(cooldownKey);

      if (error instanceof ServiceUnavailableException) {
        throw error;
      }

      const errorMessage =
        error instanceof Error ? error.message : 'Unknown delivery error';
      this.logger.error(
        `Unexpected error while sending password reset OTP for ${normalizedIdentifier}: ${errorMessage}`,
      );
      throw new ServiceUnavailableException(
        PASSWORD_RESET_OTP_DELIVERY_FAILED_MESSAGE,
      );
    }

    this.logger.log(
      `Password reset OTP sent for ${normalizedIdentifier} via ${otpRoute.channel}`,
    );

    return {
      message: 'If the email exists, an OTP has been sent',
      resendCooldownSeconds: OTP_RESEND_COOLDOWN_SECONDS,
      resendAvailableInSeconds: OTP_RESEND_COOLDOWN_SECONDS,
      channel: otpRoute.channel,
      targetHint: this.maskContact(otpRoute.target),
    };
  }

  async resetPassword(
    identifier: string,
    otp: string,
    newPassword: string,
  ): Promise<void> {
    const normalizedIdentifier = this.normalizeRecoveryIdentifier(identifier);
    const storedOtp = await this.redisService.get(
      this.getForgotPasswordOtpKey(normalizedIdentifier),
    );
    if (!storedOtp || storedOtp !== otp) {
      throw new UnauthorizedException(INVALID_OTP_MESSAGE);
    }

    const user = await this.findUserForRecoveryIdentifier(normalizedIdentifier);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    const activeTokens = await this.prisma.refreshToken.findMany({
      where: { userId: user.id, revokedAt: null },
    });

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: hashedPassword, passwordChangedAt: new Date() },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.passwordLifecycleToken.updateMany({
        where: {
          userId: user.id,
          type: PasswordTokenType.RESET_PASSWORD,
          status: PasswordTokenStatus.ACTIVE,
        },
        data: {
          status: PasswordTokenStatus.USED,
          usedAt: new Date(),
        },
      }),
    ]);

    await this.redisService.del(this.getForgotPasswordOtpKey(normalizedIdentifier));
    await this.redisService.del(
      this.getForgotPasswordCooldownKey(normalizedIdentifier),
    );
    for (const token of activeTokens) {
      if (token.token) {
        await this.redisService.del(`refresh:${token.token}`);
      }
    }
    await this.clearUserAuthCache(user.id);

    await this.redisService.del(this.getPasswordSetupResendCooldownKey(user.id));

    await this.logPasswordLifecycleEvent(user.id, 'PASSWORD_RESET_COMPLETED', {
      channel: 'OTP',
      identifier: normalizedIdentifier,
    });
  }

  async requestPasswordResetLink(identifier: string) {
    const normalizedIdentifier = this.normalizeRecoveryIdentifier(identifier);
    const genericResponse = {
      message: 'If the email exists, a password reset link has been sent',
    };

    const user = await this.findUserForRecoveryIdentifier(normalizedIdentifier);

    if (!user || !user.isActive) {
      return genericResponse;
    }

    const cooldownKey = this.getPasswordResetLinkCooldownKey(user.id);
    const inCooldown = await this.redisService.get(cooldownKey);
    if (inCooldown) {
      const retryAfterSeconds = Math.max(
        1,
        await this.redisService.getTtlSeconds(cooldownKey),
      );
      return {
        ...genericResponse,
        status: 'RESEND_AVAILABLE',
        resendCooldownSeconds: PASSWORD_RESET_RESEND_COOLDOWN_SECONDS,
        resendAvailableInSeconds: retryAfterSeconds,
      };
    }

    const existingActiveToken = await this.prisma.passwordLifecycleToken.findFirst({
      where: {
        userId: user.id,
        type: PasswordTokenType.RESET_PASSWORD,
        status: PasswordTokenStatus.ACTIVE,
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        resendCount: true,
        maxResends: true,
      },
    });

    const resendCount = existingActiveToken?.resendCount ?? 0;
    const maxResends = existingActiveToken?.maxResends ?? PASSWORD_RESET_MAX_RESEND_COUNT;
    if (resendCount >= maxResends) {
      await this.logPasswordLifecycleEvent(user.id, 'PASSWORD_RESET_LIMIT_REACHED', {
        channel: 'RESET_LINK',
      });

      return {
        message:
          'The maximum number of password reset link resend attempts has been reached. Please contact your administrator.',
        status: 'RESEND_LIMIT_REACHED',
        remainingResends: 0,
      };
    }

    const resetToken = generatePasswordLifecycleToken();
    const expiresAt = new Date(
      Date.now() + PASSWORD_RESET_LINK_EXPIRY_MINUTES * 60 * 1000,
    );

    const nextResendCount = existingActiveToken ? existingActiveToken.resendCount + 1 : 0;

    await this.prisma.$transaction(async (tx) => {
      await tx.passwordLifecycleToken.updateMany({
        where: {
          userId: user.id,
          type: PasswordTokenType.RESET_PASSWORD,
          status: PasswordTokenStatus.ACTIVE,
        },
        data: {
          status: PasswordTokenStatus.REVOKED,
        },
      });

      await tx.passwordLifecycleToken.create({
        data: {
          tenantId: user.tenantId,
          userId: user.id,
          tokenHash: hashPasswordLifecycleToken(resetToken),
          type: PasswordTokenType.RESET_PASSWORD,
          status: PasswordTokenStatus.ACTIVE,
          expiresAt,
          maxResends: PASSWORD_RESET_MAX_RESEND_COUNT,
          resendCount: nextResendCount,
          requestedByRole: 'SYSTEM',
        },
      });
    });

    const appUrl = this.configService.get<string>('app.url', 'http://localhost:3001');
    const resetLink = `${appUrl}/reset-password?token=${resetToken}`;
    let delivered = false;

    try {
      delivered = await this.otpDeliveryService.sendPasswordResetLinkEmail(
        user.email,
        resetLink,
        PASSWORD_RESET_LINK_EXPIRY_MINUTES,
      );
    } catch (err: unknown) {
      this.logger.error(
        `Failed to send password reset link to ${user.email}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    await this.redisService.set(
      cooldownKey,
      '1',
      PASSWORD_RESET_RESEND_COOLDOWN_SECONDS,
    );

    await this.logPasswordLifecycleEvent(user.id, 'PASSWORD_RESET_LINK_SENT', {
      channel: 'EMAIL',
      linkType: 'RESET_LINK',
      deliveryStatus: delivered ? 'QUEUED_OR_SENT' : 'FAILED',
      email: user.email,
      expiresAt: expiresAt.toISOString(),
      resendCount: nextResendCount,
      remainingResends: Math.max(0, PASSWORD_RESET_MAX_RESEND_COUNT - nextResendCount),
    });

    if (!delivered) {
      throw new ServiceUnavailableException(
        PASSWORD_RESET_LINK_DELIVERY_FAILED_MESSAGE,
      );
    }

    return {
      ...genericResponse,
      status: 'RESEND_AVAILABLE',
      resendCount: nextResendCount,
      remainingResends: Math.max(0, PASSWORD_RESET_MAX_RESEND_COUNT - nextResendCount),
      resendCooldownSeconds: PASSWORD_RESET_RESEND_COOLDOWN_SECONDS,
      resendAvailableInSeconds: PASSWORD_RESET_RESEND_COOLDOWN_SECONDS,
      expiresAt,
      expiresInSeconds: PASSWORD_RESET_LINK_EXPIRY_MINUTES * 60,
    };
  }

  async validatePasswordResetToken(token: string) {
    const tokenRecord = await this.findActivePasswordTokenByRawToken(
      token,
      PasswordTokenType.RESET_PASSWORD,
    );
    if (!tokenRecord) {
      throw new BadRequestException('Invalid or expired password reset link');
    }

    const expiresInSeconds = Math.max(
      0,
      Math.floor((tokenRecord.expiresAt.getTime() - Date.now()) / 1000),
    );

    return {
      valid: true,
      email: tokenRecord.user.email,
      firstName: tokenRecord.user.firstName ?? null,
      expiresInSeconds,
      status: 'RESEND_AVAILABLE',
    };
  }

  async resetPasswordWithLink(token: string, newPassword: string): Promise<void> {
    const tokenRecord = await this.findActivePasswordTokenByRawToken(
      token,
      PasswordTokenType.RESET_PASSWORD,
    );
    if (!tokenRecord) {
      throw new BadRequestException('Invalid or expired password reset link');
    }

    const user = tokenRecord.user;

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    const activeTokens = await this.prisma.refreshToken.findMany({
      where: { userId: user.id, revokedAt: null },
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash: hashedPassword, passwordChangedAt: new Date() },
      });

      await tx.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      await tx.passwordLifecycleToken.updateMany({
        where: {
          userId: user.id,
          type: PasswordTokenType.RESET_PASSWORD,
          status: PasswordTokenStatus.ACTIVE,
        },
        data: {
          status: PasswordTokenStatus.USED,
          usedAt: new Date(),
        },
      });
    });

    await this.redisService.del(this.getPasswordResetLinkCooldownKey(user.id));

    for (const activeToken of activeTokens) {
      await this.redisService.del(`refresh:${activeToken.token}`);
    }

    await this.clearUserAuthCache(user.id);
    await this.logPasswordLifecycleEvent(user.id, 'PASSWORD_RESET_COMPLETED', {
      channel: 'RESET_LINK',
      email: user.email,
    });
  }

  async resendPasswordSetupLink(input: { email?: string; token?: string }) {
    const email = input.email?.trim().toLowerCase();
    const token = input.token?.trim();

    if (!email && !token) {
      throw new BadRequestException(
        'Provide either an email address or a setup token to resend the password setup link.',
      );
    }

    const tokenRecord = token
      ? await this.findActivePasswordTokenByRawToken(
          token,
          PasswordTokenType.SETUP_PASSWORD,
        )
      : null;

    const user = tokenRecord?.user
      ?? (email
        ? await this.prisma.user.findUnique({
            where: { email: email as string },
            select: {
              id: true,
              tenantId: true,
              email: true,
              firstName: true,
              isActive: true,
              passwordChangedAt: true,
            },
          })
        : null);

    if (!user || !user.isActive) {
      return {
        message: 'If an eligible account exists, a password setup link has been sent',
      };
    }

    if (user.passwordChangedAt) {
      return {
        message: 'Password has already been set for this account.',
        status: 'SETUP_COMPLETED',
      };
    }

    const cooldownKey = this.getPasswordSetupResendCooldownKey(user.id);
    const inCooldown = await this.redisService.get(cooldownKey);
    if (inCooldown) {
      const retryAfterSeconds = Math.max(
        1,
        await this.redisService.getTtlSeconds(cooldownKey),
      );
      return {
        message:
          'A setup link was sent recently. Please wait before requesting another one.',
        status: 'RESEND_AVAILABLE',
        resendCooldownSeconds: PASSWORD_SETUP_RESEND_COOLDOWN_SECONDS,
        resendAvailableInSeconds: retryAfterSeconds,
      };
    }

    const activeSetupToken = tokenRecord
      ?? (await this.prisma.passwordLifecycleToken.findFirst({
        where: {
          userId: user.id,
          type: PasswordTokenType.SETUP_PASSWORD,
          status: PasswordTokenStatus.ACTIVE,
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          resendCount: true,
          maxResends: true,
          userId: true,
          tenantId: true,
          user: {
            select: {
              id: true,
              tenantId: true,
              email: true,
              firstName: true,
              isActive: true,
              passwordChangedAt: true,
            },
          },
        },
      }));

    const resendCount = activeSetupToken?.resendCount ?? 0;
    const maxResends = activeSetupToken?.maxResends ?? PASSWORD_SETUP_MAX_RESEND_COUNT;
    if (resendCount >= maxResends) {
      await this.logPasswordLifecycleEvent(user.id, 'PASSWORD_SETUP_LIMIT_REACHED', {
        channel: 'SETUP_LINK',
      });

      return {
        message:
          'The maximum number of setup link resend attempts has been reached. Please contact your administrator.',
        status: 'RESEND_LIMIT_REACHED',
        remainingResends: 0,
      };
    }

    const inviteToken = generatePasswordLifecycleToken();
    const inviteTokenExpiresAt = new Date(
      Date.now() + PASSWORD_SETUP_LINK_EXPIRY_MINUTES * 60 * 1000,
    );

    const nextResendCount = activeSetupToken ? activeSetupToken.resendCount + 1 : 0;

    await this.prisma.$transaction(async (tx) => {
      await tx.passwordLifecycleToken.updateMany({
        where: {
          userId: user.id,
          type: PasswordTokenType.SETUP_PASSWORD,
          status: PasswordTokenStatus.ACTIVE,
        },
        data: {
          status: PasswordTokenStatus.REVOKED,
        },
      });

      await tx.passwordLifecycleToken.create({
        data: {
          tenantId: user.tenantId,
          userId: user.id,
          tokenHash: hashPasswordLifecycleToken(inviteToken),
          type: PasswordTokenType.SETUP_PASSWORD,
          status: PasswordTokenStatus.ACTIVE,
          expiresAt: inviteTokenExpiresAt,
          maxResends: PASSWORD_SETUP_MAX_RESEND_COUNT,
          resendCount: nextResendCount,
          requestedByRole: 'USER',
        },
      });

      await tx.user.update({
        where: { id: user.id },
        data: {
          inviteToken,
          inviteTokenExpiresAt,
        },
      });
    });

    const appUrl = this.configService.get<string>('app.url', 'http://localhost:3001');
    const inviteLink = `${appUrl}/accept-invite?token=${inviteToken}`;
    let delivered = false;

    try {
      delivered = await this.otpDeliveryService.sendInviteEmail(
        user.email,
        inviteLink,
        PASSWORD_SETUP_LINK_EXPIRY_MINUTES,
      );
    } catch (err: unknown) {
      this.logger.error(
        `Failed to resend setup link to ${user.email}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    await this.redisService.set(
      cooldownKey,
      '1',
      PASSWORD_SETUP_RESEND_COOLDOWN_SECONDS,
    );

    await this.logPasswordLifecycleEvent(user.id, 'PASSWORD_SETUP_LINK_RESENT', {
      channel: 'EMAIL',
      linkType: 'SETUP_LINK',
      deliveryStatus: delivered ? 'QUEUED_OR_SENT' : 'FAILED',
      email: user.email,
      expiresAt: inviteTokenExpiresAt.toISOString(),
      resendCount: nextResendCount,
      remainingResends: Math.max(0, PASSWORD_SETUP_MAX_RESEND_COUNT - nextResendCount),
    });

    return {
      message: 'If an eligible account exists, a password setup link has been sent',
      status: 'RESEND_AVAILABLE',
      expiresAt: inviteTokenExpiresAt,
      resendCount: nextResendCount,
      remainingResends: Math.max(0, maxResends - nextResendCount),
      resendCooldownSeconds: PASSWORD_SETUP_RESEND_COOLDOWN_SECONDS,
      resendAvailableInSeconds: PASSWORD_SETUP_RESEND_COOLDOWN_SECONDS,
    };
  }

  async getUserSessions(userId: string) {
    return this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
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
  }

  async revokeSession(userId: string, tokenId: string): Promise<void> {
    const token = await this.prisma.refreshToken.findFirst({
      where: { id: tokenId, userId, revokedAt: null },
    });
    if (!token) throw new UnauthorizedException('Session not found');
    await this.prisma.refreshToken.update({
      where: { id: tokenId },
      data: { revokedAt: new Date() },
    });
    await this.redisService.del(`refresh:${token.token}`);
  }

  private async clearUserAuthCache(userId: string): Promise<void> {
    const keys = await this.redisService.keys(getUserAuthCachePattern(userId));
    for (const key of keys) {
      await this.redisService.del(key);
    }
  }

  private async buildAuthSessionPayload(
    userId: string,
  ): Promise<AuthSessionPayload> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        firstName: true,
        lastName: true,
        tenantId: true,
        avatarUrl: true,
        passwordChangedAt: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        firstName: user.firstName,
        lastName: user.lastName,
        tenantId: user.tenantId,
        avatarUrl: user.avatarUrl,
        mustChangePassword: !user.passwordChangedAt,
        emailVerified: !!user.emailVerifiedAt,
        phoneVerified: !!user.phoneVerifiedAt,
        hasVerifiedContact: !!(user.emailVerifiedAt || user.phoneVerifiedAt),
      },
      companies: await this.getUserCompanies(userId),
    };
  }

  private hasAnyVerifiedContact(user: {
    emailVerifiedAt?: Date | null;
    phoneVerifiedAt?: Date | null;
  }) {
    return !!(user.emailVerifiedAt || user.phoneVerifiedAt);
  }

  private async ensureLegacyPasswordLoginCompatibility<
    T extends {
      id: string;
      email?: string | null;
      passwordChangedAt?: Date | null;
      emailVerifiedAt?: Date | null;
      phoneVerifiedAt?: Date | null;
    },
  >(user: T): Promise<T> {
    if (this.hasAnyVerifiedContact(user)) {
      return user;
    }

    if (!user.passwordChangedAt || !user.email) {
      return user;
    }

    const verifiedAt = new Date();
    await this.prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: verifiedAt },
    });

    this.logger.warn(
      `Backfilled legacy email verification during password login for user=${user.id} email=${user.email}`,
    );

    return {
      ...user,
      emailVerifiedAt: verifiedAt,
    };
  }

  private normalizeRecoveryIdentifier(identifier: string): string {
    const normalized = identifier.trim();
    return normalized.includes('@') ? normalized.toLowerCase() : normalized;
  }

  private async findUserForRecoveryIdentifier(identifier: string) {
    const normalized = this.normalizeRecoveryIdentifier(identifier);
    const normalizedEmail = normalized.toLowerCase();

    return this.prisma.user.findFirst({
      where: {
        OR: [{ email: normalizedEmail }, { phone: normalized }],
        isActive: true,
      },
      select: {
        id: true,
        tenantId: true,
        email: true,
        phone: true,
        firstName: true,
        isActive: true,
      },
    });
  }

  private async findUserForOtpIdentifier(identifier: string) {
    const normalized = identifier.trim();
    const normalizedEmail = normalized.toLowerCase();

    return this.prisma.user.findFirst({
      where: {
        OR: [
          { email: normalizedEmail },
          { username: normalized },
          { phone: normalized },
        ],
        isActive: true,
      },
      select: {
        id: true,
        email: true,
        username: true,
        phone: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
      },
    });
  }

  private resolveRecoveryOtpRoute(
    user: {
      email: string;
      phone: string | null;
    },
    preferredChannel: OtpDeliveryChannel,
  ): { channel: OtpDeliveryChannel; target: string } | null {
    if (user.email) {
      return { channel: 'EMAIL', target: user.email };
    }

    return null;
  }

  private resolvePrimaryOtpRoute(
    user: {
      email: string;
      phone: string | null;
      emailVerifiedAt: Date | null;
      phoneVerifiedAt: Date | null;
    },
    preferredChannel: OtpRouteChannel,
  ): {
    channel: OtpDeliveryChannel;
    target: string;
  } | null {
    const hasEmail = !!user.email;
    const emailVerified = !!user.emailVerifiedAt;
    const verifiedOnlyAvailable = emailVerified || !!user.phoneVerifiedAt;

    const canUseEmail = verifiedOnlyAvailable ? emailVerified : hasEmail;

    if (preferredChannel === 'EMAIL' && canUseEmail) {
      return {
        channel: 'EMAIL' as OtpDeliveryChannel,
        target: user.email,
      };
    }

    if (canUseEmail) {
      return {
        channel: 'EMAIL' as OtpDeliveryChannel,
        target: user.email,
      };
    }

    return null;
  }

  private async createOtpChallenge(input: {
    userId: string;
    purpose: OtpPurpose;
    channel: OtpDeliveryChannel;
    target: string;
  }): Promise<OtpChallengePayload> {
    const requestId = randomUUID();
    const challenge: OtpChallengePayload = {
      requestId,
      userId: input.userId,
      purpose: input.purpose,
      otp: this.generateOtpCode(),
      channel: input.channel,
      target: input.target,
      resendCount: 0,
    };

    await this.storeOtpChallenge(challenge);

    await this.prisma.otpChallenge.create({
      data: {
        id: requestId,
        userId: input.userId,
        purpose: input.purpose,
        requestedChannel: input.channel,
        deliveredChannel: input.channel,
        targetIdentifier: input.target,
        expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000),
      },
    });

    return challenge;
  }

  private async storeOtpChallenge(challenge: OtpChallengePayload): Promise<void> {
    await this.redisService.set(
      this.getOtpChallengeKey(challenge.requestId),
      JSON.stringify(challenge),
      OTP_TTL_SECONDS,
    );
  }

  private async getOtpChallenge(
    requestId: string,
  ): Promise<OtpChallengePayload | null> {
    const raw = await this.redisService.get(this.getOtpChallengeKey(requestId));
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as OtpChallengePayload;
    } catch {
      return null;
    }
  }

  private async dispatchOtp(challenge: OtpChallengePayload): Promise<{
    delivered: boolean;
    channel: OtpDeliveryChannel;
    target: string;
    errorMessage?: string;
  }> {
    const delivery = await this.deliverOtp(
      challenge.channel,
      challenge.target,
      challenge.otp,
      challenge.purpose,
    );

    return {
      delivered: delivery.delivered,
      channel: challenge.channel,
      target: challenge.target,
      errorMessage: delivery.errorMessage,
    };
  }

  private async deliverOtp(
    channel: OtpDeliveryChannel,
    target: string,
    otp: string,
    purpose: OtpPurpose,
  ): Promise<{ delivered: boolean; errorMessage?: string }> {
    try {
      const delivered = await this.otpDeliveryService.deliver({
        channel,
        target,
        otp,
        purpose,
        maskedTarget: this.maskContact(target),
      });

      return { delivered };
    } catch (error) {
      return {
        delivered: false,
        errorMessage: this.toErrorMessage(error),
      };
    }
  }

  private generateOtpCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private maskContact(value: string): string {
    if (!value) {
      return '';
    }

    if (value.includes('@')) {
      const [local, domain] = value.split('@');
      if (!local || !domain) {
        return '***';
      }
      const safeLocal = `${local.slice(0, 2)}***`;
      return `${safeLocal}@${domain}`;
    }

    const cleaned = value.replace(/\s+/g, '');
    if (cleaned.length <= 4) {
      return '***';
    }
    return `${'*'.repeat(Math.max(0, cleaned.length - 4))}${cleaned.slice(-4)}`;
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
      return error.message.trim();
    }

    if (typeof error === 'string' && error.trim()) {
      return error.trim();
    }

    return 'Unknown OTP delivery error';
  }

  private getOtpDeliveryFailureMessage(
    _target: string,
    _deliveryError?: string,
  ): string {
    return 'We could not deliver the OTP right now. Please try again shortly.';
  }

  private resolveOtpDeliveryTarget(target: string): string {
    return target;
  }

  private getOtpChallengeKey(requestId: string): string {
    return `auth:otp:challenge:${requestId}`;
  }

  private getOtpCooldownKey(requestId: string): string {
    return `auth:otp:cooldown:${requestId}`;
  }

  private getForgotPasswordOtpKey(email: string): string {
    return `auth:forgot:otp:${email}`;
  }

  private getForgotPasswordCooldownKey(email: string): string {
    return `auth:forgot:cooldown:${email}`;
  }

  private getPasswordSetupResendCooldownKey(userId: string): string {
    return `auth:setup:resend-cooldown:${userId}`;
  }

  private getPasswordResetLinkCooldownKey(userId: string): string {
    return `auth:reset-link:resend-cooldown:${userId}`;
  }

  private async findActivePasswordTokenByRawToken(
    token: string,
    type: PasswordTokenType,
  ) {
    const tokenHash = hashPasswordLifecycleToken(token);
    const tokenRecord = await this.prisma.passwordLifecycleToken.findFirst({
      where: {
        tokenHash,
        type,
        status: PasswordTokenStatus.ACTIVE,
      },
      select: {
        id: true,
        userId: true,
        tenantId: true,
        expiresAt: true,
        resendCount: true,
        maxResends: true,
        user: {
          select: {
            id: true,
            tenantId: true,
            email: true,
            username: true,
            role: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
            passwordChangedAt: true,
            phone: true,
            emailVerifiedAt: true,
            phoneVerifiedAt: true,
            isActive: true,
            inviteTokenExpiresAt: true,
          },
        },
      },
    });

    if (!tokenRecord || !tokenRecord.user.isActive) {
      return null;
    }

    if (tokenRecord.expiresAt < new Date()) {
      await this.prisma.passwordLifecycleToken.update({
        where: { id: tokenRecord.id },
        data: { status: PasswordTokenStatus.EXPIRED },
      });
      await this.logPasswordLifecycleEvent(
        tokenRecord.userId,
        type === PasswordTokenType.SETUP_PASSWORD
          ? 'PASSWORD_SETUP_LINK_EXPIRED'
          : 'PASSWORD_RESET_LINK_EXPIRED',
        {
          channel: 'EMAIL',
          linkType:
            type === PasswordTokenType.SETUP_PASSWORD
              ? 'SETUP_LINK'
              : 'RESET_LINK',
          expiresAt: tokenRecord.expiresAt.toISOString(),
          email: tokenRecord.user.email,
        },
      );
      return null;
    }

    return tokenRecord;
  }

  private async logPasswordLifecycleEvent(
    userId: string,
    action: string,
    metadata?: Record<string, unknown>,
  ) {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId,
          action,
          entity: 'PASSWORD_LIFECYCLE',
          newValue: (metadata ?? {}) as any,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to write password lifecycle audit log (${action}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async getUserCompanies(userId: string) {
    try {
      const companyAccess = await this.prisma.userCompanyAccess.findMany({
        where: { userId },
        include: {
          company: {
            select: {
              id: true,
              name: true,
              gstin: true,
              city: true,
              state: true,
              isActive: true,
            },
          },
        },
      });

      return companyAccess
        .map((companyAccessRow) => companyAccessRow.company)
        .filter((company) => company.isActive);
    } catch (dbErr) {
      this.logger.error(`Failed to fetch companies for user ${userId}`, dbErr);
      return [];
    }
  }

  private getRefreshTokenLifetimeMs() {
    const raw = this.configService.get<string>('jwt.refreshExpiresIn', '7d');
    const match = raw.trim().match(/^(\d+)(ms|s|m|h|d)?$/i);

    if (!match) {
      return 7 * 24 * 60 * 60 * 1000;
    }

    const amount = Number(match[1]);
    const unit = (match[2] || 's').toLowerCase();

    switch (unit) {
      case 'ms':
        return amount;
      case 's':
        return amount * 1000;
      case 'm':
        return amount * 60 * 1000;
      case 'h':
        return amount * 60 * 60 * 1000;
      case 'd':
        return amount * 24 * 60 * 60 * 1000;
      default:
        return 7 * 24 * 60 * 60 * 1000;
    }
  }
}
