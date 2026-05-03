import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { CompanyService } from './company.service';
import {
  CreateCompanyDto,
  UpdateCompanyDto,
  UpdateCompanySettingsDto,
} from './dto';
import {
  CompanyAccessGuard,
  JwtAuthGuard,
  RolesGuard,
} from '../../common/guards';
import {
  CurrentUser,
  RequireCompanyAccess,
  Roles,
  TenantId,
} from '../../common/decorators';

@ApiTags('Companies')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyAccessGuard, RolesGuard)
@Controller('companies')
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  @Get('usage/limits')
  @Roles('SUPER_ADMIN', 'TENANT_ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Get tenant plan limits and usage' })
  getUsageLimits(@TenantId() tenantId: string) {
    return this.companyService.getPlanUsage(tenantId);
  }

  @Post()
  @Roles('SUPER_ADMIN', 'TENANT_ADMIN')
  @ApiOperation({ summary: 'Create a new company' })
  create(
    @TenantId() tenantId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateCompanyDto,
  ) {
    return this.companyService.create(tenantId, dto, userId);
  }

  @Get()
  @ApiOperation({ summary: 'List all companies for tenant' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({
    name: 'view',
    required: false,
    enum: ['default', 'header'],
    description: 'Use header for lightweight company switcher payloads.',
  })
  findAll(
    @TenantId() tenantId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('view') view?: string,
    @Query('search') search?: string,
    @Query('isActive') isActive?: string,
  ) {
    const isActiveParsed =
      isActive === 'true' ? true : isActive === 'false' ? false : undefined;
    return this.companyService.findAllForActor(
      tenantId,
      page ? +page : undefined,
      limit ? +limit : undefined,
      { userId, role },
      view === 'header' ? 'header' : 'default',
      search,
      isActiveParsed,
    );
  }

  @Get(':id')
  @RequireCompanyAccess({ source: 'param', key: 'id' })
  @ApiOperation({ summary: 'Get company by ID' })
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.companyService.findById(id, tenantId);
  }

  @Patch(':id')
  @RequireCompanyAccess({ source: 'param', key: 'id' })
  @ApiOperation({ summary: 'Update a company' })
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCompanyDto,
  ) {
    return this.companyService.update(id, tenantId, dto);
  }

  @Delete(':id')
  @RequireCompanyAccess({ source: 'param', key: 'id' })
  @ApiOperation({ summary: 'Deactivate a company' })
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.companyService.remove(id, tenantId);
  }

  // ── Settings ───────────────────────────────────────
  @Get(':id/settings')
  @RequireCompanyAccess({ source: 'param', key: 'id' })
  @ApiOperation({ summary: 'Get company settings' })
  getSettings(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.companyService.getSettings(id, tenantId);
  }

  @Patch(':id/settings')
  @RequireCompanyAccess({ source: 'param', key: 'id' })
  @Roles('SUPER_ADMIN', 'TENANT_ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Update company settings' })
  updateSettings(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCompanySettingsDto,
  ) {
    return this.companyService.updateSettings(id, tenantId, dto);
  }

  // ── Financial Years ────────────────────────────────
  @Get(':id/financial-years')
  @RequireCompanyAccess({ source: 'param', key: 'id' })
  @ApiOperation({ summary: 'List financial years' })
  getFinancialYears(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.companyService.getFinancialYears(id, tenantId);
  }

  @Post(':id/financial-years')
  @RequireCompanyAccess({ source: 'param', key: 'id' })
  @Roles('SUPER_ADMIN', 'TENANT_ADMIN')
  @ApiOperation({ summary: 'Create financial year' })
  createFinancialYear(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() body: { name: string; startDate: string; endDate: string },
  ) {
    return this.companyService.createFinancialYear(id, tenantId, {
      name: body.name,
      startDate: new Date(body.startDate),
      endDate: new Date(body.endDate),
    });
  }

  @Patch(':id/financial-years/:fyId/activate')
  @RequireCompanyAccess({ source: 'param', key: 'id' })
  @Roles('SUPER_ADMIN', 'TENANT_ADMIN')
  @ApiOperation({ summary: 'Set active financial year' })
  setActiveFinancialYear(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Param('fyId') fyId: string,
  ) {
    return this.companyService.setActiveFinancialYear(id, tenantId, fyId);
  }
}
