import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import {
  CompanyAccessGuard,
  JwtAuthGuard,
  SubscriptionGuard,
} from '../../common/guards';
import {
  CurrentCompanyId,
  RequireCompanyAccess,
} from '../../common/decorators';
import { InvoiceNumberService } from './invoice-number.service';
import {
  CreateInvoiceNumberConfigDto,
  UpdateInvoiceNumberConfigDto,
} from './dto';

@Controller('invoice-number-configs')
@RequireCompanyAccess()
@UseGuards(JwtAuthGuard, SubscriptionGuard, CompanyAccessGuard)
export class InvoiceNumberConfigController {
  constructor(private readonly service: InvoiceNumberService) {}

  @Get()
  findAll(@CurrentCompanyId() companyId: string) {
    return this.service.findAll(companyId);
  }

  @Post()
  create(
    @CurrentCompanyId() companyId: string,
    @Body() dto: CreateInvoiceNumberConfigDto,
  ) {
    return this.service.create(companyId, dto);
  }

  @Put(':id')
  update(
    @CurrentCompanyId() companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateInvoiceNumberConfigDto,
  ) {
    return this.service.update(companyId, id, dto);
  }
}
