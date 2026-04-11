import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EntityStatus,
  Prisma,
  SubscriptionStatus,
  UserRole,
} from '@prisma/client';
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

  private isMissingCompanyLocationColumnError(error: unknown): boolean {
    const prismaError = error as { code?: string; meta?: { column?: unknown } };
    if (prismaError?.code !== 'P2022') {
      return false;
    }

    const column = String(prismaError?.meta?.column ?? '').toLowerCase();
    return column.includes('city') || column.includes('state');
  }

  private buildTenantCompanySelect(includeLocationFields: boolean) {
    return {
      id: true,
      name: true,
      gstin: true,
      address: true,
      pincode: true,
      phone: true,
      email: true,
      status: true,
      ...(includeLocationFields
        ? {
            city: true,
            state: true,
          }
        : {}),
    } satisfies Prisma.CompanySelect;
  }

  private async listTenantsRaw(
    where: Prisma.TenantWhereInput,
    skip: number,
    take: number,
    includeLocationFields: boolean,
  ) {
    return this.prisma.tenant.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { users: true, companies: true } },
        companies: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          select: this.buildTenantCompanySelect(includeLocationFields),
        },
      },
    });
  }

  private async getTenantRaw(id: string, includeLocationFields: boolean) {
    return this.prisma.tenant.findUnique({
      where: { id },
      include: {
        users: {
          where: {
            deletedAt: null,
            userCompanies: {
              some: {},
            },
            NOT: {
              userCompanies: {
                some: {
                  role: UserRole.OWNER,
                },
              },
            },
          },
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
          select: {
            id: true,
            tenantId: true,
            name: true,
            gstin: true,
            address: true,
            pincode: true,
            phone: true,
            email: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            deletedAt: true,
            ...(includeLocationFields
              ? {
                  city: true,
                  state: true,
                }
              : {}),
          },
        },
      },
    });
  }

  async getDashboardKpis() {
    const now = new Date();
    const next30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const [
      totalTenants,
      activeTenants,
      totalUsers,
      totalCompanies,
      totalInvoices,
      activeSubscriptions,
      expiringSubscriptions,
      subscriptionRevenue,
    ] = await Promise.all([
      this.prisma.tenant.count({ where: { deletedAt: null } }),
      this.prisma.tenant.count({
        where: { deletedAt: null, status: EntityStatus.ACTIVE },
      }),
      this.prisma.user.count({
        where: {
          deletedAt: null,
          userCompanies: {
            some: {},
          },
          NOT: {
            userCompanies: {
              some: {
                role: UserRole.OWNER,
              },
            },
          },
        },
      }),
      this.prisma.company.count({ where: { deletedAt: null } }),
      this.prisma.invoice.count({ where: { deletedAt: null } }),
      this.prisma.subscription.count({
        where: {
          deletedAt: null,
          status: SubscriptionStatus.ACTIVE,
          endDate: { gte: now },
        },
      }),
      this.prisma.subscription.count({
        where: {
          deletedAt: null,
          status: SubscriptionStatus.ACTIVE,
          endDate: {
            gte: now,
            lte: next30Days,
          },
        },
      }),
      this.prisma.subscription.aggregate({
        where: {
          deletedAt: null,
          paymentStatus: 'PAID',
        },
        _sum: { amountPaid: true },
      }),
    ]);

    return {
      totalTenants,
      activeTenants,
      totalUsers,
      totalCompanies,
      totalInvoices,
      activeSubscriptions,
      expiringSubscriptions,
      totalRevenue: Number(subscriptionRevenue._sum.amountPaid ?? 0),
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
                  name: {
                    contains: query.search,
                    mode: 'insensitive' as const,
                  },
                },
              },
            },
            {
              companies: {
                some: {
                  gstin: {
                    contains: query.search,
                    mode: 'insensitive' as const,
                  },
                },
              },
            },
          ],
        }
      : { deletedAt: null };

    const tenantsPromise = this.listTenantsRaw(where, skip, take, true).catch(
      async (error) => {
        if (!this.isMissingCompanyLocationColumnError(error)) {
          throw error;
        }

        this.logger.warn(
          'Tenant list fallback: missing company city/state columns in DB. Retrying without those fields.',
        );
        return this.listTenantsRaw(where, skip, take, false);
      },
    );

    const [tenants, total] = await Promise.all([
      tenantsPromise,
      this.prisma.tenant.count({ where }),
    ]);

    const tenantIds = tenants.map((tenant) => tenant.id);
    const tenantUserCounts =
      tenantIds.length > 0
        ? await this.prisma.user.groupBy({
            by: ['tenantId'],
            where: {
              tenantId: { in: tenantIds },
              deletedAt: null,
              userCompanies: {
                some: {},
              },
              NOT: {
                userCompanies: {
                  some: {
                    role: UserRole.OWNER,
                  },
                },
              },
            },
            _count: {
              _all: true,
            },
          })
        : [];

    const tenantUserCountMap = new Map(
      tenantUserCounts.map((entry) => [entry.tenantId, entry._count._all]),
    );

    const sanitizedTenants = tenants.map((tenant) => {
      const primaryCompany = tenant.companies?.[0];

      return {
        ...tenant,
        gstin: primaryCompany?.gstin ?? null,
        address: primaryCompany?.address ?? null,
        city: primaryCompany?.city ?? null,
        state: primaryCompany?.state ?? null,
        pincode: primaryCompany?.pincode ?? null,
        phone: primaryCompany?.phone ?? null,
        email: primaryCompany?.email ?? null,
        isActive: tenant.status === EntityStatus.ACTIVE,
        _count: {
          ...tenant._count,
          users: tenantUserCountMap.get(tenant.id) ?? 0,
        },
      };
    });

    return createPaginatedResult(sanitizedTenants, total, page, limit);
  }

  async getTenant(id: string) {
    const tenant = await this.getTenantRaw(id, true).catch(async (error) => {
      if (!this.isMissingCompanyLocationColumnError(error)) {
        throw error;
      }

      this.logger.warn(
        `Tenant detail fallback for ${id}: missing company city/state columns in DB. Retrying without those fields.`,
      );
      return this.getTenantRaw(id, false);
    });

    if (!tenant || tenant.deletedAt) {
      throw new NotFoundException('Tenant not found');
    }

    const primaryCompany = tenant.companies?.[0];

    return {
      ...tenant,
      gstin: primaryCompany?.gstin ?? null,
      address: primaryCompany?.address ?? null,
      city: primaryCompany?.city ?? null,
      state: primaryCompany?.state ?? null,
      pincode: primaryCompany?.pincode ?? null,
      phone: primaryCompany?.phone ?? null,
      email: primaryCompany?.email ?? null,
      isActive: tenant.status === EntityStatus.ACTIVE,
    };
  }

  async createTenant(dto: {
    name: string;
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
    const requestedName = dto.name.trim();
    const requestedSlug = await this.buildUniqueTenantSlug(requestedName);

    const existingName = await this.prisma.tenant.findFirst({
      where: {
        name: { equals: requestedName, mode: 'insensitive' },
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
          name: requestedName,
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
          city: dto.city?.trim() || null,
          state: dto.state?.trim() || null,
          pincode: dto.pincode?.trim() || null,
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

      const selectedPlan = dto.planId
        ? await tx.plan.findUnique({ where: { id: dto.planId } })
        : await tx.plan.findFirst({
            where: {
              deletedAt: null,
              status: EntityStatus.ACTIVE,
              NOT: {
                OR: [
                  { name: 'Free Trial' },
                  { description: 'Default 3-month free trial' },
                ],
              },
            },
            orderBy: { createdAt: 'asc' },
          });

      if (!selectedPlan) {
        throw new BadRequestException(
          dto.planId
            ? 'Plan not found'
            : 'No active subscription plan is configured for automatic assignment',
        );
      }

      this.assertSupportedPlanDuration(selectedPlan.durationDays);

      const { startDate, endDate } = this.buildIstSubscriptionWindow(
        selectedPlan.durationDays,
      );
      await tx.subscription.create({
        data: {
          tenantId: tenant.id,
          planId: selectedPlan.id,
          startDate,
          endDate,
          amountPaid: selectedPlan.price,
          status: 'ACTIVE',
          paymentStatus: 'PAID',
        },
      });

      return { tenant, company, user };
    });

    await this.redisService.set(
      this.getSetupLinkKey(setupToken),
      result.user.id,
      PASSWORD_LINK_TTL_SECONDS,
    );
    await this.redisService.set(
      this.getUserPasswordSetupStateKey(result.user.id),
      setupToken,
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
      pincode: string;
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
            ...(typeof dto.city === 'string'
              ? { city: dto.city.trim() || null }
              : {}),
            ...(typeof dto.state === 'string'
              ? { state: dto.state.trim() || null }
              : {}),
            ...(typeof dto.pincode === 'string'
              ? { pincode: dto.pincode.trim() || null }
              : {}),
            ...(typeof dto.phone === 'string'
              ? { phone: dto.phone.trim() || null }
              : {}),
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
        deletedAt: null,
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
    displayName: string;
    durationDays: number;
    price: number;
    currency?: string;
    maxUsers?: number;
    maxCompanies?: number;
  }) {
    this.assertSupportedPlanDuration(dto.durationDays);

    const displayName = dto.displayName.trim();
    if (!displayName) {
      throw new BadRequestException('Display name is required');
    }

    const baseName = this.buildPlanName(displayName);
    let name = baseName;
    let suffix = 2;

    while (
      await this.prisma.plan.findFirst({
        where: { name },
        select: { id: true },
      })
    ) {
      name = `${baseName}-${suffix}`;
      suffix += 1;
    }

    return this.prisma.plan.create({
      data: {
        name,
        description: displayName,
        durationDays: dto.durationDays,
        price: dto.price,
        maxUsers: dto.maxUsers ?? 0,
        maxCompanies: dto.maxCompanies ?? 0,
      },
    });
  }

  async updatePlan(id: string, dto: Record<string, any>) {
    if (dto.durationDays !== undefined) {
      this.assertSupportedPlanDuration(dto.durationDays);
    }

    return this.prisma.plan.update({
      where: { id },
      data: dto,
    });
  }

  async togglePlan(id: string, status: boolean) {
    return this.prisma.plan.update({
      where: { id },
      data: {
        status: status ? 'ACTIVE' : 'INACTIVE',
        deletedAt: status ? null : new Date(),
      },
    });
  }

  async deletePlan(id: string) {
    return this.prisma.plan.update({
      where: { id },
      data: {
        status: 'INACTIVE',
        deletedAt: new Date(),
      },
    });
  }

  async getPlanUsage(id: string) {
    const [subscriptionCount, tenantCount] = await Promise.all([
      this.prisma.subscription.count({
        where: {
          planId: id,
          deletedAt: null,
          status: 'ACTIVE',
        },
      }),
      this.prisma.subscription.findMany({
        where: {
          planId: id,
          deletedAt: null,
          status: 'ACTIVE',
        },
        select: {
          tenantId: true,
        },
        distinct: ['tenantId'],
      }),
    ]);

    return {
      totalSubscriptions: subscriptionCount,
      tenantsUsing: tenantCount.length,
    };
  }

  async assignSubscription(dto: {
    gstin: string;
    planId: string;
    amount?: number;
  }) {
    const gstin = dto.gstin.trim().toUpperCase();

    // find tenant by gstin
    const company = await this.prisma.company.findFirst({
      where: { gstin, deletedAt: null, status: EntityStatus.ACTIVE },
      select: { tenantId: true },
    });
    if (!company)
      throw new NotFoundException('Company not found with given GSTIN');

    const plan = await this.prisma.plan.findUnique({
      where: { id: dto.planId },
    });
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

    await this.redisService.del(
      getTenantSubscriptionCacheKey(company.tenantId),
    );
    return created;
  }

  private async buildUniqueTenantSlug(name: string) {
    const baseSlug =
      name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || 'tenant';

    let candidate = baseSlug;
    let suffix = 0;

    while (true) {
      const existing = await this.prisma.tenant.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });

      if (!existing) {
        return candidate;
      }

      suffix += 1;
      candidate = `${baseSlug}-${suffix}`.slice(0, 64);
    }
  }

  private buildPlanName(name: string) {
    const normalized = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64);

    return normalized || 'plan';
  }

  async listSubscriptions(query: {
    page?: number;
    limit?: number;
    status?: string;
  }) {
    const { skip, take, page, limit } = parsePagination(query);
    const where: Prisma.SubscriptionWhereInput = {
      deletedAt: null,
    };
    if (query.status) {
      const status = query.status.toUpperCase();
      if (
        Object.values(SubscriptionStatus).includes(status as SubscriptionStatus)
      ) {
        where.status = status as SubscriptionStatus;
      }
    }
    const [rows, total] = await Promise.all([
      this.prisma.subscription.findMany({
        where,
        skip,
        take,
        include: {
          plan: true,
          tenant: {
            select: {
              id: true,
              name: true,
              companies: {
                where: { deletedAt: null },
                select: { gstin: true },
                orderBy: { createdAt: 'asc' },
                take: 1,
              },
            },
          },
        },
      }),
      this.prisma.subscription.count({ where }),
    ]);

    const data = rows.map((row) => ({
      ...row,
      tenant: row.tenant
        ? {
            id: row.tenant.id,
            name: row.tenant.name,
            gstin: row.tenant.companies?.[0]?.gstin ?? null,
          }
        : null,
    }));

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

    if (dto.status === 'CANCELLED') {
      data.deletedAt = new Date();
    } else if (dto.status === 'ACTIVE') {
      data.deletedAt = null;
    }

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

  async deleteSubscription(id: string) {
    const sub = await this.prisma.subscription.findUnique({
      where: { id },
      select: { id: true, tenantId: true, deletedAt: true },
    });

    if (!sub || sub.deletedAt) {
      throw new NotFoundException('Subscription not found');
    }

    await this.prisma.subscription.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        deletedAt: new Date(),
      },
    });

    await this.redisService.del(getTenantSubscriptionCacheKey(sub.tenantId));
    return;
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
      userCompanies: {
        some: {},
      },
      NOT: {
        userCompanies: {
          some: {
            role: UserRole.OWNER,
          },
        },
      },
      ...(query.tenantId ? { tenantId: query.tenantId } : {}),
      ...(query.search
        ? {
            OR: [
              {
                email: { contains: query.search, mode: 'insensitive' as const },
              },
              {
                name: { contains: query.search, mode: 'insensitive' as const },
              },
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
          _count: {
            select: {
              refreshTokens: true,
            },
          },
          refreshTokens: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { createdAt: true },
          },
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

    const normalizedUsers = await Promise.all(
      users.map(async (user) => {
        const [firstName, ...rest] = (user.name ?? '')
          .trim()
          .split(/\s+/)
          .filter(Boolean);
        const passwordSetupCompleted = (user._count?.refreshTokens ?? 0) > 0;

        let passwordSetupStatus:
          | 'SETUP_COMPLETED'
          | 'PENDING_SETUP'
          | 'LINK_EXPIRED' = 'SETUP_COMPLETED';

        if (passwordSetupCompleted) {
          passwordSetupStatus = 'SETUP_COMPLETED';
        } else {
          const setupTtlSeconds = await this.redisService.getTtlSeconds(
            this.getUserPasswordSetupStateKey(user.id),
          );
          passwordSetupStatus =
            setupTtlSeconds > 0 ? 'PENDING_SETUP' : 'LINK_EXPIRED';
        }

        return {
          ...user,
          firstName: firstName || null,
          lastName: rest.length ? rest.join(' ') : null,
          isActive: user.status === EntityStatus.ACTIVE,
          role: this.toLegacyRole(this.getHighestRole(user.userCompanies)),
          passwordSetupStatus,
          lastLoginAt: user.refreshTokens?.[0]?.createdAt ?? null,
        };
      }),
    );

    return createPaginatedResult(normalizedUsers, total, page, limit);
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
    await this.redisService.set(
      this.getUserPasswordSetupStateKey(user.id),
      token,
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
    const where: Prisma.AuditLogWhereInput = {
      ...(query.companyId ? { companyId: query.companyId } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.entity
        ? {
            entity: {
              equals: query.entity,
              mode: 'insensitive',
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
            },
          },
          company: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return createPaginatedResult(rows, total, page, limit);
  }

  async getModulePermissions() {
    return [];
  }

  async upsertModulePermission() {
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

    return (
      [...rows].map((row) => row.role).sort((a, b) => rank[b] - rank[a])[0] ??
      UserRole.VIEWER
    );
  }

  private toLegacyRole(role: UserRole): string {
    switch (role) {
      case UserRole.OWNER:
        return 'TENANT_ADMIN';
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

  private getUserPasswordSetupStateKey(userId: string) {
    return `auth:setup-link:user:${userId}`;
  }

  private hashOpaqueToken(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private resolvePublicAppUrl(): string {
    const appUrl = this.configService.get<string>('app.url');
    const baseUrl = appUrl
      ?.split(',')
      .map((value) => value.trim())
      .find((value) => value.length > 0);

    if (!baseUrl) {
      throw new Error('APP_URL is required to build public links.');
    }

    return baseUrl.replace(/\/+$/, '');
  }

  private buildPublicLink(
    path: '/accept-invite' | '/reset-password',
    token: string,
  ) {
    const url = new URL(path, `${this.resolvePublicAppUrl()}/`);
    url.searchParams.set('token', token);
    return url.toString();
  }

  private assertSupportedPlanDuration(durationDays: number) {
    const normalized = Math.trunc(Number(durationDays));
    if (
      !Number.isFinite(normalized) ||
      !ALLOWED_PLAN_DURATIONS.has(normalized)
    ) {
      throw new BadRequestException(
        'Plan duration must be one of 30, 90, or 180 days.',
      );
    }
  }

  private buildIstSubscriptionWindow(
    durationDays: number,
    anchor = new Date(),
  ) {
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

    const [year, month, day] = formatted
      .split('-')
      .map((value) => Number(value));
    return new Date(
      Date.UTC(year, month - 1, day, 0, 0, 0, 0) -
        IST_OFFSET_MINUTES * 60 * 1000,
    );
  }
}
