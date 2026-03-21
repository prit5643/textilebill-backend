import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ProductService } from './product.service';
import {
  JwtAuthGuard,
  RolesGuard,
  SubscriptionGuard,
} from '../../common/guards';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('Units of Measurement')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, SubscriptionGuard, RolesGuard)
@Controller('uoms')
export class UomController {
  constructor(private readonly productService: ProductService) {}

  @Get()
  @ApiOperation({ summary: 'List all units of measurement' })
  findAll() {
    return this.productService.findAllUoms();
  }

  @Post()
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Create a UOM (admin only)' })
  create(@Body() body: { name: string; fullName?: string }) {
    return this.productService.createUom(body.name, body.fullName);
  }
}
