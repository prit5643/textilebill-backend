import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import {
  COMPANY_ACCESS_KEY,
  RequireCompanyAccessOptions,
} from '../decorators/require-company-access.decorator';
import { PrismaService } from '../../modules/prisma/prisma.service';
import { RedisService } from '../../modules/redis/redis.service';
import {
  PagePermissionKey,
  normalizePagePermissions,
} from '../constants/page-permissions';

type AuthenticatedRequest = {
  user?: {
    id: string;
    role: string;
    companyRole?: string;
    tenantId?: string;
    pagePermissions?: Record<string, { enabled: boolean; editable: boolean }>;
  };
  companyId?: string;
  params?: Record<string, unknown>;
  body?: Record<string, unknown>;
};

@Injectable()
export class CompanyAccessGuard implements CanActivate {
  private readonly logger = new Logger(CompanyAccessGuard.name);
  private readonly allowCacheTtlSeconds = 5 * 60;
  private readonly denyCacheTtlSeconds = 60;

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  private isTenantWideAdmin(
    user: NonNullable<AuthenticatedRequest['user']>,
  ): boolean {
    return user.role === 'SUPER_ADMIN' || user.role === 'TENANT_ADMIN';
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<
      Required<RequireCompanyAccessOptions> | undefined
    >(COMPANY_ACCESS_KEY, [context.getHandler(), context.getClass()]);

    if (!options) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest & { method: string }>();
    const user = request.user;

    if (!user) {
      return true;
    }

    if (user.role === 'VIEWER' && request.method !== 'GET') {
      throw new ForbiddenException('Viewers cannot perform write operations.');
    }

    const companyId = this.extractCompanyId(request, options);
    if (!companyId) {
      throw new BadRequestException(this.getMissingCompanyMessage(options));
    }

    try {
      const cacheKey = `company-access:${user.id}:${companyId}`;
      const cached = await this.redisService.get(cacheKey);
      if (cached === '1') {
        user.companyRole = await this.resolveCompanyRole(user, companyId);
        await this.enforcePagePermission(request, user, companyId);
        request.companyId = companyId;
        return true;
      }
      if (cached === '0') {
        // Admin roles are allowed to manage inactive companies. A stale deny-cache
        // entry can exist briefly after status/access changes, so re-check from DB.
        if (!this.isTenantWideAdmin(user)) {
          throw new ForbiddenException('You do not have access to this company.');
        }
      }

      if (!user.tenantId && user.role !== 'SUPER_ADMIN') {
        throw new ForbiddenException('No tenant associated with this user.');
      }

      const hasAccess = await this.hasCompanyAccess(user, companyId);
      await this.redisService.set(
        cacheKey,
        hasAccess ? '1' : '0',
        hasAccess ? this.allowCacheTtlSeconds : this.denyCacheTtlSeconds,
      );

      if (!hasAccess) {
        throw new ForbiddenException('You do not have access to this company.');
      }

      user.companyRole = await this.resolveCompanyRole(user, companyId);
      await this.enforcePagePermission(request, user, companyId);
      request.companyId = companyId;
      return true;
    } catch (error) {
      // Re-throw known HTTP exceptions (ForbiddenException, BadRequestException, etc.)
      if (
        error instanceof ForbiddenException ||
        error instanceof BadRequestException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }

      // Prisma connection pool timeouts (P2024) and other DB errors
      // should NOT be returned as 403 Forbidden — that confuses the frontend
      // into showing "no permission" toasts. Return 503 instead.
      if (this.isPrismaConnectionError(error)) {
        this.logger.error(
          `Database connection pool exhausted during company access check: ${(error as Error).message}`,
        );
        throw new ServiceUnavailableException(
          'Service temporarily unavailable. Please try again.',
        );
      }

      // Unknown errors also go as 503 to avoid misleading 403s
      this.logger.error(
        `Unexpected error in CompanyAccessGuard: ${(error as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'Service temporarily unavailable. Please try again.',
      );
    }
  }

  private isPrismaConnectionError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const code = (error as { code?: string }).code;
    return code === 'P2024' || code === 'P2028';
  }

  private extractCompanyId(
    request: AuthenticatedRequest,
    options: Required<RequireCompanyAccessOptions>,
  ): string | undefined {
    const rawValue =
      options.source === 'header'
        ? request.companyId
        : options.source === 'param'
          ? request.params?.[options.key]
          : request.body?.[options.key];

    if (typeof rawValue !== 'string') {
      return undefined;
    }

    const companyId = rawValue.trim();
    return companyId || undefined;
  }

  private async hasCompanyAccess(
    user: NonNullable<AuthenticatedRequest['user']>,
    companyId: string,
  ): Promise<boolean> {
    const isGlobalAdmin = user.role === 'SUPER_ADMIN';
    const isTenantWideRole = user.role === 'TENANT_ADMIN';

    // Tenant-wide admins must be able to access inactive companies so they
    // can reactivate them from management screens. Staff access remains limited
    // to active companies explicitly assigned through UserCompany.
    const where: Prisma.CompanyWhereInput = isGlobalAdmin
      ? { id: companyId }
      : isTenantWideRole
        ? {
            id: companyId,
            tenantId: user.tenantId,
          }
        : {
            id: companyId,
            tenantId: user.tenantId,
            status: 'ACTIVE',
            deletedAt: null,
            userCompanies: {
              some: {
                userId: user.id,
                tenantId: user.tenantId,
              },
            },
          };

    const company = await this.prisma.company.findFirst({
      where,
      select: { id: true },
    });

    return Boolean(company);
  }

  private async resolveCompanyRole(
    user: NonNullable<AuthenticatedRequest['user']>,
    companyId: string,
  ): Promise<string> {
    if (user.role === 'SUPER_ADMIN') {
      return 'SUPER_ADMIN';
    }

    if (user.role === 'TENANT_ADMIN') {
      return 'TENANT_ADMIN';
    }

    const assignment = await this.prisma.userCompany.findFirst({
      where: {
        userId: user.id,
        companyId,
        tenantId: user.tenantId,
      },
      select: { role: true },
    });

    if (!assignment) {
      return user.role;
    }

    switch (assignment.role) {
      case 'MANAGER':
        return 'MANAGER';
      case 'ACCOUNTANT':
        return 'ACCOUNTANT';
      case 'VIEWER':
      default:
        return 'VIEWER';
    }
  }

  private resolvePageKeyFromRequest(
    request: AuthenticatedRequest & { method: string; originalUrl?: string },
  ): PagePermissionKey | null {
    const path = (request.originalUrl || '')
      .split('?')[0]
      .replace(/^\/api/i, '')
      .toLowerCase();

    if (
      request.method === 'GET' &&
      /^\/companies\/[^/]+\/financial-years$/.test(path)
    ) {
      return null;
    }
    if (path === '/reports/dashboard' || path === '/reports/monthly-chart') {
      return 'dashboard';
    }
    // Stock-related report and accounting endpoints used by the stock page.
    // Return null to skip page-permission enforcement for these data-fetching
    // routes — the frontend layout already gates stock page access.
    if (path.startsWith('/reports/stock') || path.startsWith('/reports/profit-fifo')) {
      return null;
    }
    if (
      path.startsWith('/accounting/opening-balances/products') ||
      path.startsWith('/accounting/stock-adjustments')
    ) {
      return null;
    }
    if (path.startsWith('/invoices')) return 'invoices';
    if (path.startsWith('/accounts')) return 'accounts';
    if (path.startsWith('/products')) return 'products';
    if (path.startsWith('/stock')) return 'stock';
    if (path.startsWith('/accounting')) return 'accounting';
    if (path.startsWith('/expenses')) return 'expenses';
    if (path.startsWith('/work-orders')) return 'work_orders';
    if (path.startsWith('/reports')) return 'reports';
    if (path.startsWith('/companies')) return 'companies';
    if (path.startsWith('/users')) return 'settings';
    return 'dashboard';
  }

  private async enforcePagePermission(
    request: AuthenticatedRequest & { method: string; originalUrl?: string },
    user: NonNullable<AuthenticatedRequest['user']>,
    companyId: string,
  ) {
    if (user.role === 'SUPER_ADMIN' || user.role === 'TENANT_ADMIN') {
      return;
    }

    const pageKey = this.resolvePageKeyFromRequest(request);
    if (!pageKey) {
      return;
    }

    const rows = await this.prisma.$queryRaw<
      Array<{ role: string; pagePermissions: unknown }>
    >(
      Prisma.sql`SELECT "role", "pagePermissions" FROM "UserCompany" WHERE "userId" = ${user.id} AND "companyId" = ${companyId} AND "tenantId" = ${user.tenantId} LIMIT 1`,
    );
    if (!rows.length) {
      throw new ForbiddenException('You do not have access to this company.');
    }

    const role = rows[0].role as
      | 'SUPER_ADMIN'
      | 'TENANT_ADMIN'
      | 'MANAGER'
      | 'ACCOUNTANT'
      | 'VIEWER';
    
    // Validate that the role exists and is valid
    if (!role) {
      this.logger.error(
        `User ${user.id} has no role in UserCompany record for company ${companyId}`,
      );
      throw new ForbiddenException('User role is not properly configured.');
    }

    const permissions = normalizePagePermissions(rows[0].pagePermissions, role);
    user.pagePermissions = permissions;
    const entry = permissions[pageKey];

    // Defensive check: entry should always exist, but handle gracefully if it doesn't
    if (!entry || !entry.enabled) {
      throw new ForbiddenException(
        'You do not have access to this page. Please contact your administrator.',
      );
    }

    const isWrite = request.method !== 'GET';
    if (isWrite && !entry.editable) {
      throw new ForbiddenException(
        'This page is view only for your account.',
      );
    }
  }

  private getMissingCompanyMessage(
    options: Required<RequireCompanyAccessOptions>,
  ): string {
    if (options.source === 'header') {
      return 'X-Company-Id header is required.';
    }

    return `${options.key} is required.`;
  }
}
