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
import { AccountService } from './account.service';
import { CreateBrokerDto, UpdateBrokerDto } from './dto';
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

@ApiTags('Brokers')
@ApiBearerAuth()
@RequireCompanyAccess()
@UseGuards(JwtAuthGuard, SubscriptionGuard, CompanyAccessGuard, RolesGuard)
@Controller('brokers')
export class BrokerController {
  constructor(private readonly accountService: AccountService) {}

  @Post()
  @Roles('SUPER_ADMIN', 'TENANT_ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Create a broker' })
  create(@CurrentCompanyId() companyId: string, @Body() dto: CreateBrokerDto) {
    return this.accountService.createBroker(companyId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all brokers' })
  findAll(@CurrentCompanyId() companyId: string) {
    return this.accountService.findAllBrokers(companyId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get broker by ID' })
  findOne(@CurrentCompanyId() companyId: string, @Param('id') id: string) {
    return this.accountService.findBrokerById(id, companyId);
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN', 'TENANT_ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Update a broker' })
  update(
    @CurrentCompanyId() companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateBrokerDto,
  ) {
    return this.accountService.updateBroker(id, companyId, dto);
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN', 'TENANT_ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Deactivate a broker' })
  remove(@CurrentCompanyId() companyId: string, @Param('id') id: string) {
    return this.accountService.removeBroker(id, companyId);
  }
}
