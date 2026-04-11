import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { ReportService } from './report.service';
import {
  CompanyAccessGuard,
  JwtAuthGuard,
  SubscriptionGuard,
} from '../../common/guards';
import {
  CurrentCompanyId,
  RequireCompanyAccess,
} from '../../common/decorators';

@ApiTags('Reports')
@Controller('reports')
@RequireCompanyAccess()
@UseGuards(JwtAuthGuard, SubscriptionGuard, CompanyAccessGuard)
@ApiBearerAuth('access-token')
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  // ─── DASHBOARD ────────────────────
  @Get('dashboard')
  @ApiOperation({ summary: 'Get dashboard KPIs' })
  async getDashboardKpis(@CurrentCompanyId() companyId: string) {
    return this.reportService.getDashboardKpis(companyId);
  }

  @Get('monthly-chart')
  @ApiOperation({ summary: 'Monthly sales/purchases chart data' })
  @ApiQuery({ name: 'year', required: false, type: Number })
  async getMonthlySalesChart(
    @CurrentCompanyId() companyId: string,
    @Query('year') year?: number,
  ) {
    return this.reportService.getMonthlySalesChart(
      companyId,
      year || new Date().getFullYear(),
    );
  }

  // ─── OUTSTANDING ────────────────────
  @Get('outstanding/debtors')
  @ApiOperation({ summary: 'Outstanding receivables by customer' })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  async getOutstandingDebtors(
    @CurrentCompanyId() companyId: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.reportService.getOutstandingDebtors(companyId, {
      dateFrom,
      dateTo,
    });
  }

  @Get('outstanding/creditors')
  @ApiOperation({ summary: 'Outstanding payables by supplier' })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  async getOutstandingCreditors(
    @CurrentCompanyId() companyId: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.reportService.getOutstandingCreditors(companyId, {
      dateFrom,
      dateTo,
    });
  }

  @Get('day-book')
  @ApiOperation({ summary: 'Day book — all transactions for a date' })
  @ApiQuery({ name: 'date', required: true })
  async getDayBook(
    @CurrentCompanyId() companyId: string,
    @Query('date') date: string,
  ) {
    return this.reportService.getDayBook(companyId, date);
  }

  // ─── STOCK REPORTS ────────────────────
  @Get('stock')
  @ApiOperation({
    summary: 'Stock report (opening/in/out/closing per product)',
  })
  @ApiQuery({ name: 'productId', required: false })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  async getStockReport(
    @CurrentCompanyId() companyId: string,
    @Query('productId') productId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.reportService.getStockReport(companyId, {
      productId,
      dateFrom,
      dateTo,
    });
  }

  @Get('profit-fifo')
  @ApiOperation({ summary: 'Product profit report (FIFO method)' })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  async getProfitByProductFifo(
    @CurrentCompanyId() companyId: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.reportService.getProfitByProductFifo(companyId, {
      dateFrom,
      dateTo,
    });
  }

  // ─── PRODUCT REPORTS ────────────────────
  @Get('product-details')
  @ApiOperation({ summary: 'Product transaction details' })
  @ApiQuery({ name: 'productId', required: false })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  async getProductDetails(
    @CurrentCompanyId() companyId: string,
    @Query('productId') productId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.reportService.getProductDetails(companyId, {
      productId,
      dateFrom,
      dateTo,
    });
  }

  @Get('product-details-by-customer')
  @ApiOperation({ summary: 'Product details grouped by customer' })
  @ApiQuery({ name: 'productId', required: true })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  async getProductDetailsByCustomer(
    @CurrentCompanyId() companyId: string,
    @Query('productId') productId: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.reportService.getProductDetailsByCustomer(companyId, {
      productId,
      dateFrom,
      dateTo,
    });
  }

  // ─── GST REPORTS ────────────────────
  @Get('gstr1')
  @ApiOperation({ summary: 'GSTR-1 report (outward supplies)' })
  @ApiQuery({ name: 'dateFrom', required: true })
  @ApiQuery({ name: 'dateTo', required: true })
  async getGstr1(
    @CurrentCompanyId() companyId: string,
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
  ) {
    return this.reportService.getGstr1(companyId, {
      dateFrom,
      dateTo,
    });
  }

  @Get('gstr3b')
  @ApiOperation({ summary: 'GSTR-3B summary return' })
  @ApiQuery({ name: 'dateFrom', required: true })
  @ApiQuery({ name: 'dateTo', required: true })
  async getGstr3b(
    @CurrentCompanyId() companyId: string,
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
  ) {
    return this.reportService.getGstr3b(companyId, {
      dateFrom,
      dateTo,
    });
  }

  @Get('gst-slab-wise')
  @ApiOperation({ summary: 'GST slab-wise breakup' })
  @ApiQuery({ name: 'dateFrom', required: true })
  @ApiQuery({ name: 'dateTo', required: true })
  async getGstSlabWise(
    @CurrentCompanyId() companyId: string,
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
  ) {
    return this.reportService.getGstSlabWise(companyId, {
      dateFrom,
      dateTo,
    });
  }

  // ─── FINANCIAL REPORTS ────────────────────
  @Get('trial-balance')
  @ApiOperation({ summary: 'Trial Balance' })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  async getTrialBalance(
    @CurrentCompanyId() companyId: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.reportService.getTrialBalance(companyId, {
      dateFrom,
      dateTo,
    });
  }

  @Get('profit-loss')
  @ApiOperation({ summary: 'Profit & Loss statement' })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  async getProfitAndLoss(
    @CurrentCompanyId() companyId: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.reportService.getProfitAndLoss(companyId, {
      dateFrom,
      dateTo,
    });
  }

  @Get('balance-sheet')
  @ApiOperation({ summary: 'Balance Sheet' })
  @ApiQuery({ name: 'dateTo', required: false })
  async getBalanceSheet(
    @CurrentCompanyId() companyId: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.reportService.getBalanceSheet(companyId, { dateTo });
  }
}
