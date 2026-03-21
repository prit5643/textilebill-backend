import { Module } from '@nestjs/common';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';
import { VoucherNumberService } from './voucher-number.service';

@Module({
  controllers: [AccountingController],
  providers: [AccountingService, VoucherNumberService],
  exports: [AccountingService, VoucherNumberService],
})
export class AccountingModule {}
