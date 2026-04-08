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

@ApiTags('Categories')
@ApiBearerAuth()
@RequireCompanyAccess()
@UseGuards(JwtAuthGuard, SubscriptionGuard, CompanyAccessGuard, RolesGuard)
@Controller('categories')
export class CategoryController {
  constructor(private readonly productService: ProductService) {}

  @Post()
  @Roles('SUPER_ADMIN', 'TENANT_ADMIN', 'MANAGER', 'STAFF', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Create a product category' })
  create(
    @CurrentCompanyId() companyId: string,
    @Body() body: { name: string },
  ) {
    return this.productService.createCategory(companyId, body.name);
  }

  @Get()
  @ApiOperation({ summary: 'List all categories' })
  findAll(@CurrentCompanyId() companyId: string) {
    return this.productService.findAllCategories(companyId);
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN', 'TENANT_ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Rename a category' })
  update(
    @CurrentCompanyId() companyId: string,
    @Param('id') id: string,
    @Body() body: { name: string },
  ) {
    return this.productService.updateCategory(id, companyId, body.name);
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN', 'TENANT_ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Delete a category' })
  remove(@CurrentCompanyId() companyId: string, @Param('id') id: string) {
    return this.productService.removeCategory(id, companyId);
  }
}
