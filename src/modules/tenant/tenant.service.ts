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
        companies: {
          where: { deletedAt: null },
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
          },
        },
      },
    });

    if (!tenant) {
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
    };
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
    }>,
  ) {
    await this.findById(id);

    await this.prisma.$transaction(async (tx) => {
      await tx.tenant.update({
        where: { id },
        data: {
          ...(typeof data.name === 'string' ? { name: data.name.trim() } : {}),
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
            ...(typeof data.name === 'string'
              ? { name: data.name.trim() }
              : {}),
            ...(typeof data.gstin === 'string'
              ? { gstin: data.gstin.trim().toUpperCase() || null }
              : {}),
            ...(typeof data.address === 'string'
              ? { address: data.address.trim() || null }
              : {}),
            ...(typeof data.city === 'string'
              ? { city: data.city.trim() || null }
              : {}),
            ...(typeof data.state === 'string'
              ? { state: data.state.trim() || null }
              : {}),
            ...(typeof data.pincode === 'string'
              ? { pincode: data.pincode.trim() || null }
              : {}),
            ...(typeof data.phone === 'string'
              ? { phone: data.phone.trim() || null }
              : {}),
            ...(typeof data.email === 'string'
              ? { email: data.email.trim().toLowerCase() || null }
              : {}),
          },
        });
      }
    });

    // Clear caches to ensure all tenant admin sessions see the updates
    await this.clearTenantUsersCaches(id);

    return this.findById(id);
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
