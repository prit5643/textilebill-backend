import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
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
  decryptSecret,
  encryptSecret,
  looksEncryptedSecret,
} from '../../common/utils/secret-crypto.util';
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
  city: true,
  state: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CompanySelect;

const COMPANY_LIST_HEADER_SELECT = {
  id: true,
  name: true,
  gstin: true,
  city: true,
  state: true,
  isActive: true,
} satisfies Prisma.CompanySelect;

@Injectable()
export class CompanyService {
  private readonly logger = new Logger(CompanyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  private getSecretKey(): string {
    return (
      this.configService.get<string>('app.secretKey') ||
      process.env.APP_SECRET_KEY ||
      process.env.JWT_SECRET ||
      'textilebill-default-secret-key'
    );
  }

  private decryptSettingsPayload<T extends Record<string, any> | null>(
    settings: T,
  ): T {
    if (!settings) {
      return settings;
    }

    const secret = this.getSecretKey();
    const payload = { ...settings };

    if (payload.ewayBillPasswordEnc) {
      payload.ewayBillPassword = decryptSecret(payload.ewayBillPasswordEnc, secret);
    } else if (payload.ewayBillPassword && looksEncryptedSecret(payload.ewayBillPassword)) {
      payload.ewayBillPassword = decryptSecret(payload.ewayBillPassword, secret);
    }

    if (payload.einvoicePasswordEnc) {
      payload.einvoicePassword = decryptSecret(payload.einvoicePasswordEnc, secret);
    } else if (payload.einvoicePassword && looksEncryptedSecret(payload.einvoicePassword)) {
      payload.einvoicePassword = decryptSecret(payload.einvoicePassword, secret);
    }

    return payload as T;
  }

  private buildSettingsWritePayload(dto: UpdateCompanySettingsDto) {
    const payload: Record<string, unknown> = { ...dto };
    const secret = this.getSecretKey();

    if (dto.ewayBillPassword !== undefined) {
      payload.ewayBillPasswordEnc = dto.ewayBillPassword
        ? encryptSecret(dto.ewayBillPassword, secret)
        : null;
      payload.ewayBillPassword = null;
    }

    if (dto.einvoicePassword !== undefined) {
      payload.einvoicePasswordEnc = dto.einvoicePassword
        ? encryptSecret(dto.einvoicePassword, secret)
        : null;
      payload.einvoicePassword = null;
    }

    return payload;
  }

  private getListSelect(view: CompanyListView): Prisma.CompanySelect {
    return view === 'header'
      ? COMPANY_LIST_HEADER_SELECT
      : COMPANY_LIST_DEFAULT_SELECT;
  }

  async getPlanUsage(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        subscriptions: {
          where: { status: 'ACTIVE' },
          take: 1,
          include: {
            plan: {
              select: {
                id: true,
                name: true,
                displayName: true,
                maxUsers: true,
                maxCompanies: true,
              },
            },
          },
        },
        _count: {
          select: {
            companies: {
              where: {
                isActive: true,
              },
            },
            users: {
              where: {
                isActive: true,
              },
            },
          },
        },
      },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    const activeSub = tenant.subscriptions[0];
    const maxCompanies = activeSub?.plan.maxCompanies ?? null;
    const maxUsers = activeSub?.plan.maxUsers ?? null;
    const usedCompanies = tenant._count.companies;
    const usedUsers = tenant._count.users;

    return {
      tenantId: tenant.id,
      isActive: !!activeSub,
      plan: activeSub
        ? {
            id: activeSub.plan.id,
            name: activeSub.plan.name,
            displayName: activeSub.plan.displayName,
          }
        : null,
      limits: {
        maxCompanies,
        maxUsers,
      },
      usage: {
        companies: usedCompanies,
        users: usedUsers,
      },
      canCreateCompany:
        maxCompanies === null ? true : usedCompanies < maxCompanies,
      canCreateUser: maxUsers === null ? true : usedUsers < maxUsers,
    };
  }

