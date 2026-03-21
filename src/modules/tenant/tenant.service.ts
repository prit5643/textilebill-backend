import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  getTenantActiveCacheKey,
  getTenantSubscriptionCacheKey,
  getUserAuthCachePattern,
} from '../auth/auth-request-cache.util';

@Injectable()
export class TenantService {
  private readonly logger = new Logger(TenantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  async findById(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        subscriptions: {
          where: { status: 'ACTIVE' },
          orderBy: { endDate: 'desc' },
          take: 1,
          include: { plan: true },
        },
      },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    return tenant;
  }

  async update(
    id: string,
    data: Partial<{
      name: string;
      gstin: string;
      address: string;
      city: string;
      state: string;
      pincode: string;
      phone: string;
      email: string;
      logoUrl: string;
    }>,
  ) {
    await this.findById(id);

    const updatedTenant = await this.prisma.tenant.update({
      where: { id },
      data,
    });

    // Clear caches to ensure all tenant admin sessions see the updates
    await this.clearTenantUsersCaches(id);

    return updatedTenant;
  }

  /**
   * Clears all cached session data for users belonging to a tenant.
   * Ensures that tenant profile updates are immediately visible across all active sessions.
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
