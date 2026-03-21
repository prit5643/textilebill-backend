import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TenantService } from './tenant.service';
import { JwtAuthGuard, SubscriptionGuard } from '../../common/guards';
import { CurrentUser } from '../../common/decorators';

@ApiTags('Tenant')
@Controller('tenant')
@UseGuards(JwtAuthGuard, SubscriptionGuard)
@ApiBearerAuth('access-token')
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  @Get('profile')
  @ApiOperation({ summary: 'Get current tenant profile' })
  async getProfile(@CurrentUser('tenantId') tenantId: string) {
    return this.tenantService.findById(tenantId);
  }

  @Patch('profile')
  @ApiOperation({ summary: 'Update tenant profile' })
  async updateProfile(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: Record<string, any>,
  ) {
    return this.tenantService.update(tenantId, dto);
  }
}
