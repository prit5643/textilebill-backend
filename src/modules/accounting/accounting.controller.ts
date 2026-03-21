import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { AccountingService } from './accounting.service';
import {
  CreateCashBookEntryDto,
  CreateBankBookEntryDto,
  CreateJournalEntryDto,
  CreateOpeningStockDto,
  CreateStockAdjustmentDto,
  CreateOpeningBalanceDto,
} from './dto';
import {
  CompanyAccessGuard,
  JwtAuthGuard,
  SubscriptionGuard,
} from '../../common/guards';
import {
  CurrentCompanyId,
  RequireCompanyAccess,
} from '../../common/decorators';

@ApiTags('Accounting')
@Controller('accounting')
@RequireCompanyAccess()
@UseGuards(JwtAuthGuard, SubscriptionGuard, CompanyAccessGuard)
@ApiBearerAuth('access-token')
export class AccountingController {
  constructor(private readonly accountingService: AccountingService) {}

  // ─── CASH BOOK ────────────────────────
  @Post(['cash-book', 'cashbook'])
  @ApiOperation({ summary: 'Create cash book entry' })
  async createCashBookEntry(
    @CurrentCompanyId() companyId: string,
    @Body() dto: CreateCashBookEntryDto,
  ) {
    return this.accountingService.createCashBookEntry(companyId, dto);
  }

  @Get(['cash-book', 'cashbook'])
  @ApiOperation({ summary: 'List cash book entries' })
  @ApiQuery({ name: 'bookName', required: false })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getCashBook(
    @CurrentCompanyId() companyId: string,
    @Query('bookName') bookName?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.accountingService.getCashBook(companyId, {
      bookName,
      dateFrom,
      dateTo,
      page,
      limit,
    });
  }

  @Delete(['cash-book/:id', 'cashbook/:id'])
  @ApiOperation({ summary: 'Delete cash book entry' })
  async deleteCashBookEntry(
    @CurrentCompanyId() companyId: string,
    @Param('id') id: string,
  ) {
    return this.accountingService.deleteCashBookEntry(companyId, id);
  }

  // ─── BANK BOOK ────────────────────────
  @Post(['bank-book', 'bankbook'])
  @ApiOperation({ summary: 'Create bank book entry' })
  async createBankBookEntry(
    @CurrentCompanyId() companyId: string,
    @Body() dto: CreateBankBookEntryDto,
  ) {
    return this.accountingService.createBankBookEntry(companyId, dto);
  }

  @Get(['bank-book', 'bankbook'])
  @ApiOperation({ summary: 'List bank book entries' })
  @ApiQuery({ name: 'bookName', required: false })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getBankBook(
    @CurrentCompanyId() companyId: string,
    @Query('bookName') bookName?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.accountingService.getBankBook(companyId, {
      bookName,
      dateFrom,
      dateTo,
      page,
      limit,
    });
  }

  @Delete(['bank-book/:id', 'bankbook/:id'])
  @ApiOperation({ summary: 'Delete bank book entry' })
  async deleteBankBookEntry(
    @CurrentCompanyId() companyId: string,
    @Param('id') id: string,
  ) {
    return this.accountingService.deleteBankBookEntry(companyId, id);
  }

  @Post('bank-book/:id/reconcile')
  @ApiOperation({ summary: 'Mark bank entry as reconciled' })
  async reconcileBankEntry(
    @CurrentCompanyId() companyId: string,
    @Param('id') id: string,
  ) {
    return this.accountingService.reconcileBankEntry(companyId, id);
  }

  // ─── JOURNAL ENTRY ────────────────────
  @Post(['journal-entries', 'journal'])
  @ApiOperation({ summary: 'Create journal entry (DR = CR required)' })
  async createJournalEntry(
    @CurrentCompanyId() companyId: string,
    @Body() dto: CreateJournalEntryDto,
  ) {
    return this.accountingService.createJournalEntry(companyId, dto);
  }

  @Get(['journal-entries', 'journal'])
  @ApiOperation({ summary: 'List journal entries' })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getJournalEntries(
    @CurrentCompanyId() companyId: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.accountingService.getJournalEntries(companyId, {
      dateFrom,
      dateTo,
      page,
      limit,
    });
  }

  @Delete(['journal-entries/:id', 'journal/:id'])
  @ApiOperation({ summary: 'Delete journal entry' })
  async deleteJournalEntry(
    @CurrentCompanyId() companyId: string,
    @Param('id') id: string,
  ) {
    return this.accountingService.deleteJournalEntry(companyId, id);
  }

  // ─── OPENING STOCK ────────────────────
  @Post('opening-balances/products')
  @ApiOperation({ summary: 'Create product opening stock' })
  async createOpeningStock(
    @CurrentCompanyId() companyId: string,
    @Body() dto: CreateOpeningStockDto,
  ) {
    return this.accountingService.createOpeningStock(companyId, dto);
  }

  @Get('opening-balances/products')
  @ApiOperation({ summary: 'List opening stock' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getOpeningStock(
    @CurrentCompanyId() companyId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.accountingService.getOpeningStock(companyId, {
      page,
      limit,
    });
  }

  // ─── STOCK ADJUSTMENT ────────────────────
  @Post('stock-adjustments')
  @ApiOperation({ summary: 'Create stock adjustment' })
  async createStockAdjustment(
    @CurrentCompanyId() companyId: string,
    @Body() dto: CreateStockAdjustmentDto,
  ) {
    return this.accountingService.createStockAdjustment(companyId, dto);
  }

  @Get('stock-adjustments')
  @ApiOperation({ summary: 'List stock adjustments' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getStockAdjustments(
    @CurrentCompanyId() companyId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.accountingService.getStockAdjustments(companyId, {
      page,
      limit,
    });
  }

  // ─── OPENING BALANCE ────────────────────
  @Post('opening-balances/accounts')
  @ApiOperation({ summary: 'Create account opening balance' })
  async createOpeningBalance(
    @CurrentCompanyId() companyId: string,
    @Body() dto: CreateOpeningBalanceDto,
  ) {
    return this.accountingService.createOpeningBalance(companyId, dto);
  }

  // ─── LEDGER ────────────────────
  @Get('ledger')
  @ApiOperation({ summary: 'Get ledger entries with running balance' })
  @ApiQuery({ name: 'accountId', required: false })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getLedger(
    @CurrentCompanyId() companyId: string,
    @Query('accountId') accountId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.accountingService.getLedger(companyId, {
      accountId,
      dateFrom,
      dateTo,
      page,
      limit,
    });
  }

  @Get('ledger/summary')
  @ApiOperation({ summary: 'Get ledger summary (account-wise totals)' })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  async getLedgerSummary(
    @CurrentCompanyId() companyId: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.accountingService.getLedgerSummary(companyId, {
      dateFrom,
      dateTo,
    });
  }

  @Get('invoices/outstanding')
  @ApiOperation({ summary: 'Get outstanding invoices for an account' })
  @ApiQuery({ name: 'accountId', required: true })
  async getOutstandingInvoices(
    @CurrentCompanyId() companyId: string,
    @Query('accountId') accountId: string,
  ) {
    return this.accountingService.getOutstandingInvoices(companyId, accountId);
  }
}
