import { Module } from '@nestjs/common';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';
import { ExpenseUploadsController } from './expense-uploads.controller';

@Module({
  controllers: [ExpensesController, ExpenseUploadsController],
  providers: [ExpensesService],
  exports: [ExpensesService],
})
export class ExpensesModule {}
