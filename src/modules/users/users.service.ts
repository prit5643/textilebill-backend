import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import {
  PasswordTokenStatus,
  PasswordTokenType,
  Prisma,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { OtpDeliveryService } from '../auth/otp-delivery.service';
import {
  generatePasswordLifecycleToken,
  hashPasswordLifecycleToken,
} from '../auth/password-token.util';
import { CreateUserDto, UpdateMyProfileDto, UpdateUserDto } from './dto';
import {
  parsePagination,
  createPaginatedResult,
} from '../../common/utils/pagination.util';
import { getUserAuthCachePattern } from '../auth/auth-request-cache.util';

const PASSWORD_SETUP_LINK_EXPIRY_MINUTES = 30;
const PASSWORD_RESET_LINK_EXPIRY_MINUTES = 30;

type AccessActor = {
  role: string;
  tenantId?: string;
};

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly otpDeliveryService: OtpDeliveryService,
    private readonly configService: ConfigService,
  ) {}

  async create(tenantId: string, dto: CreateUserDto) {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const requestedUsername = dto.username?.trim() || undefined;

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        subscriptions: {
          where: { status: 'ACTIVE' },
          include: { plan: true },
          take: 1,
        },
        users: {
          where: { isActive: true },
          select: { id: true },
        },
      },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    const activeSub = tenant.subscriptions[0];
    if (activeSub && tenant.users.length >= activeSub.plan.maxUsers) {
      throw new ForbiddenException(
        `User limit reached (${activeSub.plan.maxUsers}). Upgrade your plan.`,
      );
    }

    // Check for duplicate identity before we attempt to create the user.
    const existing = await this.prisma.user.findFirst({
      where: {
        OR: requestedUsername
          ? [{ email: normalizedEmail }, { username: requestedUsername }]
          : [{ email: normalizedEmail }],
      },
    });

    if (existing) {
      throw new ConflictException(
        'User with this email or username already exists. Identity is global across tenants.',
      );
    }

    const username = await this.resolveUsername(
      requestedUsername,
      dto.firstName,
      dto.lastName,
    );

    // If no password provided, generate a secure random one — user will set
    // their own password by following the invite link.
    const rawPassword = dto.password ?? (randomUUID() + randomUUID());
    const passwordHash = await bcrypt.hash(rawPassword, 12);

    // Generate setup link token (expires in 30 minutes)
    const inviteToken = generatePasswordLifecycleToken();
    const inviteTokenExpiresAt = new Date(
      Date.now() + PASSWORD_SETUP_LINK_EXPIRY_MINUTES * 60 * 1000,
    );

    const user = await this.prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          tenantId,
          email: normalizedEmail,
          username,
          passwordHash,
          role: dto.role || 'STAFF',
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone,
          inviteToken,
          inviteTokenExpiresAt,
        },
        select: {
          id: true,
          email: true,
          username: true,
          role: true,
          firstName: true,
          lastName: true,
          phone: true,
          avatarUrl: true,
          isActive: true,
          inviteTokenExpiresAt: true,
          passwordChangedAt: true,
          createdAt: true,
        },
      });

      await tx.passwordLifecycleToken.updateMany({
        where: {
          userId: createdUser.id,
          type: PasswordTokenType.SETUP_PASSWORD,
          status: PasswordTokenStatus.ACTIVE,
        },
        data: { status: PasswordTokenStatus.REVOKED },
      });

      await tx.passwordLifecycleToken.create({
        data: {
          tenantId,
          userId: createdUser.id,
          tokenHash: hashPasswordLifecycleToken(inviteToken),
          type: PasswordTokenType.SETUP_PASSWORD,
          status: PasswordTokenStatus.ACTIVE,
          expiresAt: inviteTokenExpiresAt,
          maxResends: 3,
          requestedByRole: 'TENANT_ADMIN',
        },
      });

      if (dto.companyIds?.length) {
        const uniqueCompanyIds = Array.from(new Set(dto.companyIds));
        const validCompanies = await tx.company.findMany({
          where: {
            tenantId,
            id: { in: uniqueCompanyIds },
          },
          select: { id: true },
        });

        if (validCompanies.length !== uniqueCompanyIds.length) {
          throw new BadRequestException(
            'One or more companyIds are invalid for this tenant',
          );
        }

        await tx.userCompanyAccess.createMany({
          data: uniqueCompanyIds.map((companyId) => ({
            userId: createdUser.id,
            companyId,
          })),
          skipDuplicates: true,
        });
      }

      return createdUser;
    }).catch((error: unknown) => {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException(
          'User with this email or username already exists. Identity is global across tenants.',
        );
      }

      throw error;
    });

    // Send invite email asynchronously so creation response isn't delayed
    const inviteLink = this.buildPublicLink('/accept-invite', inviteToken);
    this.otpDeliveryService
      .sendInviteEmail(
        normalizedEmail,
        inviteLink,
        PASSWORD_SETUP_LINK_EXPIRY_MINUTES,
      )
      .catch((err: unknown) =>
        this.logger.error(
          `Failed to send invite email to ${normalizedEmail}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      );

    this.logger.log(
      `[SETUP_LINK] token generated for user=${user.id} email=${normalizedEmail} expires=${inviteTokenExpiresAt.toISOString()}`,
    );

    return {
      ...user,
      passwordSetupStatus: this.getPasswordSetupStatus(
        user.passwordChangedAt,
        user.inviteTokenExpiresAt,
      ),
      passwordSetupLinkSentAt: inviteTokenExpiresAt,
    };
  }

  async findAll(tenantId: string, page?: number, limit?: number) {
    const { skip, take, page: p, limit: l } = parsePagination({ page, limit });

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where: { tenantId },
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          username: true,
          role: true,
          firstName: true,
          lastName: true,
          phone: true,
          avatarUrl: true,
          isActive: true,
          lastLoginAt: true,
          inviteTokenExpiresAt: true,
          passwordChangedAt: true,
          createdAt: true,
        },
      }),
      this.prisma.user.count({ where: { tenantId } }),
    ]);

    return createPaginatedResult(
      data.map((user) => ({
        ...user,
        passwordSetupStatus: this.getPasswordSetupStatus(
          user.passwordChangedAt,
          user.inviteTokenExpiresAt,
        ),
      })),
      total,
      p,
      l,
    );
  }

  async findById(id: string, tenantId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        firstName: true,
        lastName: true,
        phone: true,
        avatarUrl: true,
        isActive: true,
        lastLoginAt: true,
        passwordChangedAt: true,
        inviteTokenExpiresAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      ...user,
      passwordSetupStatus: this.getPasswordSetupStatus(
        user.passwordChangedAt,
        user.inviteTokenExpiresAt,
      ),
    };
  }

  async resendSetupLink(userId: string, tenantId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: {
        id: true,
        email: true,
        firstName: true,
        isActive: true,
        passwordChangedAt: true,
      },
    });

    if (!user || !user.isActive) {
      throw new NotFoundException('User not found');
    }

    if (user.passwordChangedAt) {
      throw new BadRequestException('Password is already set for this user');
    }

    const inviteToken = generatePasswordLifecycleToken();
    const inviteTokenExpiresAt = new Date(
      Date.now() + PASSWORD_SETUP_LINK_EXPIRY_MINUTES * 60 * 1000,
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.passwordLifecycleToken.updateMany({
        where: {
          userId: user.id,
          type: PasswordTokenType.SETUP_PASSWORD,
          status: PasswordTokenStatus.ACTIVE,
        },
        data: { status: PasswordTokenStatus.REVOKED },
      });

      await tx.passwordLifecycleToken.create({
        data: {
          tenantId,
          userId: user.id,
          tokenHash: hashPasswordLifecycleToken(inviteToken),
          type: PasswordTokenType.SETUP_PASSWORD,
          status: PasswordTokenStatus.ACTIVE,
          expiresAt: inviteTokenExpiresAt,
          maxResends: 3,
          requestedByRole: 'SUPER_ADMIN',
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

    const inviteLink = this.buildPublicLink('/accept-invite', inviteToken);
    this.otpDeliveryService
      .sendInviteEmail(user.email, inviteLink, PASSWORD_SETUP_LINK_EXPIRY_MINUTES)
      .catch((err: unknown) =>
        this.logger.error(
          `Failed to resend setup link to ${user.email}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      );

    this.logger.log(
      `[SETUP_LINK] resent by admin for user=${user.id} email=${user.email} expires=${inviteTokenExpiresAt.toISOString()}`,
    );

    return {
      message: 'Password setup link sent',
      expiresAt: inviteTokenExpiresAt,
      email: user.email,
      status: 'RESEND_AVAILABLE',
    };
  }

  async adminSendPasswordResetLink(userId: string, tenantId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: {
        id: true,
        email: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive) {
      throw new NotFoundException('User not found');
    }

    const resetToken = generatePasswordLifecycleToken();
    const expiresAt = new Date(
      Date.now() + PASSWORD_RESET_LINK_EXPIRY_MINUTES * 60 * 1000,
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.passwordLifecycleToken.updateMany({
        where: {
          userId: user.id,
          type: PasswordTokenType.RESET_PASSWORD,
          status: PasswordTokenStatus.ACTIVE,
        },
        data: { status: PasswordTokenStatus.REVOKED },
      });

      await tx.passwordLifecycleToken.create({
        data: {
          tenantId,
          userId: user.id,
          tokenHash: hashPasswordLifecycleToken(resetToken),
          type: PasswordTokenType.RESET_PASSWORD,
          status: PasswordTokenStatus.ACTIVE,
          expiresAt,
          maxResends: 3,
          resendCount: 0,
          requestedByRole: 'SUPER_ADMIN',
        },
      });
    });

    const resetLink = this.buildPublicLink('/reset-password', resetToken);
    this.otpDeliveryService
      .sendPasswordResetLinkEmail(
        user.email,
        resetLink,
        PASSWORD_RESET_LINK_EXPIRY_MINUTES,
      )
      .catch((err: unknown) =>
        this.logger.error(
          `Failed to send admin override password reset link to ${user.email}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      );

    this.logger.log(
      `[PASSWORD_RESET_LINK] admin override sent for user=${user.id} email=${user.email} expires=${expiresAt.toISOString()}`,
    );

    await this.prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'PASSWORD_RESET_ADMIN_OVERRIDE_LINK_SENT',
        entity: 'PASSWORD_LIFECYCLE',
        newValue: {
          channel: 'RESET_LINK',
          expiresAt: expiresAt.toISOString(),
        },
      },
    });

    return {
      message: 'Password reset link sent by admin override',
      email: user.email,
      expiresAt,
      status: 'RESEND_AVAILABLE',
    };
  }

  async getMyProfile(userId: string, tenantId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        firstName: true,
        lastName: true,
        phone: true,
        avatarUrl: true,
        tenantId: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async updateMyProfile(
    userId: string,
    tenantId: string,
    dto: UpdateMyProfileDto,
  ) {
    const currentUser = await this.getMyProfile(userId, tenantId);

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.firstName !== undefined && { firstName: dto.firstName }),
        ...(dto.lastName !== undefined && { lastName: dto.lastName }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
      },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        firstName: true,
        lastName: true,
        phone: true,
        avatarUrl: true,
        tenantId: true,
      },
    });

    if (
      dto.phone !== undefined &&
      currentUser.role === 'TENANT_ADMIN' &&
      currentUser.phone !== dto.phone
    ) {
      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: { phone: dto.phone },
      });
    }

    return updatedUser;
  }

  async updateMyAvatar(userId: string, tenantId: string, avatarUrl: string) {
    await this.getMyProfile(userId, tenantId);

    return this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        firstName: true,
        lastName: true,
        phone: true,
        avatarUrl: true,
        tenantId: true,
      },
    });
  }

  async update(id: string, tenantId: string, dto: UpdateUserDto) {
    const currentUser = await this.findById(id, tenantId);

    const updatedUser = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.firstName !== undefined && { firstName: dto.firstName }),
        ...(dto.lastName !== undefined && { lastName: dto.lastName }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.role !== undefined && { role: dto.role }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        firstName: true,
        lastName: true,
        phone: true,
        avatarUrl: true,
        isActive: true,
        updatedAt: true,
      },
    });

    const effectiveRole = dto.role ?? currentUser.role;
    if (
      dto.phone !== undefined &&
      effectiveRole === 'TENANT_ADMIN' &&
      currentUser.phone !== dto.phone
    ) {
      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: { phone: dto.phone },
      });
    }

    if (dto.role !== undefined || dto.isActive !== undefined) {
      await this.clearUserAuthCache(id);
    }

    return updatedUser;
  }

  async softDelete(id: string, tenantId: string) {
    await this.findById(id, tenantId);

    const user = await this.prisma.user.update({
      where: { id },
      data: { isActive: false },
    });

    await this.clearUserAuthCache(id);
    return user;
  }

  async getSessions(userId: string) {
    return this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeSession(userId: string, tokenId: string) {
    const token = await this.prisma.refreshToken.findFirst({
      where: { id: tokenId, userId, revokedAt: null },
    });
    if (!token) throw new NotFoundException('Session not found');
    await this.prisma.refreshToken.update({
      where: { id: tokenId },
      data: { revokedAt: new Date() },
    });
    return { message: 'Session revoked' };
  }

  async getCompanyAccess(userId: string, actor: AccessActor) {
    await this.findScopedUser(userId, actor);

    const where: Prisma.UserCompanyAccessWhereInput =
      actor.role === 'SUPER_ADMIN'
        ? { userId }
        : { userId, company: { tenantId: actor.tenantId } };

    return this.prisma.userCompanyAccess.findMany({
      where,
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
  }

  async addCompanyAccess(
    userId: string,
    companyId: string,
    actor: AccessActor,
  ) {
    const [user, company] = await Promise.all([
      this.findScopedUser(userId, actor),
      this.findScopedCompany(companyId, actor),
    ]);

    if (user.tenantId !== company.tenantId) {
      throw new BadRequestException(
        'User and company must belong to the same tenant',
      );
    }

    const assignment = await this.prisma.userCompanyAccess.upsert({
      where: { userId_companyId: { userId, companyId } },
      update: {},
      create: { userId, companyId },
    });

    await this.clearCompanyAccessCache(userId, companyId);
    return assignment;
  }

  async removeCompanyAccess(
    userId: string,
    companyId: string,
    actor: AccessActor,
  ) {
    await Promise.all([
      this.findScopedUser(userId, actor),
      this.findScopedCompany(companyId, actor),
    ]);

    const result = await this.prisma.userCompanyAccess.deleteMany({
      where: { userId, companyId },
    });

    await this.clearCompanyAccessCache(userId, companyId);
    return result;
  }

  private async resolveUsername(
    requestedUsername?: string,
    firstName?: string,
    lastName?: string,
  ): Promise<string> {
    if (requestedUsername) {
      return requestedUsername;
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = this.generateUsername(firstName || 'user', lastName || '');
      const existing = await this.prisma.user.findFirst({
        where: { username: candidate },
        select: { id: true },
      });

      if (!existing) {
        return candidate;
      }
    }

    return `${this.buildUsernameBase(firstName || 'user', lastName || '')}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
  }

  private buildUsernameBase(firstName: string, lastName: string): string {
    return `${firstName.toLowerCase().replace(/\s/g, '')}${lastName ? '.' + lastName.toLowerCase().replace(/\s/g, '') : ''}`;
  }

  private generateUsername(firstName: string, lastName: string): string {
    const base = this.buildUsernameBase(firstName, lastName);
    const random = Math.floor(1000 + Math.random() * 9000);
    return `${base}_${random}`;
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return Boolean(
      error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code?: string }).code === 'P2002',
    );
  }

  private async findScopedUser(userId: string, actor: AccessActor) {
    const tenantId = this.requireActorTenantId(actor);

    const user = await this.prisma.user.findFirst({
      where:
        actor.role === 'SUPER_ADMIN'
          ? { id: userId }
          : { id: userId, tenantId },
      select: {
        id: true,
        tenantId: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  private async findScopedCompany(companyId: string, actor: AccessActor) {
    const tenantId = this.requireActorTenantId(actor);

    const company = await this.prisma.company.findFirst({
      where:
        actor.role === 'SUPER_ADMIN'
          ? { id: companyId }
          : { id: companyId, tenantId },
      select: {
        id: true,
        tenantId: true,
      },
    });

    if (!company) {
      throw new NotFoundException('Company not found');
    }

    return company;
  }

  private requireActorTenantId(actor: AccessActor) {
    if (actor.role === 'SUPER_ADMIN') {
      return actor.tenantId;
    }

    if (!actor.tenantId) {
      throw new ForbiddenException('No tenant associated with this user');
    }

    return actor.tenantId;
  }

  private async clearCompanyAccessCache(userId: string, companyId: string) {
    await this.redisService.del(`company-access:${userId}:${companyId}`);
  }

  private async clearUserAuthCache(userId: string) {
    const keys = await this.redisService.keys(getUserAuthCachePattern(userId));
    for (const key of keys) {
      await this.redisService.del(key);
    }
  }

  private resolvePublicAppUrl(): string {
    const appUrl = this.configService.get<string>('app.url')?.trim();
    const baseUrl = appUrl;

    if (!baseUrl) {
      throw new Error(
        'APP_URL is required to build password setup and reset links.',
      );
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

  private getPasswordSetupStatus(
    passwordChangedAt: Date | null | undefined,
    inviteTokenExpiresAt: Date | null | undefined,
  ) {
    if (passwordChangedAt) {
      return 'SETUP_COMPLETED';
    }

    if (!inviteTokenExpiresAt) {
      return 'PENDING_SETUP';
    }

    if (inviteTokenExpiresAt < new Date()) {
      return 'LINK_EXPIRED';
    }

    return 'PENDING_SETUP';
  }
}
