import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'crypto';
import { Prisma, UserRole } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { OtpDeliveryService } from '../auth/otp-delivery.service';
import {
  CreateUserDto,
  UpdateMyProfileDto,
  UpdatePagePermissionsDto,
  UpdateUserDto,
} from './dto';
import {
  parsePagination,
  createPaginatedResult,
} from '../../common/utils/pagination.util';
import { getUserAuthCachePattern } from '../auth/auth-request-cache.util';
import {
  PagePermissionMap,
  normalizePagePermissions,
} from '../../common/constants/page-permissions';

const PASSWORD_SETUP_LINK_EXPIRY_MINUTES = 30;
const PASSWORD_SETUP_LINK_EXPIRY_SECONDS =
  PASSWORD_SETUP_LINK_EXPIRY_MINUTES * 60;

type AccessActor = {
  role: string;
  tenantId?: string;
};

type UserCompanyPermissionRow = {
  role: UserRole;
  pagePermissions: unknown;
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

  async create(tenantId: string, dto: CreateUserDto, actorRole?: string) {
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
      throw new ConflictException(
        'User with this email already exists in tenant',
      );
    }
    const planLimits = await this.getTenantPlanLimits(tenantId);
    const activeUsersCount = await this.prisma.user.count({
      where: { tenantId, deletedAt: null, status: 'ACTIVE' },
    });
    if (
      planLimits.maxUsers !== null &&
      activeUsersCount >= planLimits.maxUsers
    ) {
      throw new BadRequestException(
        `User limit reached. Maximum ${planLimits.maxUsers} active users are allowed in your plan.`,
      );
    }
    if (
      planLimits.maxCompanies !== null &&
      (dto.companyIds?.length ?? 0) > planLimits.maxCompanies
    ) {
      throw new BadRequestException(
        `Company access limit reached. Maximum ${planLimits.maxCompanies} companies are allowed per user as per plan.`,
      );
    }

    const rawPassword = dto.password ?? randomUUID().replace(/-/g, '');
    const passwordHash = await bcrypt.hash(rawPassword, 12);
    const displayName = this.composeName(
      dto.firstName,
      dto.lastName,
      normalizedEmail,
    );
    const mappedRole = this.mapRole(dto.role);
    if (actorRole === 'TENANT_ADMIN' && mappedRole === UserRole.TENANT_ADMIN) {
      throw new ForbiddenException(
        'Tenant admin can only create MANAGER, ACCOUNTANT, or VIEWER users.',
      );
    }
    if (mappedRole === UserRole.TENANT_ADMIN) {
      await this.assertNoOtherTenantAdmin(tenantId);
    }

    const createdUser = await this.prisma
      .$transaction(async (tx) => {
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

        const requestedCompanyIds = dto.companyIds?.length
          ? Array.from(new Set(dto.companyIds))
          : [];

        const assignmentCompanyIds =
          mappedRole === UserRole.TENANT_ADMIN && requestedCompanyIds.length === 0
            ? (
                await tx.company.findMany({
                  where: {
                    tenantId,
                    deletedAt: null,
                    status: 'ACTIVE',
                  },
                  select: { id: true },
                })
              ).map((row) => row.id)
            : requestedCompanyIds;

        if (assignmentCompanyIds.length) {
          if (
            planLimits.maxCompanies !== null &&
            assignmentCompanyIds.length > planLimits.maxCompanies
          ) {
            throw new BadRequestException(
              `Company access limit reached. Maximum ${planLimits.maxCompanies} companies are allowed per user as per plan.`,
            );
          }
          const validCompanies = await tx.company.findMany({
            where: {
              tenantId,
              deletedAt: null,
              status: 'ACTIVE',
              id: { in: assignmentCompanyIds },
            },
            select: { id: true },
          });

          if (validCompanies.length !== assignmentCompanyIds.length) {
            throw new BadRequestException(
              'One or more companyIds are invalid for this tenant',
            );
          }

          await tx.userCompany.createMany({
            data: assignmentCompanyIds.map((companyId) => ({
              tenantId,
              userId: user.id,
              companyId,
              role: mappedRole,
            })),
            skipDuplicates: true,
          });

          user.userCompanies = assignmentCompanyIds.map((companyId) => ({
            companyId,
            role: mappedRole,
          }));
        }

        return user;
      })
      .catch((error: unknown) => {
        if (this.isUniqueConstraintError(error)) {
          throw new ConflictException(
            'User with this email already exists in tenant',
          );
        }

        throw error;
      });

    const setupToken = randomUUID();
    await this.redisService.set(
      this.getSetupLinkKey(setupToken),
      createdUser.id,
      PASSWORD_SETUP_LINK_EXPIRY_SECONDS,
    );
    await this.redisService.set(
      this.getUserPasswordSetupStateKey(createdUser.id),
      setupToken,
      PASSWORD_SETUP_LINK_EXPIRY_SECONDS,
    );

    const setupLink = this.buildPublicLink('/accept-invite', {
      token: setupToken,
    });

    this.otpDeliveryService
      .sendInviteEmail(
        normalizedEmail,
        setupLink,
        PASSWORD_SETUP_LINK_EXPIRY_MINUTES,
      )
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
      passwordSetupExpiresAt: new Date(
        Date.now() + PASSWORD_SETUP_LINK_EXPIRY_SECONDS * 1000,
      ),
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

    const setupToken = randomUUID();
    await this.redisService.set(
      this.getSetupLinkKey(setupToken),
      user.id,
      PASSWORD_SETUP_LINK_EXPIRY_SECONDS,
    );
    await this.redisService.set(
      this.getUserPasswordSetupStateKey(user.id),
      setupToken,
      PASSWORD_SETUP_LINK_EXPIRY_SECONDS,
    );

    const setupLink = this.buildPublicLink('/accept-invite', {
      token: setupToken,
    });

    this.otpDeliveryService
      .sendInviteEmail(
        user.email,
        setupLink,
        PASSWORD_SETUP_LINK_EXPIRY_MINUTES,
      )
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
      expiresAt: new Date(
        Date.now() + PASSWORD_SETUP_LINK_EXPIRY_SECONDS * 1000,
      ),
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

  async update(
    id: string,
    tenantId: string,
    dto: UpdateUserDto,
    actorRole?: string,
  ) {
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
        const nextRole = this.mapRole(dto.role);
        if (actorRole === 'TENANT_ADMIN' && nextRole === UserRole.TENANT_ADMIN) {
          throw new ForbiddenException(
            'Tenant admin can only assign MANAGER, ACCOUNTANT, or VIEWER roles.',
          );
        }
        if (nextRole === UserRole.TENANT_ADMIN) {
          await this.assertNoOtherTenantAdmin(tenantId, id);
        }

        await tx.userCompany.updateMany({
          where: { userId: id, tenantId },
          data: { role: nextRole },
        });

        user.userCompanies = user.userCompanies.map((assignment) => ({
          ...assignment,
          role: nextRole,
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

    const user = await this.prisma.$transaction(async (tx) => {
      const deletedUser = await tx.user.update({
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

      await tx.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      return deletedUser;
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

  async getPagePermissions(
    userId: string,
    companyId: string,
    actor: AccessActor,
  ): Promise<PagePermissionMap> {
    await Promise.all([
      this.findScopedUser(userId, actor),
      this.findScopedCompany(companyId, actor),
    ]);

    const assignment = await this.getUserCompanyPermissionRecord(
      userId,
      companyId,
      actor.role === 'SUPER_ADMIN' ? undefined : this.requireActorTenantId(actor),
    );
    if (!assignment) {
      throw new NotFoundException(
        'User does not have company access for this company.',
      );
    }

    return normalizePagePermissions(assignment.pagePermissions, assignment.role);
  }

  async updatePagePermissions(
    userId: string,
    companyId: string,
    dto: UpdatePagePermissionsDto,
    actor: AccessActor,
  ): Promise<PagePermissionMap> {
    await Promise.all([
      this.findScopedUser(userId, actor),
      this.findScopedCompany(companyId, actor),
    ]);

    const assignment = await this.getUserCompanyPermissionRecord(
      userId,
      companyId,
      actor.role === 'SUPER_ADMIN' ? undefined : this.requireActorTenantId(actor),
    );
    if (!assignment) {
      throw new NotFoundException(
        'User does not have company access for this company.',
      );
    }

    const normalized = normalizePagePermissions(dto.permissions, assignment.role);
    const normalizedJson = JSON.stringify(normalized);

    if (actor.role === 'SUPER_ADMIN') {
      await this.prisma.$executeRawUnsafe(
        'UPDATE "UserCompany" SET "pagePermissions" = $1::jsonb WHERE "userId" = $2 AND "companyId" = $3',
        normalizedJson,
        userId,
        companyId,
      );
    } else {
      await this.prisma.$executeRawUnsafe(
        'UPDATE "UserCompany" SET "pagePermissions" = $1::jsonb WHERE "userId" = $2 AND "companyId" = $3 AND "tenantId" = $4',
        normalizedJson,
        userId,
        companyId,
        this.requireActorTenantId(actor),
      );
    }

    await this.clearCompanyAccessCache(userId, companyId);
    await this.clearUserAuthCache(userId);
    return normalized;
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
    const existingAssignment = await this.prisma.userCompany.findUnique({
      where: { userId_companyId: { userId, companyId } },
      select: { userId: true },
    });
    const planLimits = await this.getTenantPlanLimits(company.tenantId);
    const existingAssignments = await this.prisma.userCompany.count({
      where: { userId, tenantId: company.tenantId },
    });
    if (
      !existingAssignment &&
      planLimits.maxCompanies !== null &&
      existingAssignments >= planLimits.maxCompanies
    ) {
      throw new BadRequestException(
        `Company access limit reached. Maximum ${planLimits.maxCompanies} companies are allowed per user as per plan.`,
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
    const full = [firstName?.trim(), lastName?.trim()]
      .filter(Boolean)
      .join(' ');
    if (full) {
      return full;
    }

    const [localPart] = email.split('@');
    return localPart || 'User';
  }

  private splitName(name: string): {
    firstName: string | null;
    lastName: string | null;
  } {
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
      SUPER_ADMIN: 5,
      TENANT_ADMIN: 4,
      MANAGER: 3,
      ACCOUNTANT: 2,
      VIEWER: 1,
    };

    return order[role];
  }

  private resolveEffectiveRole(
    accessRows: Array<{ role: UserRole }> = [],
  ): UserRole | null {
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
      case 'SUPER_ADMIN':
        return 'SUPER_ADMIN';
      case 'TENANT_ADMIN':
        return 'TENANT_ADMIN';
      case 'ACCOUNTANT':
        return 'ACCOUNTANT';
      case 'VIEWER':
        return 'VIEWER';
      case 'MANAGER':
        return 'MANAGER';
      default:
        return 'MANAGER';
    }
  }

  private async assertNoOtherTenantAdmin(
    tenantId: string,
    excludingUserId?: string,
  ) {
    const existingAdmin = await this.prisma.userCompany.findFirst({
      where: {
        tenantId,
        role: UserRole.TENANT_ADMIN,
        user: {
          deletedAt: null,
          status: 'ACTIVE',
          ...(excludingUserId ? { id: { not: excludingUserId } } : {}),
        },
      },
      select: { id: true },
    });

    if (existingAdmin) {
      throw new ConflictException(
        'This tenant already has a tenant admin. Only one tenant admin is allowed.',
      );
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

  private async getUserCompanyPermissionRecord(
    userId: string,
    companyId: string,
    tenantId?: string,
  ): Promise<UserCompanyPermissionRow | null> {
    const rows = tenantId
      ? await this.prisma.$queryRaw<Array<UserCompanyPermissionRow>>(
          Prisma.sql`SELECT "role", "pagePermissions" FROM "UserCompany" WHERE "userId" = ${userId} AND "companyId" = ${companyId} AND "tenantId" = ${tenantId} LIMIT 1`,
        )
      : await this.prisma.$queryRaw<Array<UserCompanyPermissionRow>>(
          Prisma.sql`SELECT "role", "pagePermissions" FROM "UserCompany" WHERE "userId" = ${userId} AND "companyId" = ${companyId} LIMIT 1`,
        );

    if (!rows.length) {
      return null;
    }

    return rows[0];
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

  private async getTenantPlanLimits(tenantId: string): Promise<{
    maxUsers: number | null;
    maxCompanies: number | null;
  }> {
    const activeSubscription = await this.prisma.subscription.findFirst({
      where: {
        tenantId,
        deletedAt: null,
        status: 'ACTIVE',
        endDate: { gte: new Date() },
      },
      orderBy: { endDate: 'desc' },
      include: {
        plan: {
          select: {
            maxUsers: true,
            maxCompanies: true,
          },
        },
      },
    });

    if (!activeSubscription?.plan) {
      throw new BadRequestException(
        'No active subscription plan found. Please ask Super Admin to assign and activate a plan.',
      );
    }

    return {
      maxUsers:
        activeSubscription.plan.maxUsers > 0
          ? activeSubscription.plan.maxUsers
          : null,
      maxCompanies:
        activeSubscription.plan.maxCompanies > 0
          ? activeSubscription.plan.maxCompanies
          : null,
    };
  }

  private resolvePublicAppUrl(): string {
    const appUrl = this.configService.get<string>('app.url');
    const baseUrl = appUrl
      ?.split(',')
      .map((value) => value.trim())
      .find((value) => value.length > 0);

    if (!baseUrl) {
      throw new Error('APP_URL is required to build account links.');
    }

    return baseUrl.replace(/\/+$/, '');
  }

  private buildPublicLink(
    path: string,
    query?: Record<string, string>,
  ): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(normalizedPath, `${this.resolvePublicAppUrl()}/`);

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
      }
    }

    return url.toString();
  }

  private getSetupLinkKey(token: string) {
    return `auth:setup-link:${this.hashOpaqueToken(token)}`;
  }

  private getUserPasswordSetupStateKey(userId: string) {
    return `auth:setup-link:user:${userId}`;
  }

  private hashOpaqueToken(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }
}
