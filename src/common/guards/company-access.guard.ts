import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import {
  COMPANY_ACCESS_KEY,
  RequireCompanyAccessOptions,
} from '../decorators/require-company-access.decorator';
import { PrismaService } from '../../modules/prisma/prisma.service';
import { RedisService } from '../../modules/redis/redis.service';

type AuthenticatedRequest = {
  user?: {
    id: string;
    role: string;
    companyRole?: string;
    tenantId?: string;
  };
  companyId?: string;
  params?: Record<string, unknown>;
  body?: Record<string, unknown>;
};

@Injectable()
export class CompanyAccessGuard implements CanActivate {
  private readonly allowCacheTtlSeconds = 5 * 60;
  private readonly denyCacheTtlSeconds = 60;

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

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

    const cacheKey = `company-access:${user.id}:${companyId}`;
    const cached = await this.redisService.get(cacheKey);
    if (cached === '1') {
      user.companyRole = await this.resolveCompanyRole(user, companyId);
      request.companyId = companyId;
      return true;
    }
    if (cached === '0') {
      throw new ForbiddenException('You do not have access to this company.');
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
    request.companyId = companyId;
    return true;
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
    const isTenantWideRole =
      user.role === 'TENANT_ADMIN' ||
      user.role === 'OWNER' ||
      user.role === 'ADMIN';

    const where: Prisma.CompanyWhereInput = isGlobalAdmin
      ? { id: companyId, status: 'ACTIVE', deletedAt: null }
      : isTenantWideRole
        ? {
            id: companyId,
            tenantId: user.tenantId,
            status: 'ACTIVE',
            deletedAt: null,
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

  private getMissingCompanyMessage(
    options: Required<RequireCompanyAccessOptions>,
  ): string {
    if (options.source === 'header') {
      return 'X-Company-Id header is required.';
    }

    return `${options.key} is required.`;
  }
}
