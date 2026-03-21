import { Module } from '@nestjs/common';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { BrokerController } from './broker.controller';
import { AccountGroupController } from './account-group.controller';

@Module({
  controllers: [AccountController, BrokerController, AccountGroupController],
  providers: [AccountService],
  exports: [AccountService],
})
export class AccountModule {}
