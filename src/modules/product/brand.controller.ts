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

@ApiTags('Brands')
@ApiBearerAuth()
@RequireCompanyAccess()
@UseGuards(JwtAuthGuard, SubscriptionGuard, CompanyAccessGuard, RolesGuard)
@Controller('brands')
export class BrandController {
  constructor(private readonly productService: ProductService) {}

  @Post()
  @Roles('SUPER_ADMIN', 'TENANT_ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Create a brand' })
  create(
    @CurrentCompanyId() companyId: string,
    @Body() body: { name: string },
  ) {
    return this.productService.createBrand(companyId, body.name);
  }

  @Get()
  @ApiOperation({ summary: 'List all brands' })
  findAll(@CurrentCompanyId() companyId: string) {
    return this.productService.findAllBrands(companyId);
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN', 'TENANT_ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Rename a brand' })
  update(
    @CurrentCompanyId() companyId: string,
    @Param('id') id: string,
    @Body() body: { name: string },
  ) {
    return this.productService.updateBrand(id, companyId, body.name);
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN', 'TENANT_ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Delete a brand' })
  remove(@CurrentCompanyId() companyId: string, @Param('id') id: string) {
    return this.productService.removeBrand(id, companyId);
  }
}
