import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  CompanyAccessGuard,
  JwtAuthGuard,
  RolesGuard,
  SubscriptionGuard,
} from '../../common/guards';
import {
  CurrentCompanyId,
  CurrentUser,
  RequireCompanyAccess,
  Roles,
} from '../../common/decorators';
import { WorkOrderService } from './work-order.service';
import {
  CloseWorkOrderDto,
  CreateLossIncidentDto,
  CreateWorkOrderDto,
  LinkPurchaseInvoiceDto,
  LinkSaleInvoiceDto,
  ListWorkOrdersDto,
  ReverseLossIncidentDto,
  SplitWorkOrderDto,
  WorkOrderReportQueryDto,
} from './dto';

@Controller('work-orders')
@RequireCompanyAccess()
@UseGuards(JwtAuthGuard, SubscriptionGuard, CompanyAccessGuard, RolesGuard)
export class WorkOrderController {
  constructor(private readonly workOrderService: WorkOrderService) {}

  @Post()
  @Roles('SUPER_ADMIN', 'TENANT_ADMIN', 'MANAGER', 'STAFF')
  create(
    @CurrentCompanyId() companyId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateWorkOrderDto,
  ) {
    return this.workOrderService.create(companyId, userId, dto);
  }

  @Get()
  findAll(
    @CurrentCompanyId() companyId: string,
    @Query() query: ListWorkOrdersDto,
  ) {
    return this.workOrderService.findAll(companyId, query);
  }

  @Post(':id/split')
  @Roles('SUPER_ADMIN', 'TENANT_ADMIN', 'MANAGER', 'STAFF')
  split(
    @CurrentCompanyId() companyId: string,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: SplitWorkOrderDto,
  ) {
    return this.workOrderService.split(companyId, id, userId, dto);
  }

  @Post(':id/invoices/link-sale')
  @Roles('SUPER_ADMIN', 'TENANT_ADMIN', 'MANAGER', 'STAFF')
  linkSaleInvoice(
    @CurrentCompanyId() companyId: string,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: LinkSaleInvoiceDto,
  ) {
    return this.workOrderService.linkSaleInvoice(
      companyId,
      id,
      dto.invoiceId,
      userId,
    );
  }

  @Post('lots/:lotId/invoices/link-purchase')
  @Roles('SUPER_ADMIN', 'TENANT_ADMIN', 'MANAGER', 'STAFF')
  linkPurchaseInvoice(
    @CurrentCompanyId() companyId: string,
    @CurrentUser('id') userId: string,
    @Param('lotId') lotId: string,
    @Body() dto: LinkPurchaseInvoiceDto,
  ) {
    return this.workOrderService.linkPurchaseInvoice(
      companyId,
      lotId,
      dto.invoiceId,
      userId,
    );
  }

  @Post(':id/loss-incidents')
  @Roles('SUPER_ADMIN', 'TENANT_ADMIN', 'MANAGER', 'STAFF')
  createLossIncident(
    @CurrentCompanyId() companyId: string,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: CreateLossIncidentDto,
  ) {
    return this.workOrderService.createLossIncident(companyId, id, userId, dto);
  }

  @Get(':id/loss-incidents')
  listLossIncidents(
    @CurrentCompanyId() companyId: string,
    @Param('id') id: string,
  ) {
    return this.workOrderService.listLossIncidents(companyId, id);
  }

  @Post('loss-incidents/:id/retry-adjustment')
  @Roles('SUPER_ADMIN', 'TENANT_ADMIN', 'MANAGER', 'STAFF')
  retryLossIncidentAdjustment(
    @CurrentCompanyId() companyId: string,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.workOrderService.retryLossIncidentAdjustment(
      companyId,
      id,
      userId,
    );
  }

  @Post('loss-incidents/:id/reverse')
  @Roles('SUPER_ADMIN', 'TENANT_ADMIN', 'MANAGER')
  reverseLossIncident(
    @CurrentCompanyId() companyId: string,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: ReverseLossIncidentDto,
  ) {
    return this.workOrderService.reverseLossIncident(
      companyId,
      id,
      userId,
      dto.reason,
    );
  }

  @Post(':id/close')
  @Roles('SUPER_ADMIN', 'TENANT_ADMIN', 'MANAGER', 'STAFF')
  close(
    @CurrentCompanyId() companyId: string,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: CloseWorkOrderDto,
  ) {
    return this.workOrderService.close(companyId, id, userId, dto);
  }

  @Get('reports/monthly-profit-summary')
  monthlyProfitSummary(
    @CurrentCompanyId() companyId: string,
    @Query() query: WorkOrderReportQueryDto,
  ) {
    return this.workOrderService.getMonthlyProfitSummary(companyId, query);
  }

  @Get('reports/vendor-margin-risk')
  vendorMarginRisk(
    @CurrentCompanyId() companyId: string,
    @Query() query: WorkOrderReportQueryDto,
  ) {
    return this.workOrderService.getVendorMarginRisk(companyId, query);
  }

  @Get(':id/profitability')
  getProfitability(
    @CurrentCompanyId() companyId: string,
    @Param('id') id: string,
  ) {
    return this.workOrderService.getProfitability(companyId, id);
  }

  @Get(':id')
  findOne(@CurrentCompanyId() companyId: string, @Param('id') id: string) {
    return this.workOrderService.findById(companyId, id);
  }
}
