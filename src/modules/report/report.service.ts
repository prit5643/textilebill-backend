import { Injectable } from '@nestjs/common';
import { InvoiceStatus, InvoiceType, MovementType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type DateRangeInput = {
  dateFrom?: string;
  dateTo?: string;
};

@Injectable()
export class ReportService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboardKpis(companyId: string) {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const [todaySales, todayPurchases, totalProducts] = await Promise.all([
      this.prisma.invoice.aggregate({
        where: {
          companyId,
          type: InvoiceType.SALE,
          status: { not: InvoiceStatus.CANCELLED },
          deletedAt: null,
          invoiceDate: { gte: start, lt: end },
        },
        _sum: { totalAmount: true },
      }),
      this.prisma.invoice.aggregate({
        where: {
          companyId,
          type: InvoiceType.PURCHASE,
          status: { not: InvoiceStatus.CANCELLED },
          deletedAt: null,
          invoiceDate: { gte: start, lt: end },
        },
        _sum: { totalAmount: true },
      }),
      this.prisma.product.count({
        where: { companyId, deletedAt: null },
      }),
    ]);

    const outstanding = await this.computeOutstanding(companyId);

    return {
      todaySales: Number(todaySales._sum.totalAmount ?? 0),
      todayPurchases: Number(todayPurchases._sum.totalAmount ?? 0),
      outstandingReceivable: outstanding.receivable,
      outstandingPayable: outstanding.payable,
      totalProducts,
    };
  }

  async getMonthlySalesChart(companyId: string, year: number) {
    const from = new Date(year, 0, 1);
    const to = new Date(year + 1, 0, 1);

    const invoices = await this.prisma.invoice.findMany({
      where: {
        companyId,
        deletedAt: null,
        status: { not: InvoiceStatus.CANCELLED },
        type: { in: [InvoiceType.SALE, InvoiceType.PURCHASE] },
        invoiceDate: { gte: from, lt: to },
      },
      select: { invoiceDate: true, type: true, totalAmount: true },
    });

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const buckets = Array.from({ length: 12 }, (_, i) => ({
      month: monthNames[i],
      sales: 0,
      purchases: 0,
    }));

    for (const invoice of invoices) {
      const idx = new Date(invoice.invoiceDate).getMonth();
      if (invoice.type === InvoiceType.SALE) {
        buckets[idx].sales += Number(invoice.totalAmount);
      } else if (invoice.type === InvoiceType.PURCHASE) {
        buckets[idx].purchases += Number(invoice.totalAmount);
      }
    }

    return buckets.map((row) => ({
      ...row,
      sales: this.round2(row.sales),
      purchases: this.round2(row.purchases),
    }));
  }

  async getOutstandingDebtors(companyId: string, range: DateRangeInput) {
    return this.getOutstandingByType(companyId, InvoiceType.SALE, range);
  }

  async getOutstandingCreditors(companyId: string, range: DateRangeInput) {
    return this.getOutstandingByType(companyId, InvoiceType.PURCHASE, range);
  }

  async getDayBook(companyId: string, date: string) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const [invoices, ledger, stock] = await Promise.all([
      this.prisma.invoice.findMany({
        where: {
          companyId,
          deletedAt: null,
          invoiceDate: { gte: start, lt: end },
        },
        select: {
          id: true,
          invoiceNumber: true,
          invoiceDate: true,
          type: true,
          totalAmount: true,
        },
        orderBy: { invoiceDate: 'asc' },
      }),
      this.prisma.ledgerEntry.findMany({
        where: {
          companyId,
          date: { gte: start, lt: end },
          deletedAt: null,
        },
        select: {
          id: true,
          date: true,
          debit: true,
          credit: true,
          narration: true,
          account: {
            select: {
              id: true,
              party: { select: { name: true } },
            },
          },
        },
        orderBy: { date: 'asc' },
      }),
      this.prisma.stockMovement.findMany({
        where: {
          companyId,
          date: { gte: start, lt: end },
          deletedAt: null,
        },
        select: {
          id: true,
          date: true,
          type: true,
          quantity: true,
          notes: true,
          product: { select: { id: true, name: true } },
        },
        orderBy: { date: 'asc' },
      }),
    ]);

    return { invoices, ledger, stock };
  }

  async getStockReport(
    companyId: string,
    query: { productId?: string; dateFrom?: string; dateTo?: string },
  ) {
    const { from, to } = this.parseRange(query);
    const productWhere: Prisma.ProductWhereInput = {
      companyId,
      deletedAt: null,
      ...(query.productId ? { id: query.productId } : {}),
    };

    const products = await this.prisma.product.findMany({
      where: productWhere,
      select: { id: true, name: true, hsnCode: true },
      orderBy: { name: 'asc' },
    });

    const movementsInPeriod = await this.prisma.stockMovement.findMany({
      where: {
        companyId,
        deletedAt: null,
        ...(query.productId ? { productId: query.productId } : {}),
        ...(from || to
          ? {
              date: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      },
      select: { productId: true, type: true, quantity: true },
    });

    const openingMovements = await this.prisma.stockMovement.findMany({
      where: {
        companyId,
        deletedAt: null,
        ...(query.productId ? { productId: query.productId } : {}),
        ...(from ? { date: { lt: from } } : {}),
      },
      select: { productId: true, type: true, quantity: true },
    });

    const openingByProduct = new Map<string, number>();
    for (const row of openingMovements) {
      const prev = openingByProduct.get(row.productId) ?? 0;
      openingByProduct.set(row.productId, prev + this.stockSignedQty(row.type, Number(row.quantity)));
    }

    const periodInward = new Map<string, number>();
    const periodOutward = new Map<string, number>();
    for (const row of movementsInPeriod) {
      const qty = Number(row.quantity);
      if (row.type === MovementType.IN) {
        periodInward.set(row.productId, (periodInward.get(row.productId) ?? 0) + qty);
      } else {
        periodOutward.set(row.productId, (periodOutward.get(row.productId) ?? 0) + qty);
      }
    }

    return products.map((product) => {
      const opening = openingByProduct.get(product.id) ?? 0;
      const inward = periodInward.get(product.id) ?? 0;
      const outward = periodOutward.get(product.id) ?? 0;
      return {
        productId: product.id,
        productName: product.name,
        hsnCode: product.hsnCode,
        opening: this.round3(opening),
        inward: this.round3(inward),
        outward: this.round3(outward),
        closing: this.round3(opening + inward - outward),
      };
    });
  }

  async getProfitByProductFifo(companyId: string, range: DateRangeInput) {
    const { from, to } = this.parseRange(range);
    const itemWhereBase: Prisma.InvoiceItemWhereInput = {
      invoice: {
        companyId,
        status: { not: InvoiceStatus.CANCELLED },
        deletedAt: null,
        ...(from || to
          ? {
              invoiceDate: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      },
    };

    const [products, sales, purchases] = await Promise.all([
      this.prisma.product.findMany({
        where: { companyId, deletedAt: null },
        select: { id: true, name: true },
      }),
      this.prisma.invoiceItem.groupBy({
        by: ['productId'],
        where: {
          ...itemWhereBase,
          invoice: {
            ...(itemWhereBase.invoice as Prisma.InvoiceWhereInput),
            type: InvoiceType.SALE,
          },
        },
        _sum: { quantity: true, amount: true },
      }),
      this.prisma.invoiceItem.groupBy({
        by: ['productId'],
        where: {
          ...itemWhereBase,
          invoice: {
            ...(itemWhereBase.invoice as Prisma.InvoiceWhereInput),
            type: InvoiceType.PURCHASE,
          },
        },
        _sum: { quantity: true, amount: true },
      }),
    ]);

    const salesMap = new Map(sales.map((row) => [row.productId, row]));
    const purchaseMap = new Map(purchases.map((row) => [row.productId, row]));

    return products.map((product) => {
      const saleRow = salesMap.get(product.id);
      const purchaseRow = purchaseMap.get(product.id);
      const saleAmount = Number(saleRow?._sum.amount ?? 0);
      const purchaseAmount = Number(purchaseRow?._sum.amount ?? 0);
      const profit = saleAmount - purchaseAmount;
      const margin = saleAmount > 0 ? (profit / saleAmount) * 100 : 0;
      return {
        productId: product.id,
        productName: product.name,
        saleQty: Number(saleRow?._sum.quantity ?? 0),
        saleAmount: this.round2(saleAmount),
        purchaseQty: Number(purchaseRow?._sum.quantity ?? 0),
        purchaseAmount: this.round2(purchaseAmount),
        profit: this.round2(profit),
        margin: this.round2(margin),
      };
    });
  }

  async getProductDetails(
    companyId: string,
    query: { productId?: string; dateFrom?: string; dateTo?: string },
  ) {
    const { from, to } = this.parseRange(query);
    return this.prisma.invoiceItem.findMany({
      where: {
        ...(query.productId ? { productId: query.productId } : {}),
        invoice: {
          companyId,
          status: { not: InvoiceStatus.CANCELLED },
          deletedAt: null,
          ...(from || to
            ? {
                invoiceDate: {
                  ...(from ? { gte: from } : {}),
                  ...(to ? { lte: to } : {}),
                },
              }
            : {}),
        },
      },
      select: {
        quantity: true,
        rate: true,
        amount: true,
        taxRate: true,
        taxAmount: true,
        product: { select: { id: true, name: true, hsnCode: true } },
        invoice: {
          select: {
            invoiceNumber: true,
            invoiceDate: true,
            type: true,
            account: {
              select: {
                party: { select: { name: true } },
              },
            },
          },
        },
      },
      orderBy: { invoice: { invoiceDate: 'asc' } },
    });
  }

  async getProductDetailsByCustomer(
    companyId: string,
    query: { productId: string; dateFrom?: string; dateTo?: string },
  ) {
    const rows = await this.getProductDetails(companyId, query);
    const grouped = new Map<
      string,
      { accountId: string; accountName: string; totalQty: number; totalAmount: number }
    >();

    for (const row of rows) {
      const accountId = row.invoice.account?.party?.name ?? 'unknown';
      const key = accountId;
      const existing = grouped.get(key) ?? {
        accountId: key,
        accountName: row.invoice.account?.party?.name ?? 'Unknown',
        totalQty: 0,
        totalAmount: 0,
      };

      existing.totalQty += Number(row.quantity);
      existing.totalAmount += Number(row.amount);
      grouped.set(key, existing);
    }

    return Array.from(grouped.values()).map((row) => ({
      ...row,
      totalQty: this.round3(row.totalQty),
      totalAmount: this.round2(row.totalAmount),
    }));
  }

  async getGstr1(companyId: string, range: { dateFrom: string; dateTo: string }) {
    const { from, to } = this.parseRange(range);
    return this.prisma.invoice.findMany({
      where: {
        companyId,
        type: { in: [InvoiceType.SALE, InvoiceType.SALE_RETURN] },
        status: { not: InvoiceStatus.CANCELLED },
        deletedAt: null,
        invoiceDate: {
          ...(from ? { gte: from } : {}),
          ...(to ? { lte: to } : {}),
        },
      },
      select: {
        invoiceNumber: true,
        invoiceDate: true,
        type: true,
        subTotal: true,
        taxAmount: true,
        discountAmount: true,
        totalAmount: true,
        account: {
          select: {
            party: {
              select: { name: true, gstin: true },
            },
          },
        },
      },
      orderBy: { invoiceDate: 'asc' },
    });
  }

  async getGstr3b(companyId: string, range: { dateFrom: string; dateTo: string }) {
    const { from, to } = this.parseRange(range);
    const [sales, purchases] = await Promise.all([
      this.prisma.invoice.aggregate({
        where: {
          companyId,
          type: { in: [InvoiceType.SALE, InvoiceType.SALE_RETURN] },
          status: { not: InvoiceStatus.CANCELLED },
          deletedAt: null,
          invoiceDate: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        },
        _sum: { subTotal: true, taxAmount: true, totalAmount: true },
      }),
      this.prisma.invoice.aggregate({
        where: {
          companyId,
          type: { in: [InvoiceType.PURCHASE, InvoiceType.PURCHASE_RETURN] },
          status: { not: InvoiceStatus.CANCELLED },
          deletedAt: null,
          invoiceDate: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        },
        _sum: { subTotal: true, taxAmount: true, totalAmount: true },
      }),
    ]);

    return {
      outward: {
        taxableValue: Number(sales._sum.subTotal ?? 0),
        tax: Number(sales._sum.taxAmount ?? 0),
        total: Number(sales._sum.totalAmount ?? 0),
      },
      inward: {
        taxableValue: Number(purchases._sum.subTotal ?? 0),
        tax: Number(purchases._sum.taxAmount ?? 0),
        total: Number(purchases._sum.totalAmount ?? 0),
      },
    };
  }

  async getGstSlabWise(companyId: string, range: { dateFrom: string; dateTo: string }) {
    const { from, to } = this.parseRange(range);
    const slabs = await this.prisma.invoiceItem.groupBy({
      by: ['taxRate'],
      where: {
        invoice: {
          companyId,
          type: { in: [InvoiceType.SALE, InvoiceType.PURCHASE] },
          status: { not: InvoiceStatus.CANCELLED },
          deletedAt: null,
          invoiceDate: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        },
      },
      _sum: {
        amount: true,
        taxAmount: true,
      },
      _count: { _all: true },
    });

    return slabs.map((slab) => ({
      gstRate: Number(slab.taxRate),
      taxableAmount: Number(slab._sum.amount ?? 0),
      taxAmount: Number(slab._sum.taxAmount ?? 0),
      count: slab._count._all,
    }));
  }

  async getTrialBalance(companyId: string, range: DateRangeInput) {
    const { from, to } = this.parseRange(range);
    const grouped = await this.prisma.ledgerEntry.groupBy({
      by: ['accountId'],
      where: {
        companyId,
        deletedAt: null,
        ...(from || to
          ? {
              date: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      },
      _sum: { debit: true, credit: true },
    });

    const accounts = await this.prisma.account.findMany({
      where: { id: { in: grouped.map((row) => row.accountId) } },
      select: {
        id: true,
        group: true,
        party: { select: { name: true } },
      },
    });
    const accountMap = new Map(accounts.map((row) => [row.id, row]));

    return grouped.map((row) => {
      const account = accountMap.get(row.accountId);
      const debit = Number(row._sum.debit ?? 0);
      const credit = Number(row._sum.credit ?? 0);
      return {
        accountId: row.accountId,
        accountName: account?.party?.name ?? 'Unknown',
        group: account?.group ?? null,
        debit: this.round2(debit),
        credit: this.round2(credit),
        balance: this.round2(debit - credit),
      };
    });
  }

  async getProfitAndLoss(companyId: string, range: DateRangeInput) {
    const { from, to } = this.parseRange(range);
    const [sales, saleReturns, purchases, purchaseReturns] = await Promise.all([
      this.sumByType(companyId, InvoiceType.SALE, from, to),
      this.sumByType(companyId, InvoiceType.SALE_RETURN, from, to),
      this.sumByType(companyId, InvoiceType.PURCHASE, from, to),
      this.sumByType(companyId, InvoiceType.PURCHASE_RETURN, from, to),
    ]);

    const revenue = sales - saleReturns;
    const expenses = purchases - purchaseReturns;
    return {
      revenue: this.round2(revenue),
      expenses: this.round2(expenses),
      netProfit: this.round2(revenue - expenses),
    };
  }

  async getBalanceSheet(companyId: string, query: { dateTo?: string }) {
    const trial = await this.getTrialBalance(companyId, {
      dateTo: query.dateTo,
    });

    const assets = trial
      .filter((row) =>
        ['SUNDRY_DEBTORS', 'BANK', 'CASH'].includes(String(row.group)),
      )
      .reduce((sum, row) => sum + row.balance, 0);
    const liabilities = trial
      .filter((row) =>
        ['SUNDRY_CREDITORS', 'CAPITAL'].includes(String(row.group)),
      )
      .reduce((sum, row) => sum + Math.abs(row.balance), 0);

    return {
      assets: this.round2(assets),
      liabilities: this.round2(liabilities),
      difference: this.round2(assets - liabilities),
      rows: trial,
    };
  }

  private async computeOutstanding(companyId: string) {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        companyId,
        deletedAt: null,
        status: { not: InvoiceStatus.CANCELLED },
        type: { in: [InvoiceType.SALE, InvoiceType.PURCHASE] },
      },
      select: {
        id: true,
        type: true,
        totalAmount: true,
      },
    });

    if (invoices.length === 0) {
      return {
        receivable: 0,
        payable: 0,
      };
    }

    const groupedPayments = await this.prisma.ledgerEntry.groupBy({
      by: ['invoiceId'],
      where: {
        companyId,
        invoiceId: { in: invoices.map((invoice) => invoice.id) },
      },
      _sum: { credit: true },
    });

    const paidMap = new Map(
      groupedPayments.map((row) => [row.invoiceId ?? '', Number(row._sum.credit ?? 0)]),
    );

    let receivable = 0;
    let payable = 0;

    for (const invoice of invoices) {
      const paid = paidMap.get(invoice.id) ?? 0;
      const remaining = Math.max(0, Number(invoice.totalAmount) - paid);
      if (invoice.type === InvoiceType.SALE) {
        receivable += remaining;
      } else if (invoice.type === InvoiceType.PURCHASE) {
        payable += remaining;
      }
    }

    return {
      receivable: this.round2(receivable),
      payable: this.round2(payable),
    };
  }

  private async getOutstandingByType(
    companyId: string,
    type: InvoiceType,
    range: DateRangeInput,
  ) {
    const { from, to } = this.parseRange(range);
    const invoices = await this.prisma.invoice.findMany({
      where: {
        companyId,
        type,
        status: { not: InvoiceStatus.CANCELLED },
        deletedAt: null,
        ...(from || to
          ? {
              invoiceDate: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      },
      select: {
        id: true,
        accountId: true,
        totalAmount: true,
      },
    });

    const groupedPayments = await this.prisma.ledgerEntry.groupBy({
      by: ['invoiceId'],
      where: {
        companyId,
        invoiceId: { in: invoices.map((invoice) => invoice.id) },
      },
      _sum: { credit: true },
    });
    const paidMap = new Map(
      groupedPayments.map((row) => [row.invoiceId ?? '', Number(row._sum.credit ?? 0)]),
    );

    const groupedByAccount = new Map<string, { totalDue: number; invoiceCount: number }>();
    for (const invoice of invoices) {
      const paid = paidMap.get(invoice.id) ?? 0;
      const due = Math.max(0, Number(invoice.totalAmount) - paid);
      const existing = groupedByAccount.get(invoice.accountId) ?? {
        totalDue: 0,
        invoiceCount: 0,
      };
      existing.totalDue += due;
      existing.invoiceCount += 1;
      groupedByAccount.set(invoice.accountId, existing);
    }

    const accounts = await this.prisma.account.findMany({
      where: { id: { in: Array.from(groupedByAccount.keys()) } },
      select: {
        id: true,
        party: {
          select: { name: true, gstin: true, address: true },
        },
      },
    });
    const accountMap = new Map(accounts.map((row) => [row.id, row]));

    return Array.from(groupedByAccount.entries()).map(([accountId, summary]) => {
      const account = accountMap.get(accountId);
      return {
        id: accountId,
        name: account?.party?.name ?? 'Unknown',
        gstin: account?.party?.gstin ?? null,
        address: account?.party?.address ?? null,
        totalDue: this.round2(summary.totalDue),
        invoiceCount: summary.invoiceCount,
      };
    });
  }

  private async sumByType(
    companyId: string,
    type: InvoiceType,
    from?: Date,
    to?: Date,
  ) {
    const aggregate = await this.prisma.invoice.aggregate({
      where: {
        companyId,
        type,
        status: { not: InvoiceStatus.CANCELLED },
        deletedAt: null,
        ...(from || to
          ? {
              invoiceDate: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      },
      _sum: { totalAmount: true },
    });
    return Number(aggregate._sum.totalAmount ?? 0);
  }

  private parseRange(input: DateRangeInput) {
    return {
      from: input.dateFrom ? new Date(input.dateFrom) : undefined,
      to: input.dateTo ? new Date(input.dateTo) : undefined,
    };
  }

  private stockSignedQty(type: MovementType, quantity: number) {
    return type === MovementType.IN ? quantity : -quantity;
  }

  private round2(value: number) {
    return Math.round(value * 100) / 100;
  }

  private round3(value: number) {
    return Math.round(value * 1000) / 1000;
  }
}
