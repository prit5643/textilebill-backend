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
import { AccountService } from './account.service';
import { CreateAccountDto, UpdateAccountDto } from './dto';
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

@ApiTags('Accounts (Parties)')
@ApiBearerAuth()
@RequireCompanyAccess()
@UseGuards(JwtAuthGuard, SubscriptionGuard, CompanyAccessGuard, RolesGuard)
@Controller('accounts')
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @Post()
  @Roles('SUPER_ADMIN', 'TENANT_ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Create an account (customer / supplier)' })
  create(@CurrentCompanyId() companyId: string, @Body() dto: CreateAccountDto) {
    return this.accountService.createAccount(companyId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List accounts with filters' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'groupId', required: false })
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
    @Query('groupId') groupId?: string,
    @Query('view') view?: string,
  ) {
    return this.accountService.findAllAccounts(companyId, {
      page: page ? +page : undefined,
      limit: limit ? +limit : undefined,
      search,
      groupId,
      view: view === 'selector' ? 'selector' : 'default',
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get account by ID' })
  findOne(@CurrentCompanyId() companyId: string, @Param('id') id: string) {
    return this.accountService.findAccountById(id, companyId);
  }

  @Patch(':id/activate')
  @Roles('SUPER_ADMIN', 'TENANT_ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Re-activate a deactivated account' })
  activate(@CurrentCompanyId() companyId: string, @Param('id') id: string) {
    return this.accountService.activateAccount(id, companyId);
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN', 'TENANT_ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Update an account' })
  update(
    @CurrentCompanyId() companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateAccountDto,
  ) {
    return this.accountService.updateAccount(id, companyId, dto);
  }

  @Delete(':id/permanent')
  @Roles('SUPER_ADMIN', 'TENANT_ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Permanently delete an account (admin only)' })
  removePermanently(
    @CurrentCompanyId() companyId: string,
    @Param('id') id: string,
  ) {
    return this.accountService.removeAccountPermanently(id, companyId);
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN', 'TENANT_ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Deactivate an account' })
  remove(@CurrentCompanyId() companyId: string, @Param('id') id: string) {
    return this.accountService.removeAccount(id, companyId);
  }
}
