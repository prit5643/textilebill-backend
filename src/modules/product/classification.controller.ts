import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
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

@ApiTags('Classifications')
@ApiBearerAuth()
@RequireCompanyAccess()
@UseGuards(JwtAuthGuard, SubscriptionGuard, CompanyAccessGuard, RolesGuard)
@Controller('classifications')
export class ClassificationController {
  constructor(private readonly productService: ProductService) {}

  @Post()
  @Roles('SUPER_ADMIN', 'TENANT_ADMIN', 'MANAGER', 'STAFF', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Create a product classification' })
  create(
    @CurrentCompanyId() companyId: string,
    @Body() body: { name: string },
  ) {
    return this.productService.createClassification(companyId, body.name);
  }

  @Get()
  @ApiOperation({ summary: 'List all classifications' })
  findAll(@CurrentCompanyId() companyId: string) {
    return this.productService.findAllClassifications(companyId);
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN', 'TENANT_ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Rename a classification' })
  update(
    @CurrentCompanyId() companyId: string,
    @Param('id') id: string,
    @Body() body: { name: string },
  ) {
    return this.productService.updateClassification(id, companyId, body.name);
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN', 'TENANT_ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Delete a classification' })
  remove(@CurrentCompanyId() companyId: string, @Param('id') id: string) {
    return this.productService.removeClassification(id, companyId);
  }
}
