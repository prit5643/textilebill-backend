import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, MovementType } from '@prisma/client';
import {} from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly voucherNumberService: VoucherNumberService,
  ) {}

  private async getCompanyContext(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, tenantId: true },
    });
    if (!company) {
      throw new NotFoundException('Company not found');
    }
    return company;
  }

  private buildTaggedNarration(
    tag: 'CASH_BOOK' | 'BANK_BOOK' | 'JOURNAL' | 'OPENING_BALANCE',
    voucherNumber: string,
    narration?: string,
  ) {
    return `[${tag}][VNO:${voucherNumber}] ${narration ?? ''}`.trim();
  }

  private extractVoucherNumber(narration: string | null | undefined) {
    const match = narration?.match(/\[VNO:([^\]]+)\]/);
    return match?.[1] ?? null;
  }

  async createCashBookEntry(companyId: string, dto: CreateCashBookEntryDto) {
    const company = await this.getCompanyContext(companyId);
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const date = new Date(dto.date);
      const voucherNumber = await this.voucherNumberService.getNextNumber(tx, {
        companyId,
        series: 'CB',
        voucherDate: date,
      });

      const entry = await tx.ledgerEntry.create({
        data: {
          tenantId: company.tenantId,
          companyId,
          accountId: dto.accountId,
          invoiceId: dto.invoiceId ?? null,
          date,
          debit: dto.type === 'DR' ? dto.amount : 0,
          credit: dto.type === 'CR' ? dto.amount : 0,
          narration: this.buildTaggedNarration(
            'CASH_BOOK',
            voucherNumber,
            dto.narration ?? dto.bookName,
          ),
        },
      });

      return { ...entry, voucherNumber };
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
    const where: Prisma.LedgerEntryWhereInput = {
      companyId,
      narration: { contains: '[CASH_BOOK]' },
    };

    if (query.dateFrom || query.dateTo) {
      where.date = {};
      if (query.dateFrom) where.date.gte = new Date(query.dateFrom);
      if (query.dateTo) where.date.lte = new Date(query.dateTo);
    }
    if (query.bookName) {
      where.narration = {
        contains: query.bookName,
        mode: 'insensitive',
      };
    }

    const [rows, total] = await Promise.all([
      this.prisma.ledgerEntry.findMany({
        where,
        skip,
        take,
        orderBy: { date: 'desc' },
        include: {
          account: {
            select: {
              id: true,
              party: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.ledgerEntry.count({ where }),
    ]);

    return createPaginatedResult(
      rows.map((row) => ({
        ...row,
        voucherNumber: this.extractVoucherNumber(row.narration),
      })),
      total,
      page,
      limit,
    );
  }

  async deleteCashBookEntry(companyId: string, id: string) {
    const entry = await this.prisma.ledgerEntry.findFirst({
      where: { id, companyId, narration: { contains: '[CASH_BOOK]' } },
      select: { id: true },
    });
    if (!entry) throw new NotFoundException('Cash book entry not found');
    await this.prisma.ledgerEntry.delete({ where: { id } });
    return { message: 'Deleted' };
  }

  async createBankBookEntry(companyId: string, dto: CreateBankBookEntryDto) {
    const company = await this.getCompanyContext(companyId);
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const date = new Date(dto.date);
      const voucherNumber = await this.voucherNumberService.getNextNumber(tx, {
        companyId,
        series: 'BB',
        voucherDate: date,
      });

      const entry = await tx.ledgerEntry.create({
        data: {
          tenantId: company.tenantId,
          companyId,
          accountId: dto.accountId,
          invoiceId: dto.invoiceId ?? null,
          date,
          debit: dto.type === 'DR' ? dto.amount : 0,
          credit: dto.type === 'CR' ? dto.amount : 0,
          narration: this.buildTaggedNarration(
            'BANK_BOOK',
            voucherNumber,
            [dto.narration, dto.chequeNumber].filter(Boolean).join(' | '),
          ),
        },
      });

      return { ...entry, voucherNumber };
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
    const where: Prisma.LedgerEntryWhereInput = {
      companyId,
      narration: { contains: '[BANK_BOOK]' },
    };

    if (query.dateFrom || query.dateTo) {
      where.date = {};
      if (query.dateFrom) where.date.gte = new Date(query.dateFrom);
      if (query.dateTo) where.date.lte = new Date(query.dateTo);
    }
    if (query.bookName) {
      where.narration = {
        contains: query.bookName,
        mode: 'insensitive',
      };
    }

    const [rows, total] = await Promise.all([
      this.prisma.ledgerEntry.findMany({
        where,
        skip,
        take,
        orderBy: { date: 'desc' },
        include: {
          account: {
            select: {
              id: true,
              party: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.ledgerEntry.count({ where }),
    ]);

    return createPaginatedResult(
      rows.map((row) => ({
        ...row,
        voucherNumber: this.extractVoucherNumber(row.narration),
      })),
      total,
      page,
      limit,
    );
  }

  async deleteBankBookEntry(companyId: string, id: string) {
    const entry = await this.prisma.ledgerEntry.findFirst({
      where: { id, companyId, narration: { contains: '[BANK_BOOK]' } },
      select: { id: true },
    });
    if (!entry) throw new NotFoundException('Bank book entry not found');
    await this.prisma.ledgerEntry.delete({ where: { id } });
    return { message: 'Deleted' };
  }

  async reconcileBankEntry(companyId: string, id: string) {
    const entry = await this.prisma.ledgerEntry.findFirst({
      where: { id, companyId, narration: { contains: '[BANK_BOOK]' } },
      select: { id: true, narration: true },
    });
    if (!entry) throw new NotFoundException('Bank book entry not found');

    return this.prisma.ledgerEntry.update({
      where: { id },
      data: {
        narration: `${entry.narration ?? ''} [RECONCILED:${new Date().toISOString()}]`,
      },
    });
  }

  async createJournalEntry(companyId: string, dto: CreateJournalEntryDto) {
    const drTotal = dto.lines
      .filter((line) => line.type === 'DR')
      .reduce((sum, line) => sum + line.amount, 0);
    const crTotal = dto.lines
      .filter((line) => line.type === 'CR')
      .reduce((sum, line) => sum + line.amount, 0);
    if (Math.abs(drTotal - crTotal) > 0.01) {
      throw new BadRequestException(
        `Debit total (${drTotal}) must equal Credit total (${crTotal})`,
      );
    }

    const company = await this.getCompanyContext(companyId);
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const date = new Date(dto.date);
      const voucherNumber = await this.voucherNumberService.getNextNumber(tx, {
        companyId,
        series: 'JV',
        voucherDate: date,
      });

      const rows = await Promise.all(
        dto.lines.map((line) =>
          tx.ledgerEntry.create({
            data: {
              tenantId: company.tenantId,
              companyId,
              accountId: line.accountId,
              date,
              debit: line.type === 'DR' ? line.amount : 0,
              credit: line.type === 'CR' ? line.amount : 0,
              narration: this.buildTaggedNarration(
                'JOURNAL',
                voucherNumber,
                line.narration ?? dto.narration,
              ),
            },
          }),
        ),
      );

      return {
        id: voucherNumber,
        voucherNumber,
        date,
        lines: rows,
      };
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
    const where: Prisma.LedgerEntryWhereInput = {
      companyId,
      narration: { contains: '[JOURNAL]' },
    };
    if (query.dateFrom || query.dateTo) {
      where.date = {};
      if (query.dateFrom) where.date.gte = new Date(query.dateFrom);
      if (query.dateTo) where.date.lte = new Date(query.dateTo);
    }

    const [rows, total] = await Promise.all([
      this.prisma.ledgerEntry.findMany({
        where,
        skip,
        take,
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
        include: {
          account: { select: { id: true, party: { select: { name: true } } } },
        },
      }),
      this.prisma.ledgerEntry.count({ where }),
    ]);

    return createPaginatedResult(
      rows.map((row) => ({
        ...row,
        voucherNumber: this.extractVoucherNumber(row.narration),
      })),
      total,
      page,
      limit,
    );
  }

  async deleteJournalEntry(companyId: string, id: string) {
    const entry = await this.prisma.ledgerEntry.findFirst({
      where: { id, companyId, narration: { contains: '[JOURNAL]' } },
      select: { id: true },
    });
    if (!entry) throw new NotFoundException('Journal entry not found');
    await this.prisma.ledgerEntry.delete({ where: { id } });
    return { message: 'Deleted' };
  }

  async createOpeningStock(companyId: string, dto: CreateOpeningStockDto) {
    const company = await this.getCompanyContext(companyId);
    return this.prisma.stockMovement.create({
      data: {
        tenantId: company.tenantId,
        companyId,
        productId: dto.productId,
        type: MovementType.IN,
        quantity: dto.quantity,
        date: new Date(dto.date),
        notes: `[OPENING_STOCK] rate=${dto.rate}`,
      },
    });
  }

  async getOpeningStock(
    companyId: string,
    query: { page?: number; limit?: number },
  ) {
    const { skip, take, page, limit } = parsePagination(query);
    const where: Prisma.StockMovementWhereInput = {
      companyId,
      notes: { contains: '[OPENING_STOCK]' },
    };

    const [data, total] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where,
        skip,
        take,
        include: {
          product: { select: { id: true, name: true, hsnCode: true } },
        },
        orderBy: { date: 'desc' },
      }),
      this.prisma.stockMovement.count({ where }),
    ]);

    return createPaginatedResult(data, total, page, limit);
  }

  async createStockAdjustment(
    companyId: string,
    dto: CreateStockAdjustmentDto,
  ) {
    const company = await this.getCompanyContext(companyId);
    return this.prisma.stockMovement.create({
      data: {
        tenantId: company.tenantId,
        companyId,
        productId: dto.productId,
        type: dto.type === 'ADD' ? MovementType.IN : MovementType.OUT,
        quantity: dto.quantity,
        date: new Date(dto.date),
        notes: `[STOCK_ADJ] ${dto.reason ?? ''}`.trim(),
      },
    });
  }

  async getStockAdjustments(
    companyId: string,
    query: { page?: number; limit?: number },
  ) {
    const { skip, take, page, limit } = parsePagination(query);
    const where: Prisma.StockMovementWhereInput = {
      companyId,
      notes: { contains: '[STOCK_ADJ]' },
    };

    const [data, total] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where,
        skip,
        take,
        orderBy: { date: 'desc' },
      }),
      this.prisma.stockMovement.count({ where }),
    ]);

    return createPaginatedResult(data, total, page, limit);
  }

  async createOpeningBalance(companyId: string, dto: CreateOpeningBalanceDto) {
    const company = await this.getCompanyContext(companyId);
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const date = new Date(dto.date);
      const voucherNumber = await this.voucherNumberService.getNextNumber(tx, {
        companyId,
        series: 'OB',
        voucherDate: date,
      });

      const entry = await tx.ledgerEntry.create({
        data: {
          tenantId: company.tenantId,
          companyId,
          accountId: dto.accountId,
          date,
          debit: dto.type === 'DR' ? dto.amount : 0,
          credit: dto.type === 'CR' ? dto.amount : 0,
          narration: this.buildTaggedNarration(
            'OPENING_BALANCE',
            voucherNumber,
            'Opening Balance',
          ),
        },
      });

      return { ...entry, voucherNumber };
    });
  }

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
      if (query.dateFrom) where.date.gte = new Date(query.dateFrom);
      if (query.dateTo) where.date.lte = new Date(query.dateTo);
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
                  { date: boundaryEntry.date, id: { lt: boundaryEntry.id } },
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

    const [rows, total] = await Promise.all([
      this.prisma.ledgerEntry.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          account: {
            select: {
              id: true,
              group: true,
              party: { select: { name: true } },
            },
          },
          invoice: { select: { id: true, invoiceNumber: true } },
        },
      }),
      this.prisma.ledgerEntry.count({ where }),
    ]);

    let balance = openingBalance;
    const data = rows.map((row) => {
      balance = this.round2(balance + Number(row.debit) - Number(row.credit));
      return { ...row, runningBalance: balance };
    });

    return createPaginatedResult(data, total, page, limit);
  }

  async getLedgerSummary(
    companyId: string,
    query: { dateFrom?: string; dateTo?: string },
  ) {
    const where: Prisma.LedgerEntryWhereInput = { companyId };
    if (query.dateFrom || query.dateTo) {
      where.date = {};
      if (query.dateFrom) where.date.gte = new Date(query.dateFrom);
      if (query.dateTo) where.date.lte = new Date(query.dateTo);
    }

    const grouped = await this.prisma.ledgerEntry.groupBy({
      by: ['accountId'],
      where,
      _sum: { debit: true, credit: true },
    });

    const accountIds = grouped.map((row) => row.accountId);
    const accounts = await this.prisma.account.findMany({
      where: { id: { in: accountIds } },
      select: {
        id: true,
        group: true,
        party: { select: { name: true } },
      },
    });

    const accountMap = new Map(
      accounts.map((account) => [account.id, account]),
    );

    return grouped.map((row) => {
      const account = accountMap.get(row.accountId);
      const totalDebit = Number(row._sum.debit ?? 0);
      const totalCredit = Number(row._sum.credit ?? 0);
      return {
        accountId: row.accountId,
        accountName: account?.party?.name ?? 'Unknown',
        group: account?.group ?? null,
        totalDebit,
        totalCredit,
        closingBalance: this.round2(totalDebit - totalCredit),
      };
    });
  }

  async getOutstandingInvoices(companyId: string, accountId: string) {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        companyId,
        accountId,
        status: { not: 'CANCELLED' },
        deletedAt: null,
      },
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        totalAmount: true,
        type: true,
      },
      orderBy: { invoiceDate: 'desc' },
    });

    const invoiceIds = invoices.map((invoice) => invoice.id);
    if (invoiceIds.length === 0) {
      return [];
    }

    const paymentGroups = await this.prisma.ledgerEntry.groupBy({
      by: ['invoiceId'],
      where: {
        companyId,
        invoiceId: { in: invoiceIds },
      },
      _sum: {
        credit: true,
      },
    });

    const paidMap = new Map(
      paymentGroups.map((row) => [
        row.invoiceId ?? '',
        Number(row._sum.credit ?? 0),
      ]),
    );

    return invoices
      .map((invoice) => {
        const paidAmount = paidMap.get(invoice.id) ?? 0;
        const totalAmount = Number(invoice.totalAmount);
        return {
          ...invoice,
          totalAmount,
          paidAmount,
          remaining: this.round2(Math.max(0, totalAmount - paidAmount)),
        };
      })
      .filter((invoice) => invoice.remaining > 0);
  }

  private round2(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
