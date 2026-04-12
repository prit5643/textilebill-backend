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
  create(@Body() createWorkOrderDto: CreateWorkOrderDto, @Req() req: Request) {
    const userId = req.user['sub'];
    return this.workOrderService.createWorkOrder(createWorkOrderDto, userId);
  }

  @Get()
  findAll(
    @Query('status') status?: string,
    @Query('companyId') companyId?: string,
  ) {
    const params: any = {};
    if (status) params.status = status;
    if (companyId) params.companyId = companyId;
    return this.workOrderService.getWorkOrders(params);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.workOrderService.getWorkOrderById(id);
  }

  @Post(':id/split')
  @HttpCode(HttpStatus.OK)
  split(
    @Param('id') id: string,
    @Body() splitDto: SplitWorkOrderDto,
    @Req() req: Request,
  ) {
    const userId = req.user['sub'];
    return this.workOrderService.splitWorkOrder(id, splitDto, userId);
  }

  @Post(':id/link-invoice')
  @HttpCode(HttpStatus.OK)
  linkInvoice(
    @Param('id') id: string,
    @Body() linkDto: LinkInvoiceDto,
    @Req() req: Request,
  ) {
    const userId = req.user['sub'];
    return this.workOrderService.linkInvoice(id, linkDto, userId);
  }

  @Post(':id/loss-incidents')
  createLossIncident(
    @Param('id') id: string,
    @Body() lossDto: CreateLossIncidentDto,
    @Req() req: Request,
  ) {
    const userId = req.user['sub'];
    return this.workOrderService.recordLossIncident(id, lossDto, userId);
  }

  @Post('loss-incidents/:incidentId/retry')
  @HttpCode(HttpStatus.OK)
  retryLossIncident(
    @Param('incidentId') incidentId: string,
    @Req() req: Request,
  ) {
    const userId = req.user['sub'];
    return this.workOrderService.retryLossIncident(incidentId, userId);
  }

  @Post('loss-incidents/:incidentId/reverse')
  @HttpCode(HttpStatus.OK)
  reverseLossIncident(
    @Param('incidentId') incidentId: string,
    @Req() req: Request,
  ) {
    const userId = req.user['sub'];
    return this.workOrderService.reverseLossIncident(incidentId, userId);
  }

  @Patch(':id/close')
  @HttpCode(HttpStatus.OK)
  close(
    @Param('id') id: string,
    @Body() closeDto: CloseWorkOrderDto,
    @Req() req: Request,
  ) {
    const userId = req.user['sub'];
    return this.workOrderService.closeWorkOrder(id, closeDto, userId);
  }

  @Get(':id/profitability')
  getProfitability(@Param('id') id: string) {
    return this.workOrderService.getWorkOrderProfitability(id);
  }
}
