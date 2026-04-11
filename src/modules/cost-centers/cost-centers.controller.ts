import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  CompanyAccessGuard,
  JwtAuthGuard,
  RolesGuard,
  SubscriptionGuard,
} from '../../common/guards';
import { CurrentCompanyId, RequireCompanyAccess } from '../../common/decorators';
import { CostCentersService } from './cost-centers.service';
import { CreateCostAllocationDto, CreateCostCenterDto } from './dto';

@ApiTags('Cost Centers')
@ApiBearerAuth('access-token')
@RequireCompanyAccess()
@UseGuards(JwtAuthGuard, SubscriptionGuard, CompanyAccessGuard, RolesGuard)
@Controller('cost-centers')
export class CostCentersController {
  constructor(private readonly costCentersService: CostCentersService) {}

  @Get()
  @ApiOperation({ summary: 'List cost centers' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'isActive', required: false })
  listCostCenters(
    @CurrentCompanyId() companyId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.costCentersService.listCostCenters(companyId, {
      page: page ? +page : undefined,
      limit: limit ? +limit : undefined,
      search,
      isActive,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get cost center by id' })
  getCostCenter(
    @CurrentCompanyId() companyId: string,
    @Param('id') id: string,
  ) {
    return this.costCentersService.getCostCenter(companyId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create cost center' })
  createCostCenter(
    @CurrentCompanyId() companyId: string,
    @Body() dto: CreateCostCenterDto,
  ) {
    return this.costCentersService.createCostCenter(companyId, dto);
  }

  @Get(':id/allocations')
  @ApiOperation({ summary: 'List cost allocations' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  listAllocations(
    @CurrentCompanyId() companyId: string,
    @Param('id') costCenterId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.costCentersService.listAllocations(companyId, costCenterId, {
      page: page ? +page : undefined,
      limit: limit ? +limit : undefined,
    });
  }

  @Post(':id/allocations')
  @ApiOperation({ summary: 'Create cost allocation' })
  createAllocation(
    @CurrentCompanyId() companyId: string,
    @Param('id') costCenterId: string,
    @Body() dto: CreateCostAllocationDto,
  ) {
    return this.costCentersService.createAllocation(companyId, costCenterId, dto);
  }
}
