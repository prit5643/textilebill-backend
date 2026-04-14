import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import {
  JwtAuthGuard,
  RolesGuard,
  SubscriptionGuard,
} from '../../common/guards';
import { Roles } from '../../common/decorators';
import { AdminService } from './admin.service';
import {
  CreateTenantDto,
  UpdateTenantDto,
  CreatePlanDto,
  AssignSubscriptionDto,
  UpdateSubscriptionDto,
  UpdateAdminUserDto,
} from './dto';

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, SubscriptionGuard, RolesGuard)
@Roles('SUPER_ADMIN')
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ─── Dashboard ───
  @Get('dashboard')
  getDashboardKpis() {
    return this.adminService.getDashboardKpis();
  }

  // ─── Tenants ───
  @Get('tenants')
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'search', required: false })
  listTenants(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
  ) {
    return this.adminService.listTenants({
      page: +(page ?? 1),
      limit: +(limit ?? 50),
      search,
    });
  }

  @Get('tenants/:id')
  getTenant(@Param('id') id: string) {
    return this.adminService.getTenant(id);
  }

  @Post('tenants')
  createTenant(@Body() dto: CreateTenantDto) {
    return this.adminService.createTenant(dto);
  }

  @Put('tenants/:id')
  updateTenant(@Param('id') id: string, @Body() dto: UpdateTenantDto) {
    return this.adminService.updateTenant(id, dto as any);
  }

  @Patch('tenants/:id/toggle')
  toggleTenant(@Param('id') id: string, @Body('isActive') isActive: boolean) {
    return this.adminService.toggleTenant(id, isActive);
  }

  @Delete('tenants/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteTenant(@Param('id') id: string) {
    return this.adminService.deleteTenant(id);
  }

  // ─── Plans ───
  @Get('plans')
  listPlans() {
    return this.adminService.listPlans();
  }

  @Post('plans')
  createPlan(@Body() dto: CreatePlanDto) {
    return this.adminService.createPlan(dto);
  }

  @Put('plans/:id')
  updatePlan(@Param('id') id: string, @Body() dto: Partial<CreatePlanDto>) {
    return this.adminService.updatePlan(id, dto as any);
  }

  @Patch('plans/:id/toggle')
  togglePlan(@Param('id') id: string, @Body('isActive') isActive: boolean) {
    return this.adminService.togglePlan(id, isActive);
  }

  @Delete('plans/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deletePlan(@Param('id') id: string) {
    return this.adminService.deletePlan(id);
  }

  @Get('plans/:id/usage')
  getPlanUsage(@Param('id') id: string) {
    return this.adminService.getPlanUsage(id);
  }

  // ─── Subscriptions ───
  @Get('subscriptions')
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'status', required: false })
  listSubscriptions(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: string,
  ) {
    return this.adminService.listSubscriptions({
      page: +(page ?? 1),
      limit: +(limit ?? 50),
      status,
    });
  }

  @Post('subscriptions')
  assignSubscription(@Body() dto: AssignSubscriptionDto) {
    if (!dto.gstin?.trim()) {
      throw new BadRequestException('gstin is required');
    }
    if (!dto.planId?.trim()) {
      throw new BadRequestException('planId is required');
    }

    return this.adminService.assignSubscription({
      gstin: dto.gstin.trim(),
      planId: dto.planId.trim(),
      amount: dto.amount,
    });
  }

  @Patch('subscriptions/:id')
  updateSubscription(
    @Param('id') id: string,
    @Body() dto: UpdateSubscriptionDto,
  ) {
    return this.adminService.updateSubscription(id, dto);
  }

  @Delete('subscriptions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteSubscription(@Param('id') id: string) {
    return this.adminService.deleteSubscription(id);
  }

  // ─── Cross-tenant Users ───
  @Get('users')
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'tenantId', required: false })
  listAllUsers(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.adminService.listAllUsers({
      page: +(page ?? 1),
      limit: +(limit ?? 50),
      search,
      tenantId,
    });
  }

  @Patch('users/:id/toggle')
  toggleUser(@Param('id') id: string, @Body('isActive') isActive: boolean) {
    return this.adminService.toggleUser(id, isActive);
  }

  @Put('users/:id')
  updateUser(@Param('id') id: string, @Body() dto: UpdateAdminUserDto) {
    return this.adminService.updateUser(id, dto);
  }

  @Post('users/:id/resend-setup-link')
  resendSetupLinkByAdmin(@Param('id') id: string) {
    return this.adminService.resendSetupLinkByAdmin(id);
  }

  @Post('users/:id/send-password-reset-link')
  sendPasswordResetLinkByAdmin(@Param('id') id: string) {
    return this.adminService.sendPasswordResetLinkByAdmin(id);
  }

  // ─── Audit Logs ───
  @Get('audit-logs')
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'companyId', required: false })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'entity', required: false })
  getAuditLogs(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('companyId') companyId?: string,
    @Query('userId') userId?: string,
    @Query('entity') entity?: string,
  ) {
    return this.adminService.getAuditLogs({
      page: +(page ?? 1),
      limit: +(limit ?? 50),
      companyId,
      userId,
      entity,
    });
  }

  // ─── Module Permissions ───
  @Get('permissions/:companyId')
  getModulePermissions(@Param('companyId') companyId: string) {
    return this.adminService.getModulePermissions(companyId);
  }

  @Post('permissions')
  upsertModulePermission(@Body() data: Record<string, unknown>) {
    return this.adminService.upsertModulePermission(data as any);
  }
}
