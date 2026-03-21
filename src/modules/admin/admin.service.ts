import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  parsePagination,
  createPaginatedResult,
} from '../../common/utils/pagination.util';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { PasswordTokenStatus, PasswordTokenType } from '@prisma/client';
import { OtpDeliveryService } from '../auth/otp-delivery.service';
import {
  generatePasswordLifecycleToken,
  hashPasswordLifecycleToken,
} from '../auth/password-token.util';
import {
  getTenantActiveCacheKey,
  getTenantSubscriptionCacheKey,
  getUserAuthCachePattern,
} from '../auth/auth-request-cache.util';

const PASSWORD_SETUP_LINK_EXPIRY_MINUTES = 30;
const PASSWORD_RESET_LINK_EXPIRY_MINUTES = 30;
const PASSWORD_SETUP_MAX_RESEND_COUNT = 3;
const PASSWORD_RESET_MAX_RESEND_COUNT = 3;

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
    private readonly otpDeliveryService: OtpDeliveryService,
  ) {}

  private coalesceTenantProfileValue(
    tenantValue: string | null | undefined,
    companyValue: string | null | undefined,
  ) {
    const normalizedTenant = tenantValue?.trim();
    if (normalizedTenant) return normalizedTenant;

    const normalizedCompany = companyValue?.trim();
    return normalizedCompany || null;
  }

  private hydrateTenantFromCompanies<
    T extends {
      gstin?: string | null;
      address?: string | null;
      city?: string | null;
      state?: string | null;
      pincode?: string | null;
      phone?: string | null;
      email?: string | null;
      companies?: Array<{
        gstin?: string | null;
        address?: string | null;
        city?: string | null;
        state?: string | null;
        pincode?: string | null;
        phone?: string | null;
        email?: string | null;
      }>;
    },
  >(tenant: T): T {
    const company = tenant.companies?.find((entry) =>
      [
        entry.gstin,
        entry.address,
        entry.city,
        entry.state,
        entry.pincode,
        entry.phone,
        entry.email,
      ].some((value) => Boolean(value?.trim())),
    );

    if (!company) {
      return tenant;
    }

    return {
      ...tenant,
      gstin: this.coalesceTenantProfileValue(tenant.gstin, company.gstin),
      address: this.coalesceTenantProfileValue(tenant.address, company.address),
      city: this.coalesceTenantProfileValue(tenant.city, company.city),
      state: this.coalesceTenantProfileValue(tenant.state, company.state),
      pincode: this.coalesceTenantProfileValue(tenant.pincode, company.pincode),
      phone: this.coalesceTenantProfileValue(tenant.phone, company.phone),
      email: this.coalesceTenantProfileValue(tenant.email, company.email),
    };
  }

  // â”€â”€â”€ Dashboard KPIs â”€â”€â”€
  async getDashboardKpis() {
    const [totalTenants, activeTenants, totalUsers, totalPlans] =
      await Promise.all([
        this.prisma.tenant.count(),
        this.prisma.tenant.count({ where: { isActive: true } }),
        this.prisma.user.count({ where: { role: { not: 'SUPER_ADMIN' } } }),
        this.prisma.plan.count({ where: { isActive: true } }),
      ]);

    const now = new Date();
    const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const [activeSubscriptions, expiringSubscriptions, totalRevenue] =
      await Promise.all([
        this.prisma.subscription.count({ where: { status: 'ACTIVE' } }),
        this.prisma.subscription.count({
          where: {
            status: 'ACTIVE',
            endDate: { gte: now, lte: thirtyDaysLater },
          },
        }),
        this.prisma.subscription.aggregate({
          _sum: { amount: true },
          where: { status: { in: ['ACTIVE', 'EXPIRED'] } },
        }),
      ]);

    return {
      totalTenants,
      activeTenants,
      totalUsers,
      totalPlans,
      activeSubscriptions,
      expiringSubscriptions,
      totalRevenue: totalRevenue._sum.amount || 0,
    };
  }

  // â”€â”€â”€ Tenants â”€â”€â”€
  async listTenants(query: { page?: number; limit?: number; search?: string }) {
    const { skip, take, page, limit } = parsePagination(query);

    const where: Record<string, unknown> = {};
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { slug: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
        { gstin: { contains: query.search, mode: 'insensitive' } },
        {
          companies: {
            some: {
              isActive: true,
              gstin: { contains: query.search, mode: 'insensitive' },
            },
          },
        },
      ];
    }

    const [tenants, total] = await Promise.all([
      this.prisma.tenant.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { users: true, companies: true } },
          companies: {
            where: { isActive: true },
            orderBy: { createdAt: 'asc' },
            select: {
              gstin: true,
              address: true,
              city: true,
              state: true,
              pincode: true,
              phone: true,
              email: true,
            },
          },
          subscriptions: {
            where: { status: 'ACTIVE' },
            orderBy: { endDate: 'desc' },
            take: 1,
            include: { plan: true },
          },
        },
      }),
      this.prisma.tenant.count({ where }),
    ]);

    const normalizedTenants = tenants.map((tenant) =>
      this.hydrateTenantFromCompanies(tenant),
    );

    return createPaginatedResult(normalizedTenants, total, page, limit);
  }

  async getTenant(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        users: {
          select: {
            id: true,
            email: true,
            username: true,
            firstName: true,
            lastName: true,
            role: true,
            isActive: true,
            lastLoginAt: true,
          },
        },
        companies: {
          where: { isActive: true },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            name: true,
            gstin: true,
            address: true,
            city: true,
            state: true,
            pincode: true,
            phone: true,
            email: true,
            isActive: true,
          },
        },
        subscriptions: {
          orderBy: { createdAt: 'desc' },
          include: { plan: true },
        },
      },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return this.hydrateTenantFromCompanies(tenant);
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
    // Check slug uniqueness
    const existing = await this.prisma.tenant.findUnique({
      where: { slug: dto.slug },
    });
    if (existing) throw new BadRequestException('Slug already taken');

    const rawPassword = randomUUID() + randomUUID();
    const passwordHash = await bcrypt.hash(rawPassword, 12);
    const inviteToken = generatePasswordLifecycleToken();
    const inviteTokenExpiresAt = new Date(
      Date.now() + PASSWORD_SETUP_LINK_EXPIRY_MINUTES * 60 * 1000,
    );

    const result = await this.prisma.$transaction(async (tx) => {
      // Create tenant
      const tenant = await tx.tenant.create({
        data: {
          name: dto.name,
          slug: dto.slug,
          gstin: dto.gstin,
          address: dto.address,
          city: dto.city,
          state: dto.state,
          pincode: dto.pincode,
          phone: dto.phone,
          email: dto.email,
        },
      });

      // Create admin user
      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: dto.email,
          username: dto.slug + '_admin',
          passwordHash,
          role: 'TENANT_ADMIN',
          firstName: dto.adminFirstName,
          lastName: dto.adminLastName,
          phone: dto.phone,
          inviteToken,
          inviteTokenExpiresAt,
        },
      });

      await tx.passwordLifecycleToken.create({
        data: {
          tenantId: tenant.id,
          userId: user.id,
          tokenHash: hashPasswordLifecycleToken(inviteToken),
          type: PasswordTokenType.SETUP_PASSWORD,
          status: PasswordTokenStatus.ACTIVE,
          expiresAt: inviteTokenExpiresAt,
          maxResends: 3,
          requestedByRole: 'SUPER_ADMIN',
        },
      });

      // Create default company
      const company = await tx.company.create({
        data: {
          tenantId: tenant.id,
          name: dto.name,
          gstin: dto.gstin,
          address: dto.address,
          city: dto.city,
          state: dto.state ?? 'Gujarat',
        },
      });

      // Link user to company
      await tx.userCompanyAccess.create({
        data: {
          userId: user.id,
          companyId: company.id,
        },
      });

      // Create subscription if plan specified
      if (dto.planId) {
        const plan = await tx.plan.findUnique({ where: { id: dto.planId } });
        if (plan) {
          const startDate = new Date();
          const endDate = new Date(
            startDate.getTime() + plan.durationDays * 24 * 60 * 60 * 1000,
          );
          await tx.subscription.create({
            data: {
              tenantId: tenant.id,
              planId: plan.id,
              startDate,
              endDate,
              amount: plan.price,
              status: 'ACTIVE',
            },
          });
        }
      }

      return { tenant, user, company };
    });

    const appUrl = this.configService.get<string>('app.url', 'http://localhost:3000');
    const setupLink = `${appUrl}/accept-invite?token=${inviteToken}`;
    const deliveryStatus = await this.sendInviteEmailAndAudit({
      userId: result.user.id,
      email: dto.email,
      setupLink,
      expiresAt: inviteTokenExpiresAt,
      action: 'PASSWORD_SETUP_LINK_SENT',
      metadata: {
        initiatedBy: 'SUPER_ADMIN_TENANT_CREATE',
        resendCount: 0,
        remainingResends: PASSWORD_SETUP_MAX_RESEND_COUNT,
      },
      throwOnFailure: false,
    });

    this.logger.log(
      `Tenant "${dto.name}" created with admin user ${result.user.email}`,
    );
    return {
      ...result,
      passwordSetupStatus: 'PENDING_SETUP',
      passwordSetupExpiresAt: inviteTokenExpiresAt,
      passwordSetupDeliveryStatus: deliveryStatus,
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
      const updated = await tx.tenant.update({
        where: { id },
        data: dto,
      });

      // Keep GSTIN in sync for company-facing screens.
      // Users read GSTIN from company payloads, not tenant payloads.
      if (dto.gstin !== undefined) {
        await tx.company.updateMany({
          where: {
            tenantId: id,
            OR: [{ gstin: null }, { gstin: '' }],
          },
          data: { gstin: dto.gstin || null },
        });
      }

      // User-side pages read company fields. If this tenant has a single company,
      // keep those details aligned with tenant edits.
      const companies = await tx.company.findMany({
        where: { tenantId: id },
        select: { id: true },
      });

      if (companies.length === 1) {
        const companyUpdate: Partial<{
          name: string;
          gstin: string;
          address: string;
          city: string;
          state: string;
          phone: string;
          email: string;
        }> = {};

        if (dto.name !== undefined) companyUpdate.name = dto.name;
        if (dto.gstin !== undefined) companyUpdate.gstin = dto.gstin;
        if (dto.address !== undefined) companyUpdate.address = dto.address;
        if (dto.city !== undefined) companyUpdate.city = dto.city;
        if (dto.state !== undefined) companyUpdate.state = dto.state;
        if (dto.phone !== undefined) companyUpdate.phone = dto.phone;
        if (dto.email !== undefined) companyUpdate.email = dto.email;

        if (Object.keys(companyUpdate).length > 0) {
          await tx.company.update({
            where: { id: companies[0].id },
            data: companyUpdate,
          });
        }
      }

      return updated;
    });

    // Critical: Clear all caches for this tenant's users to ensure
    // tenant admins see updated data immediately without re-login
    await this.clearTenantUsersCaches(id);

    return updatedTenant;
  }

  /**
   * Clears all cached session data for users belonging to a tenant.
   * This ensures that when super admin updates tenant data (GST, email, etc.),
   * all active tenant admin sessions immediately see the changes on next API call.
   */
  private async clearTenantUsersCaches(tenantId: string) {
    try {
      // Clear tenant-level caches
      await this.redisService.del(getTenantActiveCacheKey(tenantId));
      await this.redisService.del(getTenantSubscriptionCacheKey(tenantId));

      // Find all users belonging to this tenant
      const users = await this.prisma.user.findMany({
        where: { tenantId },
        select: { id: true },
      });

      // Clear all session caches for each user
      // This forces fresh data fetch on their next authenticated request
      for (const user of users) {
        const pattern = getUserAuthCachePattern(user.id);
        const sessionKeys = await this.redisService.keys(pattern);

        for (const key of sessionKeys) {
          await this.redisService.del(key);
        }
      }

      this.logger.log(
        `Cleared caches for ${users.length} users in tenant ${tenantId}`,
      );
    } catch (error) {
      // Don't fail the update if cache clearing fails
      // Users will get fresh data after cache TTL expires (5 min)
      this.logger.warn(
        `Failed to clear tenant user caches for ${tenantId}: ${error.message}`,
      );
    }
  }

  async toggleTenant(id: string, isActive: boolean) {
    await this.getTenant(id);
    const tenant = await this.prisma.tenant.update({
      where: { id },
      data: { isActive },
    });
    // Clear all caches to ensure tenant users see status change immediately
    await this.clearTenantUsersCaches(id);
    return tenant;
  }

  async deleteTenant(id: string) {
    await this.getTenant(id);
    return this.prisma.tenant.delete({ where: { id } });
  }

  // â”€â”€â”€ Plans â”€â”€â”€
  async listPlans() {
    return this.prisma.plan.findMany({ orderBy: { price: 'asc' } });
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
    return this.prisma.plan.create({
      data: {
        name: dto.name,
        displayName: dto.displayName,
        durationDays: dto.durationDays,
        price: dto.price,
        currency: dto.currency ?? 'INR',
        maxUsers: dto.maxUsers ?? 5,
        maxCompanies: dto.maxCompanies ?? 3,
      },
    });
  }

  async updatePlan(id: string, dto: Record<string, unknown>) {
    return this.prisma.plan.update({ where: { id }, data: dto as any });
  }

  async togglePlan(id: string, isActive: boolean) {
    const plan = await this.prisma.plan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('Plan not found');
    return this.prisma.plan.update({ where: { id }, data: { isActive } });
  }

  async deletePlan(id: string) {
    const activeUsage = await this.prisma.subscription.count({
      where: {
        planId: id,
        status: { in: ['ACTIVE', 'TRIAL'] },
      },
    });

    if (activeUsage > 0) {
      throw new BadRequestException(
        'Cannot delete plan with active subscriptions',
      );
    }

    return this.prisma.plan.delete({ where: { id } });
  }

  // â”€â”€â”€ Subscriptions â”€â”€â”€
  async assignSubscription(dto: {
    gstin: string;
    planId: string;
    amount?: number;
  }) {
    const gstin = dto.gstin.trim().toUpperCase();
    if (!gstin) {
      throw new BadRequestException('GST number is required');
    }

    const plan = await this.prisma.plan.findUnique({
      where: { id: dto.planId },
    });
    if (!plan) throw new NotFoundException('Plan not found');

    const tenants = await this.prisma.tenant.findMany({
      where: {
        OR: [
          {
            gstin: {
              equals: gstin,
              mode: 'insensitive',
            },
          },
          {
            companies: {
              some: {
                isActive: true,
                gstin: {
                  equals: gstin,
                  mode: 'insensitive',
                },
              },
            },
          },
        ],
      },
      select: {
        id: true,
        name: true,
        slug: true,
        gstin: true,
        isActive: true,
        subscriptions: {
          where: { status: 'ACTIVE' },
          orderBy: { endDate: 'desc' },
          take: 1,
          include: {
            plan: {
              select: { displayName: true },
            },
          },
        },
      },
    });

    if (tenants.length === 0) {
      throw new NotFoundException('No tenant found for this GST number');
    }

    if (tenants.length > 1) {
      throw new BadRequestException(
        'GST number is linked to multiple tenants. Resolve duplicates before assigning subscription.',
      );
    }

    const tenant = tenants[0];

    if (!tenant.isActive) {
      throw new BadRequestException(
        'Cannot assign subscription to an inactive tenant',
      );
    }

    const existingActiveSub = tenant.subscriptions[0];
    if (existingActiveSub) {
      const existingPlanName =
        existingActiveSub.plan?.displayName || 'Unknown Plan';
      throw new BadRequestException(
        `GST number ${gstin} is already linked to an active subscription (${existingPlanName}).`,
      );
    }

    const startDate = new Date();
    const endDate = new Date(
      startDate.getTime() + plan.durationDays * 24 * 60 * 60 * 1000,
    );

    const subscription = await this.prisma.subscription.create({
      data: {
        tenantId: tenant.id,
        planId: dto.planId,
        startDate,
        endDate,
        amount: dto.amount ?? plan.price,
        status: 'ACTIVE',
      },
      include: {
        plan: true,
        tenant: { select: { id: true, name: true, slug: true, gstin: true } },
      },
    });

    await this.redisService.del(getTenantSubscriptionCacheKey(tenant.id));
    return subscription;
  }

  async listSubscriptions(query: {
    page?: number;
    limit?: number;
    status?: string;
  }) {
    const { skip, take, page, limit } = parsePagination(query);
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;

    const [subs, total] = await Promise.all([
      this.prisma.subscription.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          tenant: { select: { id: true, name: true, slug: true, gstin: true } },
          plan: true,
        },
      }),
      this.prisma.subscription.count({ where }),
    ]);

    return createPaginatedResult(subs, total, page, limit);
  }

  async updateSubscription(
    id: string,
    dto: {
      planId?: string;
      amount?: number;
      status?: 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'TRIAL';
      endDate?: string;
      extendDays?: number;
    },
  ) {
    const existing = await this.prisma.subscription.findUnique({
      where: { id },
      include: {
        tenant: { select: { id: true, name: true, slug: true, gstin: true } },
        plan: true,
      },
    });

    if (!existing) throw new NotFoundException('Subscription not found');

    const data: Record<string, unknown> = {};

    if (dto.planId) {
      const plan = await this.prisma.plan.findUnique({ where: { id: dto.planId } });
      if (!plan) throw new NotFoundException('Plan not found');
      data.planId = dto.planId;
    }

    if (dto.amount !== undefined) data.amount = dto.amount;
    if (dto.status) data.status = dto.status;

    if (dto.endDate) {
      const parsed = new Date(dto.endDate);
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException('Invalid endDate');
      }
      data.endDate = parsed;
    }

    if (dto.extendDays !== undefined) {
      if (!Number.isFinite(dto.extendDays) || dto.extendDays <= 0) {
        throw new BadRequestException('extendDays must be greater than 0');
      }
      const baseDate =
        data.endDate instanceof Date ? data.endDate : new Date(existing.endDate);
      data.endDate = new Date(
        baseDate.getTime() + dto.extendDays * 24 * 60 * 60 * 1000,
      );
    }

    if (dto.status === 'CANCELLED' && !data.endDate) {
      data.endDate = new Date();
    }

    if (!Object.keys(data).length) {
      throw new BadRequestException('No subscription fields provided to update');
    }

    const updated = await this.prisma.subscription.update({
      where: { id },
      data: data as any,
      include: {
        tenant: { select: { id: true, name: true, slug: true, gstin: true } },
        plan: true,
      },
    });

    await this.redisService.del(getTenantSubscriptionCacheKey(existing.tenantId));
    return updated;
  }

  // â”€â”€â”€ Cross-tenant Users â”€â”€â”€
  async listAllUsers(query: {
    page?: number;
    limit?: number;
    search?: string;
    tenantId?: string;
  }) {
    const { skip, take, page, limit } = parsePagination(query);
    const where: Record<string, unknown> = { role: { not: 'SUPER_ADMIN' } };
    if (query.tenantId) where.tenantId = query.tenantId;
    if (query.search) {
      where.OR = [
        { email: { contains: query.search, mode: 'insensitive' } },
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          username: true,
          firstName: true,
          lastName: true,
          role: true,
          isActive: true,
          lastLoginAt: true,
          passwordChangedAt: true,
          passwordTokens: {
            where: {
              type: PasswordTokenType.SETUP_PASSWORD,
              status: PasswordTokenStatus.ACTIVE,
            },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { expiresAt: true },
          },
          createdAt: true,
          tenant: { select: { id: true, name: true, slug: true, gstin: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return createPaginatedResult(
      users.map((user) => ({
        ...user,
        passwordSetupLinkExpiresAt: user.passwordTokens[0]?.expiresAt ?? null,
        passwordSetupStatus: user.passwordChangedAt
          ? 'SETUP_COMPLETED'
          : user.passwordTokens[0]?.expiresAt &&
              user.passwordTokens[0].expiresAt < new Date()
            ? 'LINK_EXPIRED'
            : 'PENDING_SETUP',
      })),
      total,
      page,
      limit,
    );
  }

  async toggleUser(id: string, isActive: boolean) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true },
    });

    if (!user) throw new NotFoundException('User not found');
    if (user.role === 'SUPER_ADMIN') {
      throw new BadRequestException(
        'Super admin user status cannot be changed',
      );
    }

    const updatedUser = await this.prisma.user.update({
      where: { id },
      data: { isActive },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        tenant: { select: { id: true, name: true, slug: true, gstin: true } },
      },
    });

    await this.clearUserAuthCache(id);
    return updatedUser;
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
    const existingUser = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true },
    });

    if (!existingUser) throw new NotFoundException('User not found');
    if (existingUser.role === 'SUPER_ADMIN') {
      throw new BadRequestException('Super admin user cannot be edited here');
    }

    const data: Record<string, unknown> = {};

    if (dto.firstName !== undefined) {
      data.firstName = dto.firstName.trim() || null;
    }

    if (dto.lastName !== undefined) {
      data.lastName = dto.lastName.trim() || null;
    }

    if (dto.email !== undefined) {
      data.email = dto.email.trim().toLowerCase();
    }

    if (dto.role !== undefined) {
      data.role = dto.role;
    }

    if (!Object.keys(data).length) {
      throw new BadRequestException('No user fields provided to update');
    }

    const updatedUser = await this.prisma.user.update({
      where: { id },
      data: data as any,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        tenant: { select: { id: true, name: true, slug: true, gstin: true } },
      },
    });

    await this.clearUserAuthCache(id);
    return updatedUser;
  }

  private async clearUserAuthCache(userId: string): Promise<void> {
    const keys = await this.redisService.keys(getUserAuthCachePattern(userId));
    for (const key of keys) {
      await this.redisService.del(key);
    }
  }

  async resendSetupLinkByAdmin(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        tenantId: true,
        email: true,
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
    const expiresAt = new Date(
      Date.now() + PASSWORD_SETUP_LINK_EXPIRY_MINUTES * 60 * 1000,
    );
    const existingSetupToken = await this.prisma.passwordLifecycleToken.findFirst({
      where: {
        userId: user.id,
        type: PasswordTokenType.SETUP_PASSWORD,
        status: PasswordTokenStatus.ACTIVE,
      },
      orderBy: { createdAt: 'desc' },
      select: {
        resendCount: true,
        maxResends: true,
      },
    });
    const nextResendCount = (existingSetupToken?.resendCount ?? 0) + 1;
    const maxResends = existingSetupToken?.maxResends ?? PASSWORD_SETUP_MAX_RESEND_COUNT;

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
          tenantId: user.tenantId,
          userId: user.id,
          tokenHash: hashPasswordLifecycleToken(inviteToken),
          type: PasswordTokenType.SETUP_PASSWORD,
          status: PasswordTokenStatus.ACTIVE,
          expiresAt,
          maxResends: 3,
          requestedByRole: 'SUPER_ADMIN',
        },
      });

      await tx.user.update({
        where: { id: user.id },
        data: {
          inviteToken,
          inviteTokenExpiresAt: expiresAt,
        },
      });
    });

    const appUrl = this.configService.get<string>('app.url', 'http://localhost:3001');
    const setupLink = `${appUrl}/accept-invite?token=${inviteToken}`;
    await this.sendInviteEmailAndAudit({
      userId: user.id,
      email: user.email,
      setupLink,
      expiresAt,
      action: 'PASSWORD_SETUP_ADMIN_RESEND',
      metadata: {
        initiatedBy: 'SUPER_ADMIN',
        resendCount: nextResendCount,
        remainingResends: Math.max(0, maxResends - nextResendCount),
      },
      throwOnFailure: true,
    });

    return {
      message: 'Password setup link sent',
      email: user.email,
      expiresAt,
      status: 'RESEND_AVAILABLE',
    };
  }

  async sendPasswordResetLinkByAdmin(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        tenantId: true,
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
          tenantId: user.tenantId,
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

    await this.redisService.del(this.getPasswordResetLinkCooldownKey(user.id));

    const appUrl = this.configService.get<string>('app.url', 'http://localhost:3001');
    const resetLink = `${appUrl}/reset-password?token=${resetToken}`;
    await this.sendResetLinkEmailAndAudit({
      userId: user.id,
      email: user.email,
      resetLink,
      expiresAt,
      action: 'PASSWORD_RESET_ADMIN_OVERRIDE_LINK_SENT',
      metadata: {
        initiatedBy: 'SUPER_ADMIN',
        resendCount: 0,
        remainingResends: PASSWORD_RESET_MAX_RESEND_COUNT,
      },
      throwOnFailure: true,
    });

    return {
      message: 'Password reset link sent by admin override',
      email: user.email,
      expiresAt,
      status: 'RESEND_AVAILABLE',
    };
  }

  // â”€â”€â”€ Audit Logs â”€â”€â”€
  async getAuditLogs(query: {
    page?: number;
    limit?: number;
    companyId?: string;
    userId?: string;
    entity?: string;
  }) {
    const { skip, take, page, limit } = parsePagination(query);
    const where: Record<string, unknown> = {};
    if (query.companyId) where.companyId = query.companyId;
    if (query.userId) where.userId = query.userId;
    if (query.entity) where.entity = query.entity;

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
          company: { select: { id: true, name: true } },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return createPaginatedResult(logs, total, page, limit);
  }

  // â”€â”€â”€ Module Permissions â”€â”€â”€
  async getModulePermissions(companyId: string) {
    return this.prisma.modulePermission.findMany({
      where: { companyId },
      orderBy: [{ module: 'asc' }, { role: 'asc' }],
    });
  }

  async upsertModulePermission(data: {
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
    return this.prisma.modulePermission.upsert({
      where: {
        companyId_role_module: {
          companyId: data.companyId,
          role: data.role as any,
          module: data.module,
        },
      },
      create: data as any,
      update: data as any,
    });
  }

  private getPasswordResetLinkCooldownKey(userId: string): string {
    return `auth:reset-link:resend-cooldown:${userId}`;
  }

  private async sendInviteEmailAndAudit(input: {
    userId: string;
    email: string;
    setupLink: string;
    expiresAt: Date;
    action: string;
    metadata?: Record<string, unknown>;
    throwOnFailure: boolean;
  }): Promise<'QUEUED_OR_SENT' | 'FAILED'> {
    let delivered = false;

    try {
      delivered = await this.otpDeliveryService.sendInviteEmail(
        input.email,
        input.setupLink,
        PASSWORD_SETUP_LINK_EXPIRY_MINUTES,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send setup link to ${input.email}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const deliveryStatus = delivered ? 'QUEUED_OR_SENT' : 'FAILED';
    await this.prisma.auditLog.create({
      data: {
        userId: input.userId,
        action: input.action,
        entity: 'PASSWORD_LIFECYCLE',
        newValue: {
          channel: 'EMAIL',
          linkType: 'SETUP_LINK',
          expiresAt: input.expiresAt.toISOString(),
          deliveryStatus,
          email: input.email,
          ...(input.metadata ?? {}),
        },
      },
    });

    if (!delivered && input.throwOnFailure) {
      throw new ServiceUnavailableException(
        'We could not send the setup email right now. Please try again shortly.',
      );
    }

    return deliveryStatus;
  }

  private async sendResetLinkEmailAndAudit(input: {
    userId: string;
    email: string;
    resetLink: string;
    expiresAt: Date;
    action: string;
    metadata?: Record<string, unknown>;
    throwOnFailure: boolean;
  }): Promise<'QUEUED_OR_SENT' | 'FAILED'> {
    let delivered = false;

    try {
      delivered = await this.otpDeliveryService.sendPasswordResetLinkEmail(
        input.email,
        input.resetLink,
        PASSWORD_RESET_LINK_EXPIRY_MINUTES,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send password reset link to ${input.email}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const deliveryStatus = delivered ? 'QUEUED_OR_SENT' : 'FAILED';
    await this.prisma.auditLog.create({
      data: {
        userId: input.userId,
        action: input.action,
        entity: 'PASSWORD_LIFECYCLE',
        newValue: {
          channel: 'EMAIL',
          linkType: 'RESET_LINK',
          expiresAt: input.expiresAt.toISOString(),
          deliveryStatus,
          email: input.email,
          ...(input.metadata ?? {}),
        },
      },
    });

    if (!delivered && input.throwOnFailure) {
      throw new ServiceUnavailableException(
        'We could not send the password reset email right now. Please try again shortly.',
      );
    }

    return deliveryStatus;
  }
}
