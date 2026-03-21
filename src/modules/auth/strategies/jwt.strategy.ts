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
    private configService: ConfigService,
    private prisma: PrismaService,
    private redisService: RedisService,
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

    const user = await this.getUserAuthContext(payload.sub, payload.sessionId);

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (!user.isActive) {
      throw new ForbiddenException('Your account has been deactivated.');
    }

    if (user.role !== 'SUPER_ADMIN') {
      if (!user.tenantId) {
        throw new ForbiddenException('No tenant associated with this user');
      }

      const tenantIsActive = await this.getTenantActiveState(user.tenantId);
      if (!tenantIsActive) {
        throw new ForbiddenException('Your account has been deactivated.');
      }
    }

    if (
      payload.iat &&
      user.passwordChangedAt &&
      user.passwordChangedAt.getTime() > payload.iat * 1000
    ) {
      throw new UnauthorizedException('Session expired. Please sign in again.');
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      sessionId: payload.sessionId,
    };
  }

  private async getUserAuthContext(userId: string, sessionId: string) {
    const cached = parseCachedJson<CachedUserAuthContext>(
      await this.redisService.get(getUserAuthCacheKey(userId, sessionId)),
    );

    if (cached) {
      return {
        ...cached,
        passwordChangedAt: cached.passwordChangedAt
          ? new Date(cached.passwordChangedAt)
          : null,
      };
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        isActive: true,
        role: true,
        tenantId: true,
        passwordChangedAt: true,
        tenant: { select: { isActive: true } },
      },
    });

    if (!user) {
      return null;
    }

    await this.redisService.set(
      getUserAuthCacheKey(userId, sessionId),
      JSON.stringify({
        id: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        isActive: user.isActive,
        passwordChangedAt: user.passwordChangedAt?.toISOString() ?? null,
      } satisfies CachedUserAuthContext),
      USER_AUTH_CACHE_TTL_SECONDS,
    );

    if (user.role !== 'SUPER_ADMIN' && user.tenantId && user.tenant) {
      await this.redisService.set(
        getTenantActiveCacheKey(user.tenantId),
        user.tenant.isActive ? '1' : '0',
        TENANT_ACTIVE_CACHE_TTL_SECONDS,
      );
    }

    return user;
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
      select: { isActive: true },
    });

    const isActive = tenant?.isActive ?? false;

    await this.redisService.set(
      getTenantActiveCacheKey(tenantId),
      isActive ? '1' : '0',
      TENANT_ACTIVE_CACHE_TTL_SECONDS,
    );

    return isActive;
  }
}
