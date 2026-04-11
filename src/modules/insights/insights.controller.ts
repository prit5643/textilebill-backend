import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CompanyAccessGuard,
  JwtAuthGuard,
  RolesGuard,
  SubscriptionGuard,
} from '../../common/guards';
import { CurrentCompanyId, RequireCompanyAccess } from '../../common/decorators';
import { InsightsService } from './insights.service';

@ApiTags('AI Insights')
@ApiBearerAuth('access-token')
@RequireCompanyAccess()
@UseGuards(JwtAuthGuard, SubscriptionGuard, CompanyAccessGuard, RolesGuard)
@Controller('ai/insights')
export class InsightsController {
  constructor(private readonly insightsService: InsightsService) {}

  @Get('expense-anomalies')
  @ApiOperation({ summary: 'Expense anomaly insights' })
  getExpenseAnomalies(@CurrentCompanyId() companyId: string) {
    return this.insightsService.getExpenseAnomalies(companyId);
  }

  @Get('cost-hotspots')
  @ApiOperation({ summary: 'Cost hotspot insights' })
  getCostHotspots(@CurrentCompanyId() companyId: string) {
    return this.insightsService.getCostHotspots(companyId);
  }

  @Get('salary-advance-risk')
  @ApiOperation({ summary: 'Salary advance risk insights' })
  getSalaryAdvanceRisk(@CurrentCompanyId() companyId: string) {
    return this.insightsService.getSalaryAdvanceRisk(companyId);
  }

  @Get('margin-leakage')
  @ApiOperation({ summary: 'Margin leakage insights' })
  getMarginLeakage(@CurrentCompanyId() companyId: string) {
    return this.insightsService.getMarginLeakage(companyId);
  }
}
