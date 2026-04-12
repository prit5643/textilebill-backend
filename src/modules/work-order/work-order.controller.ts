import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { WorkOrderService } from './work-order.service';
import { CreateWorkOrderDto } from './dto/create-work-order.dto';
import { SplitWorkOrderDto } from './dto/split-work-order.dto';
import { LinkInvoiceDto } from './dto/link-invoice.dto';
import { CreateLossIncidentDto } from './dto/create-loss-incident.dto';
import { CloseWorkOrderDto } from './dto/close-work-order.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CompanyAccessGuard } from '../../common/guards/company-access.guard';
import { CurrentCompanyId, RequireCompanyAccess } from '../../common/decorators';
import { Request } from 'express';

@Controller('work-orders')
@RequireCompanyAccess()
@UseGuards(JwtAuthGuard, CompanyAccessGuard)
export class WorkOrderController {
  constructor(private readonly workOrderService: WorkOrderService) {}

  @Post()
  create(
    @CurrentCompanyId() companyId: string,
    @Body() createWorkOrderDto: CreateWorkOrderDto,
    @Req() req: Request,
  ) {
    const userId = (req.user as any)?.sub;
    return this.workOrderService.create(companyId, userId, createWorkOrderDto);
  }

  @Get()
  findAll(
    @CurrentCompanyId() companyId: string,
    @Query('status') status?: any,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
  ) {
    return this.workOrderService.list(companyId, { page, limit, status });
  }

  @Get(':id')
  findOne(
    @CurrentCompanyId() companyId: string,
    @Param('id') id: string,
  ) {
    return this.workOrderService.findById(companyId, id);
  }

  @Post(':id/split')
  @HttpCode(HttpStatus.OK)
  split(
    @CurrentCompanyId() companyId: string,
    @Param('id') id: string,
    @Body() splitDto: SplitWorkOrderDto,
    @Req() req: Request,
  ) {
    const userId = (req.user as any)?.sub;
    return this.workOrderService.splitWorkOrder(companyId, id, userId, splitDto);
  }

  @Post(':id/link-sale-invoice')
  @HttpCode(HttpStatus.OK)
  linkSaleInvoice(
    @CurrentCompanyId() companyId: string,
    @Param('id') id: string,
    @Body() linkDto: LinkInvoiceDto,
    @Req() req: Request,
  ) {
    const userId = (req.user as any)?.sub;
    return this.workOrderService.linkSaleInvoice(companyId, id, userId, linkDto);
  }

  @Post(':id/link-purchase-invoice')
  @HttpCode(HttpStatus.OK)
  linkPurchaseInvoice(
    @CurrentCompanyId() companyId: string,
    @Body() linkDto: any,
    @Req() req: Request,
  ) {
    const userId = (req.user as any)?.sub;
    return this.workOrderService.linkPurchaseInvoice(companyId, linkDto.workOrderLotId, userId, linkDto);
  }

  @Post(':id/loss-incidents')
  createLossIncident(
    @CurrentCompanyId() companyId: string,
    @Param('id') id: string,
    @Body() lossDto: CreateLossIncidentDto,
    @Req() req: Request,
  ) {
    const userId = (req.user as any)?.sub;
    // ensure workOrderId is on dto
    return this.workOrderService.createLossIncident(companyId, id, userId, lossDto);
  }

  @Post('loss-incidents/:incidentId/retry')
  @HttpCode(HttpStatus.OK)
  retryLossIncident(
    @CurrentCompanyId() companyId: string,
    @Param('incidentId') incidentId: string,
    @Req() req: Request,
  ) {
    const userId = (req.user as any)?.sub;
    return this.workOrderService.retryLossAdjustment(companyId, incidentId, userId);
  }

  @Post('loss-incidents/:incidentId/reverse')
  @HttpCode(HttpStatus.OK)
  reverseLossIncident(
    @CurrentCompanyId() companyId: string,
    @Param('incidentId') incidentId: string,
    @Req() req: Request,
  ) {
    const userId = (req.user as any)?.sub;
    return this.workOrderService.reverseLossIncident(companyId, incidentId, userId);
  }

  @Patch(':id/close')
  @HttpCode(HttpStatus.OK)
  close(
    @CurrentCompanyId() companyId: string,
    @Param('id') id: string,
    @Body() closeDto: CloseWorkOrderDto,
    @Req() req: Request,
  ) {
    const userId = (req.user as any)?.sub;
    return this.workOrderService.closeWorkOrder(companyId, id, userId, closeDto);
  }

  @Get(':id/profitability')
  getProfitability(
    @CurrentCompanyId() companyId: string,
    @Param('id') id: string,
  ) {
    return this.workOrderService.getWorkOrderProfitability(companyId, id);
  }
}