  // ── Create company ─────────────────────────────────
  async create(
    tenantId: string,
    dto: CreateCompanyDto,
    createdByUserId?: string,
  ) {
    // Check plan limits
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        subscriptions: {
          where: { status: 'ACTIVE' },
          include: { plan: true },
          take: 1,
        },
        companies: { where: { isActive: true } },
      },
    });

    if (!tenant) throw new NotFoundException('Tenant not found');

    const activeSub = tenant.subscriptions[0];
    if (activeSub && tenant.companies.length >= activeSub.plan.maxCompanies) {
      throw new ForbiddenException(
        `Company limit reached (${activeSub.plan.maxCompanies}). Upgrade your plan.`,
      );
    }

    const company = await this.prisma.company.create({
      data: {
        tenantId,
        name: dto.name,
        gstin: dto.gstin,
        address: dto.address,
        city: dto.city,
        state: dto.state ?? 'Gujarat',
        pincode: dto.pincode,
        phone: dto.phone,
        email: dto.email,
        bankName: dto.bankName,
        bankAccountNo: dto.bankAccountNo,
        bankIfsc: dto.bankIfsc,
        bankBranch: dto.bankBranch,
      },
    });

    // Auto-create default settings
    await this.prisma.companySettings.create({
      data: { companyId: company.id },
    });

    // Auto-create first financial year (April - March)
    const now = new Date();
    const fyStart =
      now.getMonth() >= 3
        ? new Date(now.getFullYear(), 3, 1)
        : new Date(now.getFullYear() - 1, 3, 1);
    const fyEnd = new Date(fyStart.getFullYear() + 1, 2, 31);
    const fyName = `${fyStart.getFullYear()}-${String(fyEnd.getFullYear()).slice(2)}`;

    const financialYear = await this.prisma.financialYear.create({
      data: {
        companyId: company.id,
        name: fyName,
        startDate: fyStart,
        endDate: fyEnd,
        isActive: true,
      },
    });

    // Update settings to link the default financial year
    await this.prisma.companySettings.update({
      where: { companyId: company.id },
      data: { defaultFinancialYearId: financialYear.id },
    });

    // Ensure the creator can access this company from the same login.
    if (createdByUserId) {
      await this.prisma.userCompanyAccess.upsert({
        where: {
          userId_companyId: {
            userId: createdByUserId,
            companyId: company.id,
          },
        },
        update: {},
        create: {
          userId: createdByUserId,
          companyId: company.id,
        },
      });
    }

    this.logger.log(`Company created: ${company.name} (${company.id})`);
    return company;
  }

  // ── List companies for tenant ──────────────────────
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
    const select = this.getListSelect(view);

    const where: Prisma.CompanyWhereInput = { tenantId };

    if (
      actor &&
      actor.role !== 'SUPER_ADMIN' &&
      actor.role !== 'TENANT_ADMIN'
    ) {
      where.userAccess = {
        some: {
          userId: actor.userId,
        },
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.company.findMany({
        where,
        skip,
        take,
        orderBy: { name: 'asc' },
        select,
      }),
      this.prisma.company.count({ where }),
    ]);

    return createPaginatedResult(data, total, p, l);
  }

  // ── Get single company ─────────────────────────────
  async findById(id: string, tenantId: string) {
    const company = await this.prisma.company.findFirst({
      where: { id, tenantId },
      include: {
        settings: true,
        financialYears: { orderBy: { startDate: 'desc' } },
        _count: { select: { products: true, accounts: true, invoices: true } },
      },
    });

    if (!company) throw new NotFoundException('Company not found');
    if (company.settings) {
      company.settings = this.decryptSettingsPayload(company.settings);
    }
    return company;
  }

  // ── Update company ─────────────────────────────────
  async update(id: string, tenantId: string, dto: UpdateCompanyDto) {
    await this.findById(id, tenantId); // Ensure it exists & belongs to tenant

    const updatedCompany = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.company.update({
        where: { id },
        data: dto,
      });

      const tenantProfileUpdate: Partial<{
        name: string;
        gstin: string;
        address: string;
        city: string;
        state: string;
        pincode: string;
        phone: string;
        email: string;
      }> = {};

      if (dto.name !== undefined) tenantProfileUpdate.name = dto.name;
      if (dto.gstin !== undefined) tenantProfileUpdate.gstin = dto.gstin;
      if (dto.address !== undefined) tenantProfileUpdate.address = dto.address;
      if (dto.city !== undefined) tenantProfileUpdate.city = dto.city;
      if (dto.state !== undefined) tenantProfileUpdate.state = dto.state;
      if (dto.pincode !== undefined) tenantProfileUpdate.pincode = dto.pincode;
      if (dto.phone !== undefined) tenantProfileUpdate.phone = dto.phone;
      if (dto.email !== undefined) tenantProfileUpdate.email = dto.email;

      if (Object.keys(tenantProfileUpdate).length > 0) {
        const activeCompanies = await tx.company.findMany({
          where: { tenantId, isActive: true },
          select: { id: true },
        });

        // Tenant profile in super admin mirrors company profile for single-company tenants.
        if (activeCompanies.length === 1 && activeCompanies[0].id === id) {
          await tx.tenant.update({
            where: { id: tenantId },
            data: tenantProfileUpdate,
          });
        }
      }

      return updated;
    });

    // Clear caches so all tenant users see company updates immediately
    await this.clearTenantUsersCaches(tenantId);

    return updatedCompany;
  }

  // ── Delete company (soft) ──────────────────────────
  async remove(id: string, tenantId: string) {
    await this.findById(id, tenantId);

    return this.prisma.company.update({
      where: { id },
      data: { isActive: false },
    });
  }

  // ── Settings ───────────────────────────────────────
  async getSettings(companyId: string, tenantId: string) {
    await this.findById(companyId, tenantId);

    const settings = await this.prisma.companySettings.findUnique({
      where: { companyId },
    });

    return this.decryptSettingsPayload(settings);
  }

  async updateSettings(
    companyId: string,
    tenantId: string,
    dto: UpdateCompanySettingsDto,
  ) {
    await this.findById(companyId, tenantId);

    const settingsPayload = this.buildSettingsWritePayload(dto);

    return this.prisma.companySettings.upsert({
      where: { companyId },
      update: settingsPayload,
      create: { companyId, ...settingsPayload },
    });
  }

  // ── Financial Years ────────────────────────────────
  async getFinancialYears(companyId: string, tenantId: string) {
    await this.findById(companyId, tenantId);

    const financialYears = await this.prisma.financialYear.findMany({
      where: { companyId },
      orderBy: { startDate: 'desc' },
    });

    const now = new Date();
    const activeFy = financialYears.find((fy) => fy.isActive);

    // Auto-activate next FY if current one has expired
    if (activeFy) {
      const fyEndDate = new Date(activeFy.endDate);
      
      if (now > fyEndDate) {
        // Current FY has expired, find and activate the next one
        const nextFy = financialYears
          .filter((fy) => new Date(fy.startDate) > fyEndDate)
          .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())[0];

        if (nextFy) {
          await this.prisma.financialYear.updateMany({
            where: { companyId },
            data: { isActive: false },
          });

          await this.prisma.financialYear.update({
            where: { id: nextFy.id },
            data: { isActive: true },
          });

          // Update in-memory array
          activeFy.isActive = false;
          nextFy.isActive = true;

          this.logger.log(
            `Auto-activated next financial year: ${nextFy.name} for company ${companyId}`,
          );
        }
      }

      // Auto-suggest/create next FY if we're in the last 3 months of active FY
      const threeMonthsBeforeEnd = new Date(activeFy.endDate);
      threeMonthsBeforeEnd.setMonth(threeMonthsBeforeEnd.getMonth() - 3);

      if (now >= threeMonthsBeforeEnd) {
        const nextFyStart = new Date(activeFy.endDate);
        nextFyStart.setDate(nextFyStart.getDate() + 1);
        
        const nextFyExists = financialYears.some(
          (fy) => new Date(fy.startDate) >= nextFyStart,
        );

        if (!nextFyExists) {
          const nextFyEnd = new Date(nextFyStart.getFullYear() + 1, 2, 31);
          const nextFyName = `${nextFyStart.getFullYear()}-${String(nextFyEnd.getFullYear()).slice(2)}`;

          const newFy = await this.prisma.financialYear.create({
            data: {
              companyId,
              name: nextFyName,
              startDate: nextFyStart,
              endDate: nextFyEnd,
              isActive: false,
            },
          });

          this.logger.log(
            `Auto-created next financial year: ${nextFyName} for company ${companyId}`,
          );

          financialYears.unshift(newFy);
        }
      }
    }

    return financialYears;
  }

  async createFinancialYear(
    companyId: string,
    tenantId: string,
    data: { name: string; startDate: Date; endDate: Date },
  ) {
    await this.findById(companyId, tenantId);

    return this.prisma.financialYear.create({
      data: {
        companyId,
        name: data.name,
        startDate: data.startDate,
        endDate: data.endDate,
        isActive: false,
      },
    });
  }

  async setActiveFinancialYear(
    companyId: string,
    tenantId: string,
    fyId: string,
  ) {
    await this.findById(companyId, tenantId);

    // Deactivate all
    await this.prisma.financialYear.updateMany({
      where: { companyId },
      data: { isActive: false },
    });

    // Activate selected
    return this.prisma.financialYear.update({
      where: { id: fyId },
      data: { isActive: true },
    });
  }

  /**
   * Clears all cached session data for users belonging to a tenant.
   * Ensures company data updates are immediately visible across all active sessions.
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
      this.logger.warn(
        `Failed to clear tenant user caches for ${tenantId}: ${error.message}`,
      );
    }
  }
}
