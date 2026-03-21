import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, VoucherSeries } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import {
  CreateCashBookEntryDto,
  CreateBankBookEntryDto,
  CreateJournalEntryDto,
  CreateOpeningStockDto,
  CreateStockAdjustmentDto,
  CreateOpeningBalanceDto,
} from './dto';
import {
  parsePagination,
  createPaginatedResult,
} from '../../common/utils/pagination.util';
import { VoucherNumberService } from './voucher-number.service';

@Injectable()
export class AccountingService {
  private readonly logger = new Logger(AccountingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly voucherNumberService: VoucherNumberService,
  ) {}

  // ═══════════════ CASH BOOK ═══════════════

  async createCashBookEntry(companyId: string, dto: CreateCashBookEntryDto) {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const entryDate = new Date(dto.date);
      const voucherNumber = await this.allocateVoucherNumber(
        tx,
        companyId,
        'CB',
        entryDate,
      );

      const entry = await tx.cashBookEntry.create({
        data: {
          companyId,
          bookName: dto.bookName || 'Cash Book',
          voucherNumber,
          date: entryDate,
          accountId: dto.accountId,
          type: dto.type,
          amount: dto.amount,
          invoiceId: dto.invoiceId,
          narration: dto.narration,
        },
      });

      // Create ledger entries: Cash A/c DR / Party CR (for receipt) or Party DR / Cash A/c CR (for payment)
      const cashAccount = await this.findOrCreateCashAccount(tx, companyId);
      if (dto.type === 'CR') {
        // Receipt: Cash DR, Party CR
        await tx.ledgerEntry.createMany({
          data: [
            {
              companyId,
              accountId: cashAccount,
              voucherType: 'CASH_RECEIPT',
              voucherNumber,
              date: entryDate,
              debit: dto.amount,
              credit: 0,
              narration: dto.narration,
            },
            {
              companyId,
              accountId: dto.accountId,
              voucherType: 'CASH_RECEIPT',
              voucherNumber,
              date: entryDate,
              debit: 0,
              credit: dto.amount,
              narration: dto.narration,
              invoiceId: dto.invoiceId,
            },
          ],
        });
      } else {
        // Payment: Party DR, Cash CR
        await tx.ledgerEntry.createMany({
          data: [
            {
              companyId,
              accountId: dto.accountId,
              voucherType: 'CASH_PAYMENT',
              voucherNumber,
              date: entryDate,
              debit: dto.amount,
              credit: 0,
              narration: dto.narration,
              invoiceId: dto.invoiceId,
            },
            {
              companyId,
              accountId: cashAccount,
              voucherType: 'CASH_PAYMENT',
              voucherNumber,
              date: entryDate,
              debit: 0,
              credit: dto.amount,
              narration: dto.narration,
            },
          ],
        });
      }

      return entry;
    });
  }

  async getCashBook(
    companyId: string,
    query: {
      bookName?: string;
      dateFrom?: string;
      dateTo?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const { skip, take, page, limit } = parsePagination(query);
    const where: Record<string, unknown> = { companyId };
    if (query.bookName) where.bookName = query.bookName;
    if (query.dateFrom || query.dateTo) {
      where.date = {};
      if (query.dateFrom)
        (where.date as Record<string, unknown>).gte = new Date(query.dateFrom);
      if (query.dateTo)
        (where.date as Record<string, unknown>).lte = new Date(query.dateTo);
    }

    const [data, total] = await Promise.all([
      this.prisma.cashBookEntry.findMany({
        where: where as never,
        skip,
        take,
        orderBy: { date: 'desc' },
        include: { account: { select: { id: true, name: true } } },
      }),
      this.prisma.cashBookEntry.count({ where: where as never }),
    ]);
    return createPaginatedResult(data, total, page, limit);
  }

  async deleteCashBookEntry(companyId: string, id: string) {
    const entry = await this.prisma.cashBookEntry.findFirst({
      where: { id, companyId },
    });
    if (!entry) throw new NotFoundException('Cash book entry not found');
    if (!entry.voucherNumber) {
      throw new BadRequestException(
        'Cash book entry has no voucher number and cannot be safely deleted.',
      );
    }
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const ledgerDeleteResult = await tx.ledgerEntry.deleteMany({
        where: {
          companyId,
          voucherNumber: entry.voucherNumber,
          voucherType: { in: ['CASH_RECEIPT', 'CASH_PAYMENT'] },
        },
      });
      await tx.cashBookEntry.delete({ where: { id } });

      if (ledgerDeleteResult.count === 0) {
        this.logger.warn(
          `Cash book deletion removed no ledger rows (company=${companyId}, voucher=${entry.voucherNumber}).`,
        );
      }
    });
    return { message: 'Deleted' };
  }

  // ═══════════════ BANK BOOK ═══════════════

  async createBankBookEntry(companyId: string, dto: CreateBankBookEntryDto) {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const entryDate = new Date(dto.date);
      const voucherNumber = await this.allocateVoucherNumber(
        tx,
        companyId,
        'BB',
        entryDate,
      );

      const entry = await tx.bankBookEntry.create({
        data: {
          companyId,
          bookName: dto.bookName || 'Bank Book',
          voucherNumber,
          date: entryDate,
          accountId: dto.accountId,
          type: dto.type,
          amount: dto.amount,
          chequeNumber: dto.chequeNumber,
          invoiceId: dto.invoiceId,
          narration: dto.narration,
        },
      });

      const bankAccount = await this.findOrCreateBankAccount(tx, companyId);
      if (dto.type === 'CR') {
        await tx.ledgerEntry.createMany({
          data: [
            {
              companyId,
              accountId: bankAccount,
              voucherType: 'BANK_RECEIPT',
              voucherNumber,
              date: entryDate,
              debit: dto.amount,
              credit: 0,
              narration: dto.narration,
            },
            {
              companyId,
              accountId: dto.accountId,
              voucherType: 'BANK_RECEIPT',
              voucherNumber,
              date: entryDate,
              debit: 0,
              credit: dto.amount,
              narration: dto.narration,
              invoiceId: dto.invoiceId,
            },
          ],
        });
      } else {
        await tx.ledgerEntry.createMany({
          data: [
            {
              companyId,
              accountId: dto.accountId,
              voucherType: 'BANK_PAYMENT',
              voucherNumber,
              date: entryDate,
              debit: dto.amount,
              credit: 0,
              narration: dto.narration,
              invoiceId: dto.invoiceId,
            },
            {
              companyId,
              accountId: bankAccount,
              voucherType: 'BANK_PAYMENT',
              voucherNumber,
              date: entryDate,
              debit: 0,
              credit: dto.amount,
              narration: dto.narration,
            },
          ],
        });
      }

      return entry;
    });
  }

  async getBankBook(
    companyId: string,
    query: {
      bookName?: string;
      dateFrom?: string;
      dateTo?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const { skip, take, page, limit } = parsePagination(query);
    const where: Record<string, unknown> = { companyId };
    if (query.bookName) where.bookName = query.bookName;
    if (query.dateFrom || query.dateTo) {
      where.date = {};
      if (query.dateFrom)
        (where.date as Record<string, unknown>).gte = new Date(query.dateFrom);
      if (query.dateTo)
        (where.date as Record<string, unknown>).lte = new Date(query.dateTo);
    }

    const [data, total] = await Promise.all([
      this.prisma.bankBookEntry.findMany({
        where: where as never,
        skip,
        take,
        orderBy: { date: 'desc' },
        include: { account: { select: { id: true, name: true } } },
      }),
      this.prisma.bankBookEntry.count({ where: where as never }),
    ]);
    return createPaginatedResult(data, total, page, limit);
  }

  async deleteBankBookEntry(companyId: string, id: string) {
    const entry = await this.prisma.bankBookEntry.findFirst({
      where: { id, companyId },
    });
    if (!entry) throw new NotFoundException('Bank book entry not found');
    if (!entry.voucherNumber) {
      throw new BadRequestException(
        'Bank book entry has no voucher number and cannot be safely deleted.',
      );
    }
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const ledgerDeleteResult = await tx.ledgerEntry.deleteMany({
        where: {
          companyId,
          voucherNumber: entry.voucherNumber,
          voucherType: { in: ['BANK_RECEIPT', 'BANK_PAYMENT'] },
        },
      });
      await tx.bankBookEntry.delete({ where: { id } });

      if (ledgerDeleteResult.count === 0) {
        this.logger.warn(
          `Bank book deletion removed no ledger rows (company=${companyId}, voucher=${entry.voucherNumber}).`,
        );
      }
    });
    return { message: 'Deleted' };
  }

  async reconcileBankEntry(companyId: string, id: string) {
    const entry = await this.prisma.bankBookEntry.findFirst({
      where: { id, companyId },
    });
    if (!entry) throw new NotFoundException('Bank book entry not found');
    return this.prisma.bankBookEntry.update({
      where: { id },
      data: { isReconciled: true, reconciledDate: new Date() },
    });
  }

  // ═══════════════ JOURNAL ENTRY ═══════════════

  async createJournalEntry(companyId: string, dto: CreateJournalEntryDto) {
    const drTotal = dto.lines
      .filter((l) => l.type === 'DR')
      .reduce((s, l) => s + l.amount, 0);
    const crTotal = dto.lines
      .filter((l) => l.type === 'CR')
      .reduce((s, l) => s + l.amount, 0);
    if (Math.abs(drTotal - crTotal) > 0.01) {
      throw new BadRequestException(
        `Debit total (${drTotal}) must equal Credit total (${crTotal})`,
      );
    }

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const entryDate = new Date(dto.date);
      const voucherNumber = await this.allocateVoucherNumber(
        tx,
        companyId,
        'JV',
        entryDate,
      );

      const entry = await tx.journalEntry.create({
        data: {
          companyId,
          voucherNumber,
          date: entryDate,
          narration: dto.narration,
          totalAmount: drTotal,
          lines: {
            create: dto.lines.map((l) => ({
              accountId: l.accountId,
              type: l.type,
              amount: l.amount,
              narration: l.narration,
            })),
          },
        },
        include: { lines: true },
      });

      // Create ledger entries for each line
      await tx.ledgerEntry.createMany({
        data: dto.lines.map((l) => ({
          companyId,
          accountId: l.accountId,
          voucherType: 'JOURNAL',
          voucherNumber,
          date: entryDate,
          debit: l.type === 'DR' ? l.amount : 0,
          credit: l.type === 'CR' ? l.amount : 0,
          narration: l.narration || dto.narration,
        })),
      });

      return entry;
    });
  }

  async getJournalEntries(
    companyId: string,
    query: {
      dateFrom?: string;
      dateTo?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const { skip, take, page, limit } = parsePagination(query);
    const where: Record<string, unknown> = { companyId };
    if (query.dateFrom || query.dateTo) {
      where.date = {};
      if (query.dateFrom)
        (where.date as Record<string, unknown>).gte = new Date(query.dateFrom);
      if (query.dateTo)
        (where.date as Record<string, unknown>).lte = new Date(query.dateTo);
    }

    const [data, total] = await Promise.all([
      this.prisma.journalEntry.findMany({
        where: where as never,
        skip,
        take,
        orderBy: { date: 'desc' },
        include: { lines: true },
      }),
      this.prisma.journalEntry.count({ where: where as never }),
    ]);
    return createPaginatedResult(data, total, page, limit);
  }

  async deleteJournalEntry(companyId: string, id: string) {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id, companyId },
    });
    if (!entry) throw new NotFoundException('Journal entry not found');
    if (!entry.voucherNumber) {
      throw new BadRequestException(
        'Journal entry has no voucher number and cannot be safely deleted.',
      );
    }
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const ledgerDeleteResult = await tx.ledgerEntry.deleteMany({
        where: {
          companyId,
          voucherNumber: entry.voucherNumber,
          voucherType: 'JOURNAL',
        },
      });
      await tx.journalEntry.delete({ where: { id } });

      if (ledgerDeleteResult.count === 0) {
        this.logger.warn(
          `Journal deletion removed no ledger rows (company=${companyId}, voucher=${entry.voucherNumber}).`,
        );
      }
    });
    return { message: 'Deleted' };
  }

  // ═══════════════ OPENING STOCK ═══════════════

  async createOpeningStock(companyId: string, dto: CreateOpeningStockDto) {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const entryDate = new Date(dto.date);
      const entry = await tx.openingStock.create({
        data: {
          companyId,
          productId: dto.productId,
          quantity: dto.quantity,
          rate: dto.rate,
          date: entryDate,
        },
      });

      await tx.stockMovement.create({
        data: {
          companyId,
          productId: dto.productId,
          type: 'OPENING',
          quantity: dto.quantity,
          rate: dto.rate,
          date: entryDate,
          reference: `Opening Stock`,
        },
      });

      return entry;
    });
  }

  async getOpeningStock(
    companyId: string,
    query: { page?: number; limit?: number },
  ) {
    const { skip, take, page, limit } = parsePagination(query);
    const [data, total] = await Promise.all([
      this.prisma.openingStock.findMany({
        where: { companyId },
        skip,
        take,
        include: {
          product: { select: { id: true, name: true, hsnCode: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.openingStock.count({ where: { companyId } }),
    ]);

    return createPaginatedResult(data, total, page, limit);
  }

  // ═══════════════ STOCK ADJUSTMENT ═══════════════

  async createStockAdjustment(
    companyId: string,
    dto: CreateStockAdjustmentDto,
  ) {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const entryDate = new Date(dto.date);
      const entry = await tx.stockAdjustment.create({
        data: {
          companyId,
          productId: dto.productId,
          type: dto.type,
          quantity: dto.quantity,
          reason: dto.reason,
          date: entryDate,
        },
      });

      await tx.stockMovement.create({
        data: {
          companyId,
          productId: dto.productId,
          type: dto.type === 'ADD' ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
          quantity: dto.quantity,
          date: entryDate,
          reference: `Stock Adjustment: ${dto.reason || 'Manual'}`,
        },
      });

      return entry;
    });
  }

  async getStockAdjustments(
    companyId: string,
    query: { page?: number; limit?: number },
  ) {
    const { skip, take, page, limit } = parsePagination(query);
    const [data, total] = await Promise.all([
      this.prisma.stockAdjustment.findMany({
        where: { companyId },
        skip,
        take,
        orderBy: { date: 'desc' },
      }),
      this.prisma.stockAdjustment.count({ where: { companyId } }),
    ]);
    return createPaginatedResult(data, total, page, limit);
  }

  // ═══════════════ OPENING BALANCE ═══════════════

  async createOpeningBalance(companyId: string, dto: CreateOpeningBalanceDto) {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const entryDate = new Date(dto.date);
      const voucherNumber = await this.allocateVoucherNumber(
        tx,
        companyId,
        'OB',
        entryDate,
      );

      return tx.ledgerEntry.create({
        data: {
          companyId,
          accountId: dto.accountId,
          voucherType: 'OPENING_BALANCE',
          voucherNumber,
          date: entryDate,
          debit: dto.type === 'DR' ? dto.amount : 0,
          credit: dto.type === 'CR' ? dto.amount : 0,
          narration: 'Opening Balance',
        },
      });
    });
  }

  // ═══════════════ LEDGER ═══════════════

  async getLedger(
    companyId: string,
    query: {
      accountId?: string;
      dateFrom?: string;
      dateTo?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const { skip, take, page, limit } = parsePagination(query);
    const where: Prisma.LedgerEntryWhereInput = { companyId };
    if (query.accountId) where.accountId = query.accountId;
    if (query.dateFrom || query.dateTo) {
      where.date = {};
      if (query.dateFrom)
        (where.date as Prisma.DateTimeFilter).gte = new Date(query.dateFrom);
      if (query.dateTo)
        (where.date as Prisma.DateTimeFilter).lte = new Date(query.dateTo);
    }

    const orderBy: Prisma.LedgerEntryOrderByWithRelationInput[] = [
      { date: 'asc' },
      { id: 'asc' },
    ];

    let openingBalance = 0;
    if (skip > 0) {
      const [boundaryEntry] = await this.prisma.ledgerEntry.findMany({
        where,
        orderBy,
        skip,
        take: 1,
        select: { id: true, date: true },
      });

      const openingWhere: Prisma.LedgerEntryWhereInput = boundaryEntry
        ? {
            AND: [
              where,
              {
                OR: [
                  { date: { lt: boundaryEntry.date } },
                  {
                    date: boundaryEntry.date,
                    id: { lt: boundaryEntry.id },
                  },
                ],
              },
            ],
          }
        : where;

      const openingTotals = await this.prisma.ledgerEntry.aggregate({
        where: openingWhere,
        _sum: { debit: true, credit: true },
      });
      openingBalance =
        Number(openingTotals._sum.debit ?? 0) -
        Number(openingTotals._sum.credit ?? 0);
    }

    const [data, total] = await Promise.all([
      this.prisma.ledgerEntry.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          account: { select: { id: true, name: true } },
          invoice: { select: { id: true, invoiceNumber: true } },
        },
      }),
      this.prisma.ledgerEntry.count({ where }),
    ]);

    // Running balance must include entries from previous pages in the same filter scope.
    let balance = this.round2(openingBalance);
    const entries = data.map((e: { debit: Decimal; credit: Decimal }) => {
      balance = this.round2(balance + Number(e.debit) - Number(e.credit));
      return { ...e, runningBalance: balance };
    });

    return createPaginatedResult(entries, total, page, limit);
  }

  async getLedgerSummary(
    companyId: string,
    query: { dateFrom?: string; dateTo?: string },
  ) {
    const where: Record<string, unknown> = { companyId };
    if (query.dateFrom || query.dateTo) {
      where.date = {};
      if (query.dateFrom)
        (where.date as Record<string, unknown>).gte = new Date(query.dateFrom);
      if (query.dateTo)
        (where.date as Record<string, unknown>).lte = new Date(query.dateTo);
    }

    const result = await this.prisma.ledgerEntry.groupBy({
      by: ['accountId'],
      where: where as never,
      _sum: { debit: true, credit: true },
    });

    // Fetch account names
    const accountIds = result.map((r: { accountId: string }) => r.accountId);
    const accounts = await this.prisma.account.findMany({
      where: { id: { in: accountIds } },
      select: {
        id: true,
        name: true,
        group: { select: { name: true, nature: true } },
      },
    });
    const accountMap = new Map(
      accounts.map(
        (a: {
          id: string;
          name: string;
          group: { name: string; nature: string } | null;
        }) => [a.id, a],
      ),
    );

    return result.map(
      (r: {
        accountId: string;
        _sum: { debit: Decimal | null; credit: Decimal | null };
      }) => {
        const account = accountMap.get(r.accountId);
        return {
          accountId: r.accountId,
          accountName: account?.name || 'Unknown',
          groupName: account?.group?.name,
          nature: account?.group?.nature,
          totalDebit: Number(r._sum.debit || 0),
          totalCredit: Number(r._sum.credit || 0),
          closingBalance:
            Number(r._sum.debit || 0) - Number(r._sum.credit || 0),
        };
      },
    );
  }

  async getOutstandingInvoices(companyId: string, accountId: string) {
    const invoices = await this.prisma.invoice.findMany({
      where: { companyId, accountId, status: { not: 'CANCELLED' } },
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        grandTotal: true,
        paidAmount: true,
        invoiceType: true,
      },
      orderBy: { invoiceDate: 'desc' },
    });
    return invoices
      .map(
        (inv: {
          id: string;
          invoiceNumber: string;
          invoiceDate: Date;
          grandTotal: Decimal;
          paidAmount: Decimal;
          invoiceType: string;
        }) => ({
          ...inv,
          grandTotal: Number(inv.grandTotal),
          paidAmount: Number(inv.paidAmount),
          remaining: Number(inv.grandTotal) - Number(inv.paidAmount),
        }),
      )
      .filter((inv: { remaining: number }) => inv.remaining > 0.01);
  }

  // ═══════════════ HELPERS ═══════════════

  private async allocateVoucherNumber(
    tx: Prisma.TransactionClient,
    companyId: string,
    series: VoucherSeries,
    voucherDate: Date,
  ): Promise<string> {
    return this.voucherNumberService.getNextNumber(tx, {
      companyId,
      series,
      voucherDate,
    });
  }

  private round2(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private async findOrCreateCashAccount(
    tx: Prisma.TransactionClient,
    companyId: string,
  ): Promise<string> {
    const existing = await tx.account.findFirst({
      where: { companyId, group: { name: 'Cash-in-Hand' } },
    });
    if (existing) return existing.id;
    const group = await tx.accountGroup.findFirst({
      where: { name: 'Cash-in-Hand' },
    });
    if (!group)
      throw new BadRequestException('Cash-in-Hand account group not found');
    const account = await tx.account.create({
      data: {
        companyId,
        name: 'Cash Account',
        groupId: group.id,
        gstType: 'UNREGISTERED',
      },
    });
    return account.id;
  }

  private async findOrCreateBankAccount(
    tx: Prisma.TransactionClient,
    companyId: string,
  ): Promise<string> {
    const existing = await tx.account.findFirst({
      where: { companyId, group: { name: 'Bank Accounts' } },
    });
    if (existing) return existing.id;
    const group = await tx.accountGroup.findFirst({
      where: { name: 'Bank Accounts' },
    });
    if (!group) throw new BadRequestException('Bank Accounts group not found');
    const account = await tx.account.create({
      data: {
        companyId,
        name: 'Bank Account',
        groupId: group.id,
        gstType: 'UNREGISTERED',
      },
    });
    return account.id;
  }
}
