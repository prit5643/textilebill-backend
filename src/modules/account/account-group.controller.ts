import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AccountService } from './account.service';
import { JwtAuthGuard, SubscriptionGuard } from '../../common/guards';

@ApiTags('Account Groups')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, SubscriptionGuard)
@Controller('account-groups')
export class AccountGroupController {
  constructor(private readonly accountService: AccountService) {}

  @Get()
  @ApiOperation({ summary: 'List all account groups (tree)' })
  findAll() {
    return this.accountService.findAllGroups();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get account group by ID' })
  findOne(@Param('id') id: string) {
    return this.accountService.findGroupById(id);
  }
}
