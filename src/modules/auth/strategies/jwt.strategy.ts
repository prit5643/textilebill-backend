import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { JwtPayload } from '../auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { getAccessTokenFromRequest } from '../auth-cookie.util';
import { RedisService } from '../../redis/redis.service';
import {
  CachedUserAuthContext,
  getTenantActiveCacheKey,
  getUserAuthCacheKey,
  parseCachedJson,
  TENANT_ACTIVE_CACHE_TTL_SECONDS,
  USER_AUTH_CACHE_TTL_SECONDS,
} from '../auth-request-cache.util';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request) => getAccessTokenFromRequest(request as Request),
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secret'),
    });
  }

  async validate(payload: JwtPayload) {
    if (!payload.sub || !payload.sessionId) {
      throw new UnauthorizedException('Invalid token payload');
    }

    const user = await this.getUserAuthContext(
      payload.sub,
      payload.sessionId,
      payload.role,
    );

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (!user.isActive) {
      throw new ForbiddenException('Your account has been deactivated or removed by an administrator.');
    }

    if (user.role !== 'SUPER_ADMIN') {
      if (!user.tenantId) {
        throw new ForbiddenException('No tenant associated with this user');
      }

      const tenantIsActive = await this.getTenantActiveState(user.tenantId);
      if (!tenantIsActive) {
        throw new ForbiddenException('Your account has been deactivated or removed by an administrator.');
      }
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      sessionId: payload.sessionId,
    };
  }

  private async getUserAuthContext(
    userId: string,
    sessionId: string,
    roleFromToken: string,
  ) {
    const cached = parseCachedJson<CachedUserAuthContext>(
      await this.redisService.get(getUserAuthCacheKey(userId, sessionId)),
    );

    if (cached) {
      return cached;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        status: true,
        deletedAt: true,
        tenantId: true,
      },
    });

    if (!user) {
      return null;
    }

    const context: CachedUserAuthContext = {
      id: user.id,
      email: user.email,
      role: roleFromToken,
      tenantId: user.tenantId,
      isActive: user.status === 'ACTIVE' && user.deletedAt === null,
      passwordChangedAt: null,
    };

    await this.redisService.set(
      getUserAuthCacheKey(userId, sessionId),
      JSON.stringify(context),
      USER_AUTH_CACHE_TTL_SECONDS,
    );

    if (roleFromToken !== 'SUPER_ADMIN' && user.tenantId) {
      const tenantIsActive = await this.getTenantActiveState(user.tenantId);
      await this.redisService.set(
        getTenantActiveCacheKey(user.tenantId),
        tenantIsActive ? '1' : '0',
        TENANT_ACTIVE_CACHE_TTL_SECONDS,
      );
    }

    return context;
  }

  private async getTenantActiveState(tenantId: string) {
    const cached = await this.redisService.get(
      getTenantActiveCacheKey(tenantId),
    );

    if (cached === '1') {
      return true;
    }

    if (cached === '0') {
      return false;
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { status: true, deletedAt: true },
    });

    const isActive =
      tenant?.status === 'ACTIVE' && (tenant?.deletedAt ?? null) === null;

    await this.redisService.set(
      getTenantActiveCacheKey(tenantId),
      isActive ? '1' : '0',
      TENANT_ACTIVE_CACHE_TTL_SECONDS,
    );

    return isActive;
  }
}
