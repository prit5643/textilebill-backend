import {
  Injectable,
  NotFoundException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { EntityStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  getTenantActiveCacheKey,
  getTenantSubscriptionCacheKey,
  getUserAuthCachePattern,
} from '../auth/auth-request-cache.util';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { UpdateCompanySettingsDto } from './dto/update-settings.dto';
import {
  parsePagination,
  createPaginatedResult,
} from '../../common/utils/pagination.util';

type CompanyListView = 'default' | 'header';

const COMPANY_LIST_DEFAULT_SELECT = {
  id: true,
  tenantId: true,
  name: true,
  gstin: true,
  address: true,
  city: true,
  state: true,
  pincode: true,
  phone: true,
  email: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CompanySelect;

const COMPANY_LIST_HEADER_SELECT = {
  id: true,
  name: true,
  gstin: true,
  city: true,
  state: true,
  status: true,
} satisfies Prisma.CompanySelect;

@Injectable()
export class CompanyService {
  private readonly logger = new Logger(CompanyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  private getListSelect(view: CompanyListView): Prisma.CompanySelect {
    return view === 'header'
      ? COMPANY_LIST_HEADER_SELECT
      : COMPANY_LIST_DEFAULT_SELECT;
  }

  private async ensureTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }
    return tenant;
  }

  private getCurrentFinancialYearRange() {
    const now = new Date();
    const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const endYear = startYear + 1;
    return {
      startDate: new Date(startYear, 3, 1),
      endDate: new Date(endYear, 2, 31),
    };
  }

  async getPlanUsage(tenantId: string) {
    await this.ensureTenant(tenantId);

    const now = new Date();
    const [activeCompanies, activeUsers, activeSubscription] = await Promise.all([
      this.prisma.company.count({
        where: { tenantId, deletedAt: null, status: EntityStatus.ACTIVE },
      }),
      this.prisma.user.count({
        where: { tenantId, deletedAt: null, status: EntityStatus.ACTIVE },
      }),
      this.prisma.subscription.findFirst({
        where: {
          tenantId,
          deletedAt: null,
          status: 'ACTIVE',
          endDate: { gte: now },
        },
        orderBy: { endDate: 'desc' },
        include: {
          plan: {
            select: {
              id: true,
              name: true,
              description: true,
              price: true,
              durationDays: true,
              maxUsers: true,
              maxCompanies: true,
              status: true,
              deletedAt: true,
            },
          },
        },
      }),
    ]);

    const maxCompanies =
      activeSubscription && activeSubscription.plan.maxCompanies > 0
        ? activeSubscription.plan.maxCompanies
        : null;
    const maxUsers =
      activeSubscription && activeSubscription.plan.maxUsers > 0
        ? activeSubscription.plan.maxUsers
        : null;
    const hasActiveSubscription = Boolean(activeSubscription);

    return {
      tenantId,
      isActive: hasActiveSubscription,
      plan: activeSubscription?.plan ?? null,
      subscription: activeSubscription
        ? {
            id: activeSubscription.id,
            status: activeSubscription.status,
            paymentStatus: activeSubscription.paymentStatus,
            startDate: activeSubscription.startDate,
            endDate: activeSubscription.endDate,
          }
        : null,
      limits: {
        maxCompanies,
        maxUsers,
      },
      usage: {
        companies: activeCompanies,
        users: activeUsers,
      },
      canCreateCompany:
        hasActiveSubscription &&
        (maxCompanies === null || activeCompanies < maxCompanies),
      canCreateUser:
        hasActiveSubscription && (maxUsers === null || activeUsers < maxUsers),
    };
  }

  async create(
    tenantId: string,
    dto: CreateCompanyDto,
    createdByUserId?: string,
  ) {
    await this.ensureTenant(tenantId);

    const company = await this.prisma.company.create({
      data: {
        tenantId,
        name: dto.name.trim(),
        gstin: dto.gstin?.trim().toUpperCase() || null,
        address: dto.address?.trim() || null,
        city: dto.city?.trim() || null,
        state: dto.state?.trim() || null,
        pincode: dto.pincode?.trim() || null,
        phone: dto.phone?.trim() || null,
        email: dto.email?.trim().toLowerCase() || null,
        status: EntityStatus.ACTIVE,
      },
    });

    if (createdByUserId) {
      await this.prisma.userCompany.upsert({
        where: {
          userId_companyId: {
            userId: createdByUserId,
            companyId: company.id,
          },
        },
        update: {},
        create: {
          tenantId,
          userId: createdByUserId,
          companyId: company.id,
          role: UserRole.ADMIN,
        },
      });
    }

    const fy = this.getCurrentFinancialYearRange();
    await this.prisma.financialYear.upsert({
      where: {
        companyId_startDate_endDate: {
          companyId: company.id,
          startDate: fy.startDate,
          endDate: fy.endDate,
        },
      },
      update: {},
      create: {
        tenantId,
        companyId: company.id,
        startDate: fy.startDate,
        endDate: fy.endDate,
        isLocked: false,
      },
    });

    await this.clearTenantUsersCaches(tenantId);
    this.logger.log(`Company created: ${company.name} (${company.id})`);
    return {
      ...company,
      isActive: company.status === EntityStatus.ACTIVE,
    };
  }

  async findAll(
    tenantId: string,
    page?: number,
    limit?: number,
    view: CompanyListView = 'default',
  ) {
    return this.findAllForActor(tenantId, page, limit, undefined, view);
  }

  async findAllForActor(
    tenantId: string,
    page?: number,
    limit?: number,
    actor?: { userId: string; role: string },
    view: CompanyListView = 'default',
  ) {
    const { skip, take, page: p, limit: l } = parsePagination({ page, limit });
    const where: Prisma.CompanyWhereInput = { tenantId, deletedAt: null };

    if (
      actor &&
      actor.role !== 'SUPER_ADMIN' &&
      actor.role !== 'TENANT_ADMIN'
    ) {
      where.userCompanies = {
        some: { userId: actor.userId },
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.company.findMany({
        where,
        skip,
        take,
        orderBy: { name: 'asc' },
        select: this.getListSelect(view),
      }),
      this.prisma.company.count({ where }),
    ]);

    const normalized = data.map((company) => ({
      ...company,
      isActive: company.status === EntityStatus.ACTIVE,
    }));

    return createPaginatedResult(normalized, total, p, l);
  }

  async findById(id: string, tenantId: string) {
    const company = await this.prisma.company.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        financialYears: {
          orderBy: { startDate: 'desc' },
        },
        _count: {
          select: {
            products: true,
            accounts: true,
            invoices: true,
          },
        },
      },
    });

    if (!company) throw new NotFoundException('Company not found');
    return {
      ...company,
      isActive: company.status === EntityStatus.ACTIVE,
    };
  }

  async update(id: string, tenantId: string, dto: UpdateCompanyDto) {
    await this.findById(id, tenantId);

    const updated = await this.prisma.company.update({
      where: { id },
      data: {
        ...(typeof dto.name === 'string' ? { name: dto.name.trim() } : {}),
        ...(typeof dto.gstin === 'string'
          ? { gstin: dto.gstin.trim().toUpperCase() || null }
          : {}),
        ...(typeof dto.address === 'string'
          ? { address: dto.address.trim() || null }
          : {}),
        ...(typeof dto.city === 'string' ? { city: dto.city.trim() || null } : {}),
        ...(typeof dto.state === 'string'
          ? { state: dto.state.trim() || null }
          : {}),
        ...(typeof dto.pincode === 'string'
          ? { pincode: dto.pincode.trim() || null }
          : {}),
        ...(typeof dto.phone === 'string' ? { phone: dto.phone.trim() || null } : {}),
        ...(typeof dto.email === 'string'
          ? { email: dto.email.trim().toLowerCase() || null }
          : {}),
        ...(dto.isActive === true
          ? { status: EntityStatus.ACTIVE, deletedAt: null }
          : {}),
        ...(dto.isActive === false
          ? { status: EntityStatus.INACTIVE, deletedAt: new Date() }
          : {}),
      },
    });

    await this.clearTenantUsersCaches(tenantId);
    return {
      ...updated,
      isActive: updated.status === EntityStatus.ACTIVE,
    };
  }

  async remove(id: string, tenantId: string) {
    await this.findById(id, tenantId);

    const updated = await this.prisma.company.update({
      where: { id },
      data: {
        status: EntityStatus.INACTIVE,
        deletedAt: new Date(),
      },
    });

    await this.clearTenantUsersCaches(tenantId);
    return {
      ...updated,
      isActive: false,
    };
  }

  async getSettings(companyId: string, tenantId: string) {
    await this.findById(companyId, tenantId);

    const financialYears = await this.prisma.financialYear.findMany({
      where: { companyId },
      orderBy: { startDate: 'desc' },
    });

    const activeFy = financialYears.find((fy) => !fy.isLocked) ?? null;

    return {
      companyId,
      defaultFinancialYearId: activeFy?.id ?? null,
      settings: {},
      compatibilityNotice:
        'Company settings model was removed from schema v2; only financial-year activation is persisted.',
    };
  }

  async updateSettings(
    companyId: string,
    tenantId: string,
    dto: UpdateCompanySettingsDto,
  ) {
    await this.findById(companyId, tenantId);

    if (dto.defaultFinancialYearId) {
      await this.setActiveFinancialYear(companyId, tenantId, dto.defaultFinancialYearId);
    }

    return this.getSettings(companyId, tenantId);
  }

  async getFinancialYears(companyId: string, tenantId: string) {
    await this.findById(companyId, tenantId);

    const rows = await this.prisma.financialYear.findMany({
      where: { companyId },
      orderBy: { startDate: 'desc' },
    });

    const active = rows.find((row) => !row.isLocked)?.id ?? null;

    return rows.map((row) => ({
      ...row,
      isActive: row.id === active,
    }));
  }

  async createFinancialYear(
    companyId: string,
    tenantId: string,
    data: { name: string; startDate: Date; endDate: Date },
  ) {
    await this.findById(companyId, tenantId);

    if (!(data.startDate instanceof Date) || !(data.endDate instanceof Date)) {
      throw new BadRequestException('Invalid financial year dates');
    }
    if (data.endDate <= data.startDate) {
      throw new BadRequestException('endDate must be after startDate');
    }

    const existing = await this.prisma.financialYear.findFirst({
      where: {
        companyId,
        startDate: data.startDate,
        endDate: data.endDate,
      },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException('Financial year already exists');
    }

    const count = await this.prisma.financialYear.count({ where: { companyId } });
    return this.prisma.financialYear.create({
      data: {
        tenantId,
        companyId,
        startDate: data.startDate,
        endDate: data.endDate,
        isLocked: count > 0,
      },
    });
  }

  async setActiveFinancialYear(
    companyId: string,
    tenantId: string,
    fyId: string,
  ) {
    await this.findById(companyId, tenantId);

    const target = await this.prisma.financialYear.findFirst({
      where: { id: fyId, companyId },
      select: { id: true },
    });
    if (!target) {
      throw new NotFoundException('Financial year not found');
    }

    await this.prisma.financialYear.updateMany({
      where: { companyId },
      data: { isLocked: true },
    });

    const updated = await this.prisma.financialYear.update({
      where: { id: fyId },
      data: { isLocked: false },
    });

    return {
      ...updated,
      isActive: true,
    };
  }

  private async clearTenantUsersCaches(tenantId: string) {
    try {
      await this.redisService.del(getTenantActiveCacheKey(tenantId));
      await this.redisService.del(getTenantSubscriptionCacheKey(tenantId));

      const users = await this.prisma.user.findMany({
        where: { tenantId },
        select: { id: true },
      });

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
    } catch (error: any) {
      this.logger.warn(
        `Failed to clear tenant user caches for ${tenantId}: ${error.message}`,
      );
    }
  }
}
