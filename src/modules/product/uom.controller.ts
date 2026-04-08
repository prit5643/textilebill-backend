import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ProductService } from './product.service';
import {
  CompanyAccessGuard,
  JwtAuthGuard,
  RolesGuard,
  SubscriptionGuard,
} from '../../common/guards';
import {
  CurrentCompanyId,
  RequireCompanyAccess,
  Roles,
} from '../../common/decorators';

@ApiTags('Units of Measurement')
@ApiBearerAuth()
@RequireCompanyAccess()
@UseGuards(JwtAuthGuard, SubscriptionGuard, CompanyAccessGuard, RolesGuard)
@Controller('uoms')
export class UomController {
  constructor(private readonly productService: ProductService) {}

  @Get()
  @ApiOperation({ summary: 'List all units of measurement' })
  findAll(@CurrentCompanyId() companyId: string) {
    return this.productService.findAllUoms(companyId);
  }

  @Post()
  @Roles('SUPER_ADMIN', 'TENANT_ADMIN', 'MANAGER', 'STAFF', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Create a UOM' })
  create(
    @CurrentCompanyId() companyId: string,
    @Body() body: { name: string; fullName?: string },
  ) {
    return this.productService.createUom(companyId, body.name, body.fullName);
  }
}
