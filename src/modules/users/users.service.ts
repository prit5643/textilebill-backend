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
import { Prisma, UserRole } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { OtpDeliveryService } from '../auth/otp-delivery.service';
import { CreateUserDto, UpdateMyProfileDto, UpdateUserDto } from './dto';
import {
  parsePagination,
  createPaginatedResult,
} from '../../common/utils/pagination.util';
import { getUserAuthCachePattern } from '../auth/auth-request-cache.util';

const PASSWORD_SETUP_LINK_EXPIRY_MINUTES = 30;

type AccessActor = {
  role: string;
  tenantId?: string;
};

type UserWithAccess = {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  phone: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  userCompanies?: Array<{ companyId: string; role: UserRole }>;
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

    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId, deletedAt: null, status: 'ACTIVE' },
      select: { id: true },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    const existing = await this.prisma.user.findFirst({
      where: {
        tenantId,
        deletedAt: null,
        email: { equals: normalizedEmail, mode: 'insensitive' },
      },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException('User with this email already exists in tenant');
    }

    const rawPassword = dto.password ?? randomUUID().replace(/-/g, '');
    const passwordHash = await bcrypt.hash(rawPassword, 12);
    const displayName = this.composeName(dto.firstName, dto.lastName, normalizedEmail);
    const mappedRole = this.mapRole(dto.role);

    const createdUser = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          tenantId,
          email: normalizedEmail,
          passwordHash,
          name: displayName,
          phone: dto.phone,
          status: 'ACTIVE',
        },
        include: {
          userCompanies: {
            select: {
              companyId: true,
              role: true,
            },
          },
        },
      });

      if (dto.companyIds?.length) {
        const uniqueCompanyIds = Array.from(new Set(dto.companyIds));
        const validCompanies = await tx.company.findMany({
          where: {
            tenantId,
            deletedAt: null,
            status: 'ACTIVE',
            id: { in: uniqueCompanyIds },
          },
          select: { id: true },
        });

        if (validCompanies.length !== uniqueCompanyIds.length) {
          throw new BadRequestException(
            'One or more companyIds are invalid for this tenant',
          );
        }

        await tx.userCompany.createMany({
          data: uniqueCompanyIds.map((companyId) => ({
            tenantId,
            userId: user.id,
            companyId,
            role: mappedRole,
          })),
          skipDuplicates: true,
        });

        user.userCompanies = uniqueCompanyIds.map((companyId) => ({
          companyId,
          role: mappedRole,
        }));
      }

      return user;
    }).catch((error: unknown) => {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('User with this email already exists in tenant');
      }

      throw error;
    });

    const setupLink = this.buildPublicLink('/forgot-password', {
      email: normalizedEmail,
    });

    this.otpDeliveryService
      .sendInviteEmail(normalizedEmail, setupLink, PASSWORD_SETUP_LINK_EXPIRY_MINUTES)
      .catch((err: unknown) =>
        this.logger.error(
          `Failed to send setup guidance email to ${normalizedEmail}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      );

    return {
      ...this.toUserResponse(createdUser),
      passwordSetupStatus: 'PENDING_SETUP',
      passwordSetupLinkSentAt: new Date(),
    };
  }

  async findAll(tenantId: string, page?: number, limit?: number) {
    const { skip, take, page: p, limit: l } = parsePagination({ page, limit });

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where: { tenantId, deletedAt: null },
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          userCompanies: {
            select: {
              companyId: true,
              role: true,
            },
          },
        },
      }),
      this.prisma.user.count({ where: { tenantId, deletedAt: null } }),
    ]);

    return createPaginatedResult(
      data.map((user) => this.toUserResponse(user)),
      total,
      p,
      l,
    );
  }

  async findById(id: string, tenantId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        userCompanies: {
          select: {
            companyId: true,
            role: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.toUserResponse(user);
  }

  async resendSetupLink(userId: string, tenantId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId, deletedAt: null, status: 'ACTIVE' },
      select: { id: true, email: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const setupLink = this.buildPublicLink('/forgot-password', {
      email: user.email,
    });

    this.otpDeliveryService
      .sendInviteEmail(user.email, setupLink, PASSWORD_SETUP_LINK_EXPIRY_MINUTES)
      .catch((err: unknown) =>
        this.logger.error(
          `Failed to resend setup guidance email to ${user.email}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      );

    return {
      message: 'Password setup guidance email sent',
      email: user.email,
      status: 'RESEND_AVAILABLE',
    };
  }

  async adminSendPasswordResetLink(userId: string, tenantId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId, deletedAt: null, status: 'ACTIVE' },
      select: { id: true, email: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const resetStartLink = this.buildPublicLink('/forgot-password', {
      email: user.email,
    });

    this.otpDeliveryService
      .sendPasswordResetLinkEmail(
        user.email,
        resetStartLink,
        PASSWORD_SETUP_LINK_EXPIRY_MINUTES,
      )
      .catch((err: unknown) =>
        this.logger.error(
          `Failed to send password reset guidance email to ${user.email}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      );

    return {
      message: 'Password reset guidance sent',
      email: user.email,
      status: 'RESEND_AVAILABLE',
    };
  }

  async getMyProfile(userId: string, tenantId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId, deletedAt: null },
      include: {
        userCompanies: {
          select: {
            companyId: true,
            role: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.toUserResponse(user);
  }

  async updateMyProfile(
    userId: string,
    tenantId: string,
    dto: UpdateMyProfileDto,
  ) {
    const currentUser = await this.getMyProfile(userId, tenantId);

    const nextName =
      dto.firstName !== undefined || dto.lastName !== undefined
        ? this.composeName(
            dto.firstName ?? currentUser.firstName ?? undefined,
            dto.lastName ?? currentUser.lastName ?? undefined,
            currentUser.email,
          )
        : currentUser.name;

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(nextName !== currentUser.name && { name: nextName }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
      },
      include: {
        userCompanies: {
          select: {
            companyId: true,
            role: true,
          },
        },
      },
    });

    return this.toUserResponse(updatedUser);
  }

  async updateMyAvatar(userId: string, tenantId: string, avatarUrl: string) {
    const profile = await this.getMyProfile(userId, tenantId);

    return {
      ...profile,
      avatarUrl,
    };
  }

  async update(id: string, tenantId: string, dto: UpdateUserDto) {
    const currentUser = await this.findById(id, tenantId);
    const shouldUpdateRole = dto.role !== undefined;

    const nextName =
      dto.firstName !== undefined || dto.lastName !== undefined
        ? this.composeName(
            dto.firstName ?? currentUser.firstName ?? undefined,
            dto.lastName ?? currentUser.lastName ?? undefined,
            currentUser.email,
          )
        : currentUser.name;

    const updatedUser = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id },
        data: {
          ...(nextName !== currentUser.name && { name: nextName }),
          ...(dto.phone !== undefined && { phone: dto.phone }),
          ...(dto.isActive !== undefined && {
            status: dto.isActive ? 'ACTIVE' : 'INACTIVE',
            deletedAt: dto.isActive ? null : new Date(),
          }),
        },
        include: {
          userCompanies: {
            select: {
              companyId: true,
              role: true,
            },
          },
        },
      });

      if (shouldUpdateRole) {
        await tx.userCompany.updateMany({
          where: { userId: id, tenantId },
          data: { role: this.mapRole(dto.role) },
        });

        user.userCompanies = user.userCompanies.map((assignment) => ({
          ...assignment,
          role: this.mapRole(dto.role),
        }));
      }

      return user;
    });

    if (dto.role !== undefined || dto.isActive !== undefined) {
      await this.clearUserAuthCache(id);
    }

    return this.toUserResponse(updatedUser);
  }

  async softDelete(id: string, tenantId: string) {
    await this.findById(id, tenantId);

    const user = await this.prisma.user.update({
      where: { id },
      data: { status: 'INACTIVE', deletedAt: new Date() },
      include: {
        userCompanies: {
          select: {
            companyId: true,
            role: true,
          },
        },
      },
    });

    await this.clearUserAuthCache(id);
    return this.toUserResponse(user);
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
    if (!token) {
      throw new NotFoundException('Session not found');
    }

    await this.prisma.refreshToken.update({
      where: { id: tokenId },
      data: { revokedAt: new Date() },
    });

    return { message: 'Session revoked' };
  }

  async getCompanyAccess(userId: string, actor: AccessActor) {
    await this.findScopedUser(userId, actor);

    const where: Prisma.UserCompanyWhereInput =
      actor.role === 'SUPER_ADMIN'
        ? { userId }
        : { userId, tenantId: this.requireActorTenantId(actor) };

    return this.prisma.userCompany.findMany({
      where,
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

    const assignment = await this.prisma.userCompany.upsert({
      where: { userId_companyId: { userId, companyId } },
      update: {},
      create: {
        tenantId: company.tenantId,
        userId,
        companyId,
        role: 'VIEWER',
      },
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

    const result = await this.prisma.userCompany.deleteMany({
      where: { userId, companyId },
    });

    await this.clearCompanyAccessCache(userId, companyId);
    return result;
  }

  private composeName(
    firstName: string | undefined,
    lastName: string | undefined,
    email: string,
  ): string {
    const full = [firstName?.trim(), lastName?.trim()].filter(Boolean).join(' ');
    if (full) {
      return full;
    }

    const [localPart] = email.split('@');
    return localPart || 'User';
  }

  private splitName(name: string): { firstName: string | null; lastName: string | null } {
    const trimmed = name.trim();
    if (!trimmed) {
      return { firstName: null, lastName: null };
    }

    const [first, ...rest] = trimmed.split(/\s+/);
    return {
      firstName: first || null,
      lastName: rest.length ? rest.join(' ') : null,
    };
  }

  private roleRank(role: UserRole): number {
    const order: Record<UserRole, number> = {
      OWNER: 5,
      ADMIN: 4,
      MANAGER: 3,
      ACCOUNTANT: 2,
      VIEWER: 1,
    };

    return order[role];
  }

  private resolveEffectiveRole(accessRows: Array<{ role: UserRole }> = []): UserRole | null {
    if (!accessRows.length) {
      return null;
    }

    return accessRows
      .map((row) => row.role)
      .sort((a, b) => this.roleRank(b) - this.roleRank(a))[0];
  }

  private toUserResponse(user: UserWithAccess) {
    const split = this.splitName(user.name);
    const effectiveRole = this.resolveEffectiveRole(user.userCompanies ?? []);

    return {
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      name: user.name,
      firstName: split.firstName,
      lastName: split.lastName,
      phone: user.phone,
      role: effectiveRole,
      status: user.status,
      isActive: user.status === 'ACTIVE' && !user.deletedAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      companyAccessCount: user.userCompanies?.length ?? 0,
    };
  }

  private mapRole(rawRole?: string): UserRole {
    switch (rawRole) {
      case 'OWNER':
        return 'OWNER';
      case 'ADMIN':
      case 'TENANT_ADMIN':
        return 'ADMIN';
      case 'ACCOUNTANT':
        return 'ACCOUNTANT';
      case 'VIEWER':
        return 'VIEWER';
      case 'MANAGER':
        return 'MANAGER';
      case 'STAFF':
      default:
        return 'MANAGER';
    }
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
    const user = await this.prisma.user.findFirst({
      where:
        actor.role === 'SUPER_ADMIN'
          ? { id: userId, deletedAt: null }
          : {
              id: userId,
              tenantId: this.requireActorTenantId(actor),
              deletedAt: null,
            },
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
    const company = await this.prisma.company.findFirst({
      where:
        actor.role === 'SUPER_ADMIN'
          ? { id: companyId, deletedAt: null }
          : {
              id: companyId,
              tenantId: this.requireActorTenantId(actor),
              deletedAt: null,
            },
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
      throw new Error('APP_URL is required to build account links.');
    }

    return baseUrl.replace(/\/+$/, '');
  }

  private buildPublicLink(path: string, query?: Record<string, string>): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(normalizedPath, `${this.resolvePublicAppUrl()}/`);

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
      }
    }

    return url.toString();
  }
}
