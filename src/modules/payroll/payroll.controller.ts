import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  CompanyAccessGuard,
  JwtAuthGuard,
  RolesGuard,
  SubscriptionGuard,
} from '../../common/guards';
import { CurrentCompanyId, RequireCompanyAccess } from '../../common/decorators';
import {
  CreateSalaryAdvanceDto,
  CreateSalaryProfileDto,
  MarkSalarySettlementPaidDto,
  RunSalarySettlementDto,
} from './dto';
import { PayrollService } from './payroll.service';

@ApiTags('Payroll')
@ApiBearerAuth('access-token')
@RequireCompanyAccess()
@UseGuards(JwtAuthGuard, SubscriptionGuard, CompanyAccessGuard, RolesGuard)
@Controller('payroll')
export class PayrollController {
  constructor(private readonly payrollService: PayrollService) {}

  @Get('salary-profiles')
  @ApiOperation({ summary: 'List salary profiles' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'isActive', required: false })
  listSalaryProfiles(
    @CurrentCompanyId() companyId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.payrollService.listSalaryProfiles(companyId, {
      page: page ? +page : undefined,
      limit: limit ? +limit : undefined,
      search,
      isActive,
    });
  }

  @Post('salary-profiles')
  @ApiOperation({ summary: 'Create salary profile' })
  createSalaryProfile(
    @CurrentCompanyId() companyId: string,
    @Body() dto: CreateSalaryProfileDto,
  ) {
    return this.payrollService.createSalaryProfile(companyId, dto);
  }

  @Get('advances')
  @ApiOperation({ summary: 'List salary advances' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'search', required: false })
  listSalaryAdvances(
    @CurrentCompanyId() companyId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
  ) {
    return this.payrollService.listSalaryAdvances(companyId, {
      page: page ? +page : undefined,
      limit: limit ? +limit : undefined,
      search,
    });
  }

  @Post('advances')
  @ApiOperation({ summary: 'Create salary advance' })
  createSalaryAdvance(
    @CurrentCompanyId() companyId: string,
    @Body() dto: CreateSalaryAdvanceDto,
  ) {
    return this.payrollService.createSalaryAdvance(companyId, dto);
  }

  @Post('settlements/run')
  @ApiOperation({ summary: 'Run salary settlement (preview or finalize)' })
  runSettlement(
    @CurrentCompanyId() companyId: string,
    @Body() dto: RunSalarySettlementDto,
  ) {
    return this.payrollService.runSettlement(companyId, dto);
  }

  @Get('settlements')
  @ApiOperation({ summary: 'List salary settlements' })
  @ApiQuery({ name: 'year', required: false })
  @ApiQuery({ name: 'month', required: false })
  listSettlements(
    @CurrentCompanyId() companyId: string,
    @Query('year') year?: number,
    @Query('month') month?: number,
  ) {
    return this.payrollService.listSettlements(companyId, {
      year: year ? +year : undefined,
      month: month ? +month : undefined,
    });
  }

  @Post('settlements/:id/mark-paid')
  @ApiOperation({ summary: 'Mark salary settlement paid' })
  markSettlementPaid(
    @CurrentCompanyId() companyId: string,
    @Param('id') id: string,
    @Body() dto: MarkSalarySettlementPaidDto,
  ) {
    return this.payrollService.markSettlementPaid(companyId, id, dto);
  }
}
