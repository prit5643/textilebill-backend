import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { ProductService } from './product.service';
import { CreateProductDto, UpdateProductDto } from './dto';
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

@ApiTags('Products')
@ApiBearerAuth()
@RequireCompanyAccess()
@UseGuards(JwtAuthGuard, SubscriptionGuard, CompanyAccessGuard, RolesGuard)
@Controller('products')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Post()
  @Roles('SUPER_ADMIN', 'TENANT_ADMIN', 'MANAGER', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Create a product' })
  create(@CurrentCompanyId() companyId: string, @Body() dto: CreateProductDto) {
    return this.productService.createProduct(companyId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List products with filters' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'categoryId', required: false })
  @ApiQuery({ name: 'brandId', required: false })
  @ApiQuery({ name: 'type', required: false })
  @ApiQuery({
    name: 'isActive',
    required: false,
    description: 'Optional active-state filter. Accepts true/false (or 1/0).',
  })
  @ApiQuery({
    name: 'view',
    required: false,
    enum: ['default', 'selector'],
    description: 'Use selector for lightweight dropdown payloads.',
  })
  findAll(
    @CurrentCompanyId() companyId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('categoryId') categoryId?: string,
    @Query('brandId') brandId?: string,
    @Query('type') type?: string,
    @Query('isActive') isActive?: string,
    @Query('view') view?: string,
  ) {
    const parsedIsActive =
      isActive === undefined
        ? undefined
        : ['true', '1'].includes(isActive.toLowerCase())
          ? true
          : ['false', '0'].includes(isActive.toLowerCase())
            ? false
            : undefined;

    return this.productService.findAllProducts(companyId, {
      page: page ? +page : undefined,
      limit: limit ? +limit : undefined,
      search,
      categoryId,
      brandId,
      type,
      isActive: parsedIsActive,
      view: view === 'selector' ? 'selector' : 'default',
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get product by ID' })
  findOne(@CurrentCompanyId() companyId: string, @Param('id') id: string) {
    return this.productService.findProductById(id, companyId);
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN', 'TENANT_ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Update a product' })
  update(
    @CurrentCompanyId() companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.productService.updateProduct(id, companyId, dto);
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN', 'TENANT_ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Deactivate a product' })
  remove(@CurrentCompanyId() companyId: string, @Param('id') id: string) {
    return this.productService.removeProduct(id, companyId);
  }

  @Delete(':id/permanent')
  @Roles('SUPER_ADMIN', 'TENANT_ADMIN')
  @ApiOperation({ summary: 'Permanently delete a product (admin only)' })
  removePermanently(
    @CurrentCompanyId() companyId: string,
    @Param('id') id: string,
  ) {
    return this.productService.removeProductPermanently(id, companyId);
  }
}
