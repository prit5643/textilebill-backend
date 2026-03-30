import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntityStatus, Prisma, UserRole } from '@prisma/client';
import { randomUUID, createHash } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { OtpDeliveryService } from '../auth/otp-delivery.service';
import {
  parsePagination,
  createPaginatedResult,
} from '../../common/utils/pagination.util';
import {
  getTenantActiveCacheKey,
  getTenantSubscriptionCacheKey,
  getUserAuthCachePattern,
} from '../auth/auth-request-cache.util';

const PASSWORD_LINK_TTL_SECONDS = 30 * 60;
const IST_TIME_ZONE = 'Asia/Kolkata';
const IST_OFFSET_MINUTES = 330;
const ALLOWED_PLAN_DURATIONS = new Set([30, 90, 180]);

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
    private readonly otpDeliveryService: OtpDeliveryService,
  ) {}

  async getDashboardKpis() {
    const [totalTenants, activeTenants, totalUsers, totalCompanies, totalInvoices] =
      await Promise.all([
        this.prisma.tenant.count({ where: { deletedAt: null } }),
        this.prisma.tenant.count({
          where: { deletedAt: null, status: EntityStatus.ACTIVE },
        }),
        this.prisma.user.count({ where: { deletedAt: null } }),
        this.prisma.company.count({ where: { deletedAt: null } }),
        this.prisma.invoice.count({ where: { deletedAt: null } }),
      ]);

    const invoiceRevenue = await this.prisma.invoice.aggregate({
      where: { deletedAt: null },
      _sum: { totalAmount: true },
    });

    return {
      totalTenants,
      activeTenants,
      totalUsers,
      totalCompanies,
      totalInvoices,
      totalRevenue: invoiceRevenue._sum.totalAmount ?? 0,
    };
  }

  async listTenants(query: { page?: number; limit?: number; search?: string }) {
    const { skip, take, page, limit } = parsePagination(query);
    const where = query.search
      ? {
          deletedAt: null,
          OR: [
            { name: { contains: query.search, mode: 'insensitive' as const } },
            {
              companies: {
                some: {
                  name: { contains: query.search, mode: 'insensitive' as const },
                },
              },
            },
            {
              companies: {
                some: {
                  gstin: { contains: query.search, mode: 'insensitive' as const },
                },
              },
            },
          ],
        }
      : { deletedAt: null };

    const [tenants, total] = await Promise.all([
      this.prisma.tenant.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { users: true, companies: true } },
          companies: {
            where: { deletedAt: null },
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
      }),
      this.prisma.tenant.count({ where }),
    ]);

    return createPaginatedResult(tenants, total, page, limit);
  }

  async getTenant(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        users: {
          where: { deletedAt: null },
          select: {
            id: true,
            email: true,
            name: true,
            phone: true,
            status: true,
            createdAt: true,
            userCompanies: {
              select: {
                role: true,
                company: {
                  select: { id: true, name: true },
                },
              },
            },
          },
        },
        companies: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!tenant || tenant.deletedAt) {
      throw new NotFoundException('Tenant not found');
    }

    return tenant;
  }

  async createTenant(dto: {
    name: string;
    slug: string;
    gstin?: string;
    address?: string;
    city?: string;
    state?: string;
    pincode?: string;
    phone?: string;
    email: string;
    adminFirstName: string;
    adminLastName: string;
    planId?: string;
  }) {
    const requestedSlug = dto.slug.trim().toLowerCase();

    const existingSlug = await this.prisma.tenant.findUnique({
      where: { slug: requestedSlug },
      select: { id: true },
    });
    if (existingSlug) {
      throw new BadRequestException('Tenant slug already exists');
    }

    const existingName = await this.prisma.tenant.findFirst({
      where: {
        name: { equals: dto.name.trim(), mode: 'insensitive' },
        deletedAt: null,
      },
      select: { id: true },
    });
    if (existingName) {
      throw new BadRequestException('Tenant name already exists');
    }

    const fullName =
      `${dto.adminFirstName ?? ''} ${dto.adminLastName ?? ''}`.trim() ||
      'Tenant Admin';
    const passwordHash = await bcrypt.hash(randomUUID(), 12);
    const setupToken = randomUUID();
    const setupExpiry = new Date(Date.now() + PASSWORD_LINK_TTL_SECONDS * 1000);

    const result = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: dto.name.trim(),
          slug: requestedSlug,
          status: EntityStatus.ACTIVE,
        },
      });

      const company = await tx.company.create({
        data: {
          tenantId: tenant.id,
          name: dto.name.trim(),
          gstin: dto.gstin?.trim().toUpperCase() || null,
          address: dto.address?.trim() || null,
          phone: dto.phone?.trim() || null,
          email: dto.email.trim().toLowerCase(),
          status: EntityStatus.ACTIVE,
        },
      });

      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: dto.email.trim().toLowerCase(),
          passwordHash,
          name: fullName,
          phone: dto.phone?.trim() || null,
          status: EntityStatus.ACTIVE,
        },
      });

      await tx.userCompany.create({
        data: {
          tenantId: tenant.id,
          userId: user.id,
          companyId: company.id,
          role: UserRole.ADMIN,
        },
      });

      if (dto.planId) {
        const plan = await tx.plan.findUnique({ where: { id: dto.planId } });
        if (!plan) {
          throw new NotFoundException('Plan not found');
        }
        this.assertSupportedPlanDuration(plan.durationDays);

        const { startDate, endDate } = this.buildIstSubscriptionWindow(
          plan.durationDays,
        );
        await tx.subscription.create({
          data: {
            tenantId: tenant.id,
            planId: plan.id,
            startDate,
            endDate,
            amountPaid: plan.price,
            status: 'ACTIVE',
            paymentStatus: 'PAID',
          }
        });
      } else {
        // give a default 3 months trial
        let trialPlan = await tx.plan.findFirst({ where: { name: 'Free Trial' } });
        if (!trialPlan) {
          trialPlan = await tx.plan.create({
            data: {
              name: 'Free Trial',
              description: 'Default 3-month free trial',
              price: 0,
              durationDays: 90,
            }
          });
        }
        this.assertSupportedPlanDuration(trialPlan.durationDays);
        const { startDate, endDate } = this.buildIstSubscriptionWindow(
          trialPlan.durationDays,
        );
        await tx.subscription.create({
          data: {
            tenantId: tenant.id,
            planId: trialPlan.id,
            startDate,
            endDate,
            amountPaid: 0,
            status: 'ACTIVE',
            paymentStatus: 'PAID',
          }
        });
      }

      return { tenant, company, user };
    });

    await this.redisService.set(
      this.getSetupLinkKey(setupToken),
      result.user.id,
      PASSWORD_LINK_TTL_SECONDS,
    );

    const setupLink = this.buildPublicLink('/accept-invite', setupToken);
    const delivered = await this.otpDeliveryService.sendInviteEmail(
      result.user.email,
      setupLink,
      PASSWORD_LINK_TTL_SECONDS / 60,
    );

    return {
      ...result,
      passwordSetupStatus: 'PENDING_SETUP',
      passwordSetupExpiresAt: setupExpiry,
      passwordSetupDeliveryStatus: delivered ? 'QUEUED_OR_SENT' : 'FAILED',
    };
  }

  async updateTenant(
    id: string,
    dto: Partial<{
      name: string;
      gstin: string;
      address: string;
      city: string;
      state: string;
      phone: string;
      email: string;
    }>,
  ) {
    await this.getTenant(id);

    const updatedTenant = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.update({
        where: { id },
        data: {
          ...(typeof dto.name === 'string' ? { name: dto.name.trim() } : {}),
        },
      });

      const firstCompany = await tx.company.findFirst({
        where: { tenantId: id, deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });

      if (firstCompany) {
        await tx.company.update({
          where: { id: firstCompany.id },
          data: {
            ...(typeof dto.name === 'string' ? { name: dto.name.trim() } : {}),
            ...(typeof dto.gstin === 'string'
              ? { gstin: dto.gstin.trim().toUpperCase() || null }
              : {}),
            ...(typeof dto.address === 'string'
              ? { address: dto.address.trim() || null }
              : {}),
            ...(typeof dto.phone === 'string' ? { phone: dto.phone.trim() || null } : {}),
            ...(typeof dto.email === 'string'
              ? { email: dto.email.trim().toLowerCase() || null }
              : {}),
          },
        });
      }

      return tenant;
    });

    await this.clearTenantUsersCaches(id);
    return updatedTenant;
  }

  async toggleTenant(id: string, isActive: boolean) {
    await this.getTenant(id);

    const tenant = await this.prisma.tenant.update({
      where: { id },
      data: {
        status: isActive ? EntityStatus.ACTIVE : EntityStatus.INACTIVE,
        deletedAt: isActive ? null : new Date(),
      },
    });

    await this.clearTenantUsersCaches(id);
    return tenant;
  }

  async deleteTenant(id: string) {
    await this.getTenant(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.updateMany({
        where: { tenantId: id, deletedAt: null },
        data: {
          status: EntityStatus.INACTIVE,
          deletedAt: new Date(),
        },
      });

      await tx.company.updateMany({
        where: { tenantId: id, deletedAt: null },
        data: {
          status: EntityStatus.INACTIVE,
          deletedAt: new Date(),
        },
      });

      await tx.tenant.update({
        where: { id },
        data: {
          status: EntityStatus.INACTIVE,
          deletedAt: new Date(),
        },
      });
    });

    await this.clearTenantUsersCaches(id);
    return;
  }

  async listPlans() {
    return this.prisma.plan.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createPlan(dto: {
    name: string;
    displayName: string;
    durationDays: number;
    price: number;
    currency?: string;
    maxUsers?: number;
    maxCompanies?: number;
  }) {
    this.assertSupportedPlanDuration(dto.durationDays);
    return this.prisma.plan.create({
      data: {
        name: dto.name,
        description: dto.displayName,
        durationDays: dto.durationDays,
        price: dto.price,
        maxUsers: dto.maxUsers ?? 0,
        maxCompanies: dto.maxCompanies ?? 0,
      }
    });
  }

  async updatePlan(id: string, dto: Record<string, any>) {
    if (dto.durationDays !== undefined) {
      this.assertSupportedPlanDuration(dto.durationDays);
    }

    return this.prisma.plan.update({
      where: { id },
      data: dto
    });
  }

  async togglePlan(id: string, status: boolean) {
    return this.prisma.plan.update({
      where: { id },
      data: {
        status: status ? 'ACTIVE' : 'INACTIVE',
        deletedAt: status ? null : new Date()
      }
    });
  }

  async deletePlan(id: string) {
    return this.prisma.plan.update({
      where: { id },
      data: {
        status: 'INACTIVE',
        deletedAt: new Date()
      }
    });
  }

  async assignSubscription(dto: { gstin: string; planId: string; amount?: number }) {
    const gstin = dto.gstin.trim().toUpperCase();

    // find tenant by gstin
    const company = await this.prisma.company.findFirst({
      where: { gstin, deletedAt: null, status: EntityStatus.ACTIVE },
      select: { tenantId: true },
    });
    if (!company) throw new NotFoundException('Company not found with given GSTIN');
    
    const plan = await this.prisma.plan.findUnique({ where: { id: dto.planId } });
    if (!plan) throw new NotFoundException('Plan not found');
    this.assertSupportedPlanDuration(plan.durationDays);

    const created = await this.prisma.$transaction(
      async (tx) => {
        const now = new Date();
        const activeSubscription = await tx.subscription.findFirst({
          where: {
            tenantId: company.tenantId,
            deletedAt: null,
            status: 'ACTIVE',
            endDate: { gte: now },
          },
          orderBy: { endDate: 'desc' },
          select: { endDate: true },
        });

        const anchorDate =
          activeSubscription?.endDate && activeSubscription.endDate > now
            ? new Date(activeSubscription.endDate.getTime() + 1000)
            : now;

        const { startDate, endDate } = this.buildIstSubscriptionWindow(
          plan.durationDays,
          anchorDate,
        );

        await tx.subscription.updateMany({
          where: {
            tenantId: company.tenantId,
            deletedAt: null,
            status: 'ACTIVE',
          },
          data: { status: 'EXPIRED' },
        });

        return tx.subscription.create({
          data: {
            tenantId: company.tenantId,
            planId: plan.id,
            startDate,
            endDate,
            amountPaid: dto.amount ?? plan.price,
            status: 'ACTIVE',
            paymentStatus: 'PAID',
          },
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    await this.redisService.del(getTenantSubscriptionCacheKey(company.tenantId));
    return created;
  }

  async listSubscriptions(query: { page?: number; limit?: number; status?: string }) {
    const { skip, take, page, limit } = parsePagination(query);
    const where: any = {};
    if (query.status) {
      where.status = query.status;
    }
    const [data, total] = await Promise.all([
      this.prisma.subscription.findMany({
        where, skip, take, include: { plan: true, tenant: { select: { id: true, name: true } } }
      }),
      this.prisma.subscription.count({ where })
    ]);
    return createPaginatedResult(data, total, page, limit);
  }

  async updateSubscription(
    id: string,
    dto: {
      planId?: string;
      amount?: number;
      status?: 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'PENDING';
      endDate?: string;
      extendDays?: number;
    },
  ) {
    const sub = await this.prisma.subscription.findUnique({ where: { id } });
    if (!sub) throw new NotFoundException('Subscription not found');

    if (dto.endDate !== undefined && dto.extendDays !== undefined) {
      throw new BadRequestException(
        'Provide either endDate or extendDays, not both.',
      );
    }

    const data: any = {};
    if (dto.planId) data.planId = dto.planId;
    if (dto.amount !== undefined && dto.amount < 0) {
      throw new BadRequestException('amount cannot be negative');
    }
    if (dto.amount !== undefined) data.amountPaid = dto.amount;
    if (dto.status) data.status = dto.status;

    if (dto.endDate !== undefined) {
      const parsed = new Date(dto.endDate);
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException('Invalid endDate format');
      }
      data.endDate = this.toIstEndOfDayUtc(parsed);
    } else if (dto.extendDays !== undefined) {
      if (dto.extendDays <= 0) {
        throw new BadRequestException('extendDays must be greater than 0');
      }
      const now = new Date();
      const anchor =
        sub.endDate > now ? new Date(sub.endDate.getTime() + 1000) : now;
      data.endDate = this.buildIstSubscriptionWindow(
        dto.extendDays,
        anchor,
      ).endDate;
    }

    const effectiveStatus = (data.status ?? sub.status) as
      | 'ACTIVE'
      | 'EXPIRED'
      | 'CANCELLED'
      | 'PENDING';
    const effectiveEndDate = (data.endDate ?? sub.endDate) as Date;

    if (effectiveStatus === 'ACTIVE' && effectiveEndDate < new Date()) {
      throw new BadRequestException(
        'Active subscription must have a future endDate',
      );
    }

    const updated = await this.prisma.$transaction(
      async (tx) => {
        if (effectiveStatus === 'ACTIVE') {
          await tx.subscription.updateMany({
            where: {
              tenantId: sub.tenantId,
              deletedAt: null,
              status: 'ACTIVE',
              NOT: { id: sub.id },
            },
            data: { status: 'EXPIRED' },
          });
        }

        return tx.subscription.update({
          where: { id },
          data,
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    await this.redisService.del(getTenantSubscriptionCacheKey(sub.tenantId));
    return updated;
  }

  async listAllUsers(query: {
    page?: number;
    limit?: number;
    search?: string;
    tenantId?: string;
  }) {
    const { skip, take, page, limit } = parsePagination(query);
    const where = {
      deletedAt: null,
      ...(query.tenantId ? { tenantId: query.tenantId } : {}),
      ...(query.search
        ? {
            OR: [
              { email: { contains: query.search, mode: 'insensitive' as const } },
              { name: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          tenantId: true,
          email: true,
          name: true,
          phone: true,
          status: true,
          createdAt: true,
          tenant: {
            select: { id: true, name: true, status: true },
          },
          userCompanies: {
            select: {
              role: true,
              company: {
                select: { id: true, name: true },
              },
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return createPaginatedResult(
      users.map((user) => ({
        ...user,
        role: this.toLegacyRole(this.getHighestRole(user.userCompanies)),
      })),
      total,
      page,
      limit,
    );
  }

  async toggleUser(id: string, isActive: boolean) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        status: isActive ? EntityStatus.ACTIVE : EntityStatus.INACTIVE,
        deletedAt: isActive ? null : new Date(),
      },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
      },
    });

    await this.clearUserAuthCache(id);
    return updated;
  }

  async updateUser(
    id: string,
    dto: {
      firstName?: string;
      lastName?: string;
      email?: string;
      role?: 'TENANT_ADMIN' | 'MANAGER' | 'STAFF' | 'ACCOUNTANT' | 'VIEWER';
    },
  ) {
    const existing = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true },
    });

    if (!existing) {
      throw new NotFoundException('User not found');
    }

    const patch: { name?: string; email?: string } = {};
    if (dto.firstName !== undefined || dto.lastName !== undefined) {
      const name = `${dto.firstName ?? ''} ${dto.lastName ?? ''}`.trim();
      if (name) {
        patch.name = name;
      }
    }

    if (dto.email !== undefined) {
      patch.email = dto.email.trim().toLowerCase();
    }

    if (Object.keys(patch).length > 0) {
      await this.prisma.user.update({
        where: { id },
        data: patch,
      });
    }

    if (dto.role) {
      await this.prisma.userCompany.updateMany({
        where: { userId: id },
        data: { role: this.fromLegacyRole(dto.role) },
      });
    }

    await this.clearUserAuthCache(id);

    return this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        userCompanies: {
          select: {
            role: true,
            company: { select: { id: true, name: true } },
          },
        },
      },
    });
  }

  async resendSetupLinkByAdmin(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null, status: EntityStatus.ACTIVE },
      select: { id: true, email: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const token = randomUUID();
    await this.redisService.set(
      this.getSetupLinkKey(token),
      user.id,
      PASSWORD_LINK_TTL_SECONDS,
    );

    const setupLink = this.buildPublicLink('/accept-invite', token);
    const delivered = await this.otpDeliveryService.sendInviteEmail(
      user.email,
      setupLink,
      PASSWORD_LINK_TTL_SECONDS / 60,
    );

    if (!delivered) {
      await this.redisService.del(this.getSetupLinkKey(token));
      throw new ServiceUnavailableException(
        'We could not send the setup email right now. Please try again shortly.',
      );
    }

    return {
      message: 'Password setup link sent',
      email: user.email,
      expiresAt: new Date(Date.now() + PASSWORD_LINK_TTL_SECONDS * 1000),
    };
  }

  async sendPasswordResetLinkByAdmin(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null, status: EntityStatus.ACTIVE },
      select: { id: true, email: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
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
        'We could not send the password reset email right now. Please try again shortly.',
      );
    }

    return {
      message: 'Password reset link sent',
      email: user.email,
      expiresAt: new Date(Date.now() + PASSWORD_LINK_TTL_SECONDS * 1000),
    };
  }

  async getAuditLogs(query: {
    page?: number;
    limit?: number;
    companyId?: string;
    userId?: string;
    entity?: string;
  }) {
    const { page, limit } = parsePagination(query);
    return createPaginatedResult([], 0, page, limit);
  }

  async getModulePermissions(_companyId: string) {
    return [];
  }

  async upsertModulePermission(_data: {
    companyId: string;
    role: string;
    module: string;
    canEntry?: boolean;
    canEdit?: boolean;
    canDelete?: boolean;
    canList?: boolean;
    canPayment?: boolean;
    canReminder?: boolean;
  }) {
    throw new BadRequestException(
      'Module permissions are deprecated because ModulePermission model was removed from schema v2.',
    );
  }

  private async clearTenantUsersCaches(tenantId: string) {
    await this.redisService.del(getTenantActiveCacheKey(tenantId));
    await this.redisService.del(getTenantSubscriptionCacheKey(tenantId));

    const users = await this.prisma.user.findMany({
      where: { tenantId },
      select: { id: true },
    });

    for (const user of users) {
      await this.clearUserAuthCache(user.id);
    }
  }

  private async clearUserAuthCache(userId: string) {
    const keys = await this.redisService.keys(getUserAuthCachePattern(userId));
    for (const key of keys) {
      await this.redisService.del(key);
    }
  }

  private fromLegacyRole(
    role: 'TENANT_ADMIN' | 'MANAGER' | 'STAFF' | 'ACCOUNTANT' | 'VIEWER',
  ): UserRole {
    switch (role) {
      case 'TENANT_ADMIN':
        return UserRole.ADMIN;
      case 'MANAGER':
        return UserRole.MANAGER;
      case 'ACCOUNTANT':
        return UserRole.ACCOUNTANT;
      case 'STAFF':
      case 'VIEWER':
      default:
        return UserRole.VIEWER;
    }
  }

  private getHighestRole(rows: Array<{ role: UserRole }>) {
    const rank: Record<UserRole, number> = {
      OWNER: 5,
      ADMIN: 4,
      MANAGER: 3,
      ACCOUNTANT: 2,
      VIEWER: 1,
    };

    return [...rows]
      .map((row) => row.role)
      .sort((a, b) => rank[b] - rank[a])[0] ?? UserRole.VIEWER;
  }

  private toLegacyRole(role: UserRole): string {
    switch (role) {
      case UserRole.OWNER:
        return 'SUPER_ADMIN';
      case UserRole.ADMIN:
        return 'TENANT_ADMIN';
      case UserRole.MANAGER:
        return 'MANAGER';
      case UserRole.ACCOUNTANT:
        return 'ACCOUNTANT';
      case UserRole.VIEWER:
      default:
        return 'VIEWER';
    }
  }

  private getPasswordResetLinkKey(token: string) {
    return `auth:reset-link:${this.hashOpaqueToken(token)}`;
  }

  private getSetupLinkKey(token: string) {
    return `auth:setup-link:${this.hashOpaqueToken(token)}`;
  }

  private hashOpaqueToken(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private resolvePublicAppUrl(): string {
    const appUrl = this.configService.get<string>('app.url')?.trim();
    if (!appUrl) {
      throw new Error('APP_URL is required to build public links.');
    }
    return appUrl.replace(/\/+$/, '');
  }

  private buildPublicLink(path: '/accept-invite' | '/reset-password', token: string) {
    const url = new URL(path, `${this.resolvePublicAppUrl()}/`);
    url.searchParams.set('token', token);
    return url.toString();
  }

  private assertSupportedPlanDuration(durationDays: number) {
    const normalized = Math.trunc(Number(durationDays));
    if (!Number.isFinite(normalized) || !ALLOWED_PLAN_DURATIONS.has(normalized)) {
      throw new BadRequestException(
        'Plan duration must be one of 30, 90, or 180 days.',
      );
    }
  }

  private buildIstSubscriptionWindow(durationDays: number, anchor = new Date()) {
    const safeDuration = Math.max(1, Math.floor(durationDays || 1));
    const startDate = new Date(anchor);
    const endDate = this.toIstEndOfDayUtc(
      this.addIstCalendarDays(startDate, safeDuration - 1),
    );

    return { startDate, endDate };
  }

  private addIstCalendarDays(date: Date, days: number) {
    const istStart = this.toIstStartOfDayUtc(date);
    return new Date(istStart.getTime() + days * 24 * 60 * 60 * 1000);
  }

  private toIstEndOfDayUtc(date: Date) {
    const istStart = this.toIstStartOfDayUtc(date);
    return new Date(istStart.getTime() + 24 * 60 * 60 * 1000 - 1);
  }

  private toIstStartOfDayUtc(date: Date) {
    const formatted = new Intl.DateTimeFormat('en-CA', {
      timeZone: IST_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);

    const [year, month, day] = formatted.split('-').map((value) => Number(value));
    return new Date(
      Date.UTC(year, month - 1, day, 0, 0, 0, 0) -
        IST_OFFSET_MINUTES * 60 * 1000,
    );
  }
}
