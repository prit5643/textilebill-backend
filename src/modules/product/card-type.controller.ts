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

@ApiTags('Card Types')
@ApiBearerAuth()
@RequireCompanyAccess()
@UseGuards(JwtAuthGuard, SubscriptionGuard, CompanyAccessGuard, RolesGuard)
@Controller('card-types')
export class CardTypeController {
  constructor(private readonly productService: ProductService) {}

  @Post()
  @Roles('SUPER_ADMIN', 'TENANT_ADMIN', 'MANAGER', 'STAFF', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Create a product card type' })
  create(
    @CurrentCompanyId() companyId: string,
    @Body() body: { name: string },
  ) {
    return this.productService.createCardType(companyId, body.name);
  }

  @Get()
  @ApiOperation({ summary: 'List all card types' })
  findAll(@CurrentCompanyId() companyId: string) {
    return this.productService.findAllCardTypes(companyId);
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN', 'TENANT_ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Rename a card type' })
  update(
    @CurrentCompanyId() companyId: string,
    @Param('id') id: string,
    @Body() body: { name: string },
  ) {
    return this.productService.updateCardType(id, companyId, body.name);
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN', 'TENANT_ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Delete a card type' })
  remove(@CurrentCompanyId() companyId: string, @Param('id') id: string) {
    return this.productService.removeCardType(id, companyId);
  }
}
