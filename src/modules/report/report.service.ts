import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';

type InvoiceTypeSummaryRow = {
  invoiceType: string;
  _sum: {
    grandTotal: Decimal | number | null;
    paidAmount?: Decimal | number | null;
  };
};

type MonthlyInvoiceChartRow = {
  monthIndex: number;
  invoiceType: string;
  total: Decimal | number;
};

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

@Injectable()
export class ReportService {
  private readonly logger = new Logger(ReportService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ═══════════════ LEDGER REPORTS ═══════════════

  async getOutstandingDebtors(
    companyId: string,
    query: { dateFrom?: string; dateTo?: string } = {},
  ) {
    const debtorGroup = await this.prisma.accountGroup.findFirst({
      where: { name: 'Sundry Debtors' },
    });
    if (!debtorGroup) return [];

    const grouped = await this.prisma.invoice.groupBy({
      by: ['accountId'],
      where: {
        companyId,
        invoiceType: 'SALE',
        status: { notIn: ['CANCELLED', 'DRAFT'] },
        account: { groupId: debtorGroup.id },
        ...this.buildDateFilter(query.dateFrom, query.dateTo),
      },
      _sum: {
        grandTotal: true,
        paidAmount: true,
      },
      _count: {
        _all: true,
      },
    });

    const accountIds = grouped.map((entry) => entry.accountId);
    if (accountIds.length === 0) return [];

    const accounts = await this.prisma.account.findMany({
      where: { companyId, id: { in: accountIds } },
      select: { id: true, name: true, gstin: true, city: true },
    });
    const accountMap = new Map(
      accounts.map((account) => [account.id, account]),
    );

    return grouped
      .map((entry) => {
        const account = accountMap.get(entry.accountId);
        if (!account) return null;

        const totalDue = this.round2(
          Number(entry._sum.grandTotal ?? 0) -
            Number(entry._sum.paidAmount ?? 0),
        );

        if (totalDue <= 0.01) return null;

        return {
          ...account,
          totalDue,
          invoiceCount: entry._count._all,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .sort((a, b) => b.totalDue - a.totalDue);
  }

  async getOutstandingCreditors(
    companyId: string,
    query: { dateFrom?: string; dateTo?: string } = {},
  ) {
    const creditorGroup = await this.prisma.accountGroup.findFirst({
      where: { name: 'Sundry Creditors' },
    });
    if (!creditorGroup) return [];

    const grouped = await this.prisma.invoice.groupBy({
      by: ['accountId'],
      where: {
        companyId,
        invoiceType: 'PURCHASE',
        status: { notIn: ['CANCELLED', 'DRAFT'] },
        account: { groupId: creditorGroup.id },
        ...this.buildDateFilter(query.dateFrom, query.dateTo),
      },
      _sum: {
        grandTotal: true,
        paidAmount: true,
      },
      _count: {
        _all: true,
      },
    });

    const accountIds = grouped.map((entry) => entry.accountId);
    if (accountIds.length === 0) return [];

    const accounts = await this.prisma.account.findMany({
      where: { companyId, id: { in: accountIds } },
      select: { id: true, name: true, gstin: true, city: true },
    });
    const accountMap = new Map(
      accounts.map((account) => [account.id, account]),
    );

    return grouped
      .map((entry) => {
        const account = accountMap.get(entry.accountId);
        if (!account) return null;

        const totalDue = this.round2(
          Number(entry._sum.grandTotal ?? 0) -
            Number(entry._sum.paidAmount ?? 0),
        );

        if (totalDue <= 0.01) return null;

        return {
          ...account,
          totalDue,
          invoiceCount: entry._count._all,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .sort((a, b) => b.totalDue - a.totalDue);
  }

  async getDayBook(companyId: string, date: string) {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    const entries = await this.prisma.ledgerEntry.findMany({
      where: { companyId, date: { gte: dayStart, lte: dayEnd } },
      include: {
        account: { select: { id: true, name: true } },
        invoice: { select: { id: true, invoiceNumber: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return entries.map((e) => ({
      ...e,
      debit: Number(e.debit),
      credit: Number(e.credit),
    }));
  }

  // ═══════════════ STOCK REPORTS ═══════════════

  async getStockReport(
    companyId: string,
    query: { productId?: string; dateFrom?: string; dateTo?: string },
  ) {
    const products = await this.prisma.product.findMany({
      where: { companyId, ...(query.productId ? { id: query.productId } : {}) },
      select: { id: true, name: true, hsnCode: true },
    });

    if (products.length === 0) return [];

    const productWhere = query.productId ? { productId: query.productId } : {};
    const [movements, priorMovements] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where: {
          companyId,
          ...productWhere,
          ...this.buildMovementDateFilter(query.dateFrom, query.dateTo),
        },
        select: {
          productId: true,
          type: true,
          quantity: true,
        },
      }),
      query.dateFrom
        ? this.prisma.stockMovement.findMany({
            where: {
              companyId,
              ...productWhere,
              date: { lt: new Date(query.dateFrom) },
            },
            select: {
              productId: true,
              type: true,
              quantity: true,
            },
          })
        : Promise.resolve([]),
    ]);

    const openingMap = new Map<string, number>();
    const inwardMap = new Map<string, number>();
    const outwardMap = new Map<string, number>();

    for (const movement of priorMovements) {
      openingMap.set(
        movement.productId,
        this.round3(
          (openingMap.get(movement.productId) ?? 0) +
            this.getSignedStockQuantity(
              movement.type,
              Number(movement.quantity),
            ),
        ),
      );
    }

    for (const movement of movements) {
      const targetMap = this.isInboundMovement(movement.type)
        ? inwardMap
        : outwardMap;

      targetMap.set(
        movement.productId,
        this.round3(
          (targetMap.get(movement.productId) ?? 0) + Number(movement.quantity),
        ),
      );
    }

    return products.map((product) => {
      const opening = openingMap.get(product.id) ?? 0;
      const inward = inwardMap.get(product.id) ?? 0;
      const outward = outwardMap.get(product.id) ?? 0;

      return {
        productId: product.id,
        productName: product.name,
        hsnCode: product.hsnCode,
        opening,
        inward,
        outward,
        closing: this.round3(opening + inward - outward),
      };
    });
  }

  async getProfitByProductFifo(
    companyId: string,
    query: { dateFrom?: string; dateTo?: string },
  ) {
    const dateFilter = this.buildDateFilter(query.dateFrom, query.dateTo);

    const [saleItems, purchaseItems] = await Promise.all([
      this.prisma.invoiceItem.groupBy({
        by: ['productId'],
        where: {
          invoice: {
            companyId,
            invoiceType: 'SALE',
            status: { not: 'CANCELLED' },
            ...dateFilter,
          },
        },
        _sum: {
          quantity: true,
          amount: true,
        },
      }),
      this.prisma.invoiceItem.groupBy({
        by: ['productId'],
        where: {
          invoice: {
            companyId,
            invoiceType: 'PURCHASE',
            status: { not: 'CANCELLED' },
            ...dateFilter,
          },
        },
        _sum: {
          quantity: true,
          amount: true,
        },
      }),
    ]);

    const productIds = Array.from(
      new Set([
        ...saleItems.map((item) => item.productId),
        ...purchaseItems.map((item) => item.productId),
      ]),
    );

    const products = await this.prisma.product.findMany({
      where: { companyId, id: { in: productIds } },
      select: { id: true, name: true },
    });
    const productNameMap = new Map(
      products.map((product) => [product.id, product.name]),
    );

    const productMap = new Map<
      string,
      {
        name: string;
        saleQty: number;
        saleAmount: number;
        purchaseQty: number;
        purchaseAmount: number;
      }
    >();

    for (const item of saleItems) {
      const existing = productMap.get(item.productId) || {
        name: productNameMap.get(item.productId) || 'Unknown Product',
        saleQty: 0,
        saleAmount: 0,
        purchaseQty: 0,
        purchaseAmount: 0,
      };
      existing.saleQty += Number(item._sum.quantity || 0);
      existing.saleAmount += Number(item._sum.amount || 0);
      productMap.set(item.productId, existing);
    }

    for (const item of purchaseItems) {
      const existing = productMap.get(item.productId) || {
        name: productNameMap.get(item.productId) || 'Unknown Product',
        saleQty: 0,
        saleAmount: 0,
        purchaseQty: 0,
        purchaseAmount: 0,
      };
      existing.purchaseQty += Number(item._sum.quantity || 0);
      existing.purchaseAmount += Number(item._sum.amount || 0);
      productMap.set(item.productId, existing);
    }

    return Array.from(productMap.entries()).map(([productId, data]) => ({
      productId,
      productName: data.name,
      saleQty: data.saleQty,
      saleAmount: Math.round(data.saleAmount * 100) / 100,
      purchaseQty: data.purchaseQty,
      purchaseAmount: Math.round(data.purchaseAmount * 100) / 100,
      profit: Math.round((data.saleAmount - data.purchaseAmount) * 100) / 100,
      margin:
        data.saleAmount > 0
          ? Math.round(
              ((data.saleAmount - data.purchaseAmount) / data.saleAmount) *
                10000,
            ) / 100
          : 0,
    }));
  }

  // ═══════════════ GST REPORTS ═══════════════

  async getGstr1(
    companyId: string,
    query: { dateFrom: string; dateTo: string },
  ) {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        companyId,
        invoiceType: { in: ['SALE', 'SALE_RETURN'] },
        status: { not: 'CANCELLED' },
        invoiceDate: {
          gte: new Date(query.dateFrom),
          lte: new Date(query.dateTo),
        },
      },
      select: {
        invoiceNumber: true,
        invoiceDate: true,
        invoiceType: true,
        taxableAmount: true,
        totalCgst: true,
        totalSgst: true,
        totalIgst: true,
        totalTax: true,
        grandTotal: true,
        placeOfSupply: true,
        account: {
          select: {
            name: true,
            gstin: true,
            gstType: true,
          },
        },
      },
      orderBy: { invoiceDate: 'asc' },
    });

    const b2b: unknown[] = [];
    const b2c: unknown[] = [];
    const cdnr: unknown[] = [];

    for (const inv of invoices) {
      const entry = {
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate,
        partyName: inv.account.name,
        gstin: inv.account.gstin,
        taxableAmount: Number(inv.taxableAmount),
        cgst: Number(inv.totalCgst),
        sgst: Number(inv.totalSgst),
        igst: Number(inv.totalIgst),
        totalTax: Number(inv.totalTax),
        grandTotal: Number(inv.grandTotal),
        placeOfSupply: inv.placeOfSupply,
      };

      if (inv.invoiceType === 'SALE_RETURN') {
        cdnr.push(entry);
      } else if (inv.account.gstin && inv.account.gstType === 'REGULAR') {
        b2b.push(entry);
      } else {
        b2c.push(entry);
      }
    }

    return {
      period: { from: query.dateFrom, to: query.dateTo },
      b2b,
      b2c,
      cdnr,
      summary: {
        totalTaxable: b2b
          .concat(b2c)
          .reduce(
            (s: number, i: Record<string, number>) => s + i.taxableAmount,
            0,
          ),
        totalCgst: invoices.reduce((s, i) => s + Number(i.totalCgst), 0),
        totalSgst: invoices.reduce((s, i) => s + Number(i.totalSgst), 0),
        totalIgst: invoices.reduce((s, i) => s + Number(i.totalIgst), 0),
        totalTax: invoices.reduce((s, i) => s + Number(i.totalTax), 0),
      },
    };
  }

  async getGstr3b(
    companyId: string,
    query: { dateFrom: string; dateTo: string },
  ) {
    const dateFilter = {
      invoiceDate: {
        gte: new Date(query.dateFrom),
        lte: new Date(query.dateTo),
      },
    };

    const [sales, purchases, saleReturns, purchaseReturns] = await Promise.all([
      this.prisma.invoice.aggregate({
        where: {
          companyId,
          invoiceType: 'SALE',
          status: { not: 'CANCELLED' },
          ...dateFilter,
        },
        _sum: {
          taxableAmount: true,
          totalCgst: true,
          totalSgst: true,
          totalIgst: true,
          totalTax: true,
          grandTotal: true,
        },
      }),
      this.prisma.invoice.aggregate({
        where: {
          companyId,
          invoiceType: 'PURCHASE',
          status: { not: 'CANCELLED' },
          ...dateFilter,
        },
        _sum: {
          taxableAmount: true,
          totalCgst: true,
          totalSgst: true,
          totalIgst: true,
          totalTax: true,
          grandTotal: true,
        },
      }),
      this.prisma.invoice.aggregate({
        where: {
          companyId,
          invoiceType: 'SALE_RETURN',
          status: { not: 'CANCELLED' },
          ...dateFilter,
        },
        _sum: {
          taxableAmount: true,
          totalCgst: true,
          totalSgst: true,
          totalIgst: true,
          totalTax: true,
          grandTotal: true,
        },
      }),
      this.prisma.invoice.aggregate({
        where: {
          companyId,
          invoiceType: 'PURCHASE_RETURN',
          status: { not: 'CANCELLED' },
          ...dateFilter,
        },
        _sum: {
          taxableAmount: true,
          totalCgst: true,
          totalSgst: true,
          totalIgst: true,
          totalTax: true,
          grandTotal: true,
        },
      }),
    ]);

    const toNum = (v: Decimal | null) => Number(v || 0);

    return {
      period: { from: query.dateFrom, to: query.dateTo },
      outwardSupplies: {
        taxableAmount:
          toNum(sales._sum.taxableAmount) -
          toNum(saleReturns._sum.taxableAmount),
        cgst: toNum(sales._sum.totalCgst) - toNum(saleReturns._sum.totalCgst),
        sgst: toNum(sales._sum.totalSgst) - toNum(saleReturns._sum.totalSgst),
        igst: toNum(sales._sum.totalIgst) - toNum(saleReturns._sum.totalIgst),
      },
      inwardSupplies: {
        taxableAmount:
          toNum(purchases._sum.taxableAmount) -
          toNum(purchaseReturns._sum.taxableAmount),
        cgst:
          toNum(purchases._sum.totalCgst) -
          toNum(purchaseReturns._sum.totalCgst),
        sgst:
          toNum(purchases._sum.totalSgst) -
          toNum(purchaseReturns._sum.totalSgst),
        igst:
          toNum(purchases._sum.totalIgst) -
          toNum(purchaseReturns._sum.totalIgst),
      },
      netTaxPayable: {
        cgst:
          toNum(sales._sum.totalCgst) -
          toNum(saleReturns._sum.totalCgst) -
          toNum(purchases._sum.totalCgst) +
          toNum(purchaseReturns._sum.totalCgst),
        sgst:
          toNum(sales._sum.totalSgst) -
          toNum(saleReturns._sum.totalSgst) -
          toNum(purchases._sum.totalSgst) +
          toNum(purchaseReturns._sum.totalSgst),
        igst:
          toNum(sales._sum.totalIgst) -
          toNum(saleReturns._sum.totalIgst) -
          toNum(purchases._sum.totalIgst) +
          toNum(purchaseReturns._sum.totalIgst),
      },
    };
  }

  async getGstSlabWise(
    companyId: string,
    query: { dateFrom: string; dateTo: string },
  ) {
    const slabs = await this.prisma.invoiceItem.groupBy({
      by: ['gstRate'],
      where: {
        invoice: {
          companyId,
          invoiceType: { in: ['SALE', 'PURCHASE'] },
          status: { not: 'CANCELLED' },
          invoiceDate: {
            gte: new Date(query.dateFrom),
            lte: new Date(query.dateTo),
          },
        },
      },
      _sum: {
        taxableAmount: true,
        cgstAmount: true,
        sgstAmount: true,
        igstAmount: true,
      },
      _count: {
        _all: true,
      },
    });

    return slabs
      .map((slab) => {
        const taxableAmount = this.round2(Number(slab._sum.taxableAmount || 0));
        const cgst = this.round2(Number(slab._sum.cgstAmount || 0));
        const sgst = this.round2(Number(slab._sum.sgstAmount || 0));
        const igst = this.round2(Number(slab._sum.igstAmount || 0));

        return {
          gstRate: Number(slab.gstRate),
          taxableAmount,
          cgst,
          sgst,
          igst,
          count: slab._count._all,
          totalTax: this.round2(cgst + sgst + igst),
        };
      })
      .sort((a, b) => a.gstRate - b.gstRate);
  }

  // ═══════════════ FINANCIAL REPORTS ═══════════════

  async getTrialBalance(
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

    const accountIds = result.map((r) => r.accountId);
    const accounts = await this.prisma.account.findMany({
      where: { id: { in: accountIds } },
      select: {
        id: true,
        name: true,
        group: { select: { name: true, nature: true } },
      },
    });
    const accountMap = new Map(accounts.map((a) => [a.id, a]));

    let totalDebit = 0;
    let totalCredit = 0;

    const entries = result.map((r) => {
      const account = accountMap.get(r.accountId);
      const dr = Number(r._sum.debit || 0);
      const cr = Number(r._sum.credit || 0);
      const balance = dr - cr;
      totalDebit += balance > 0 ? balance : 0;
      totalCredit += balance < 0 ? Math.abs(balance) : 0;
      return {
        accountId: r.accountId,
        accountName: account?.name || 'Unknown',
        groupName: (account as any)?.group?.name,
        nature: (account as any)?.group?.nature,
        debit: Math.round(dr * 100) / 100,
        credit: Math.round(cr * 100) / 100,
        closingDebit: balance > 0 ? Math.round(balance * 100) / 100 : 0,
        closingCredit:
          balance < 0 ? Math.round(Math.abs(balance) * 100) / 100 : 0,
      };
    });

    return {
      entries,
      totalDebit: Math.round(totalDebit * 100) / 100,
      totalCredit: Math.round(totalCredit * 100) / 100,
    };
  }

  async getProfitAndLoss(
    companyId: string,
    query: { dateFrom?: string; dateTo?: string },
  ) {
    const trialBalance = await this.getTrialBalance(companyId, query);

    const income = trialBalance.entries.filter((e) => e.nature === 'Income');
    const expense = trialBalance.entries.filter((e) => e.nature === 'Expense');

    const totalIncome = income.reduce(
      (s, e) => s + e.closingCredit - e.closingDebit,
      0,
    );
    const totalExpense = expense.reduce(
      (s, e) => s + e.closingDebit - e.closingCredit,
      0,
    );

    return {
      income: income.map((e) => ({
        ...e,
        amount: e.closingCredit - e.closingDebit,
      })),
      expense: expense.map((e) => ({
        ...e,
        amount: e.closingDebit - e.closingCredit,
      })),
      totalIncome: Math.round(totalIncome * 100) / 100,
      totalExpense: Math.round(totalExpense * 100) / 100,
      netProfit: Math.round((totalIncome - totalExpense) * 100) / 100,
    };
  }

  async getBalanceSheet(companyId: string, query: { dateTo?: string }) {
    const trialBalance = await this.getTrialBalance(companyId, {
      dateTo: query.dateTo,
    });

    const assets = trialBalance.entries.filter((e) => e.nature === 'Asset');
    const liabilities = trialBalance.entries.filter(
      (e) => e.nature === 'Liability',
    );

    const totalAssets = assets.reduce(
      (s, e) => s + e.closingDebit - e.closingCredit,
      0,
    );
    const totalLiabilities = liabilities.reduce(
      (s, e) => s + e.closingCredit - e.closingDebit,
      0,
    );

    // P&L balance
    const pnl = await this.getProfitAndLoss(companyId, {
      dateTo: query.dateTo,
    });

    return {
      assets: assets.map((e) => ({
        ...e,
        amount: e.closingDebit - e.closingCredit,
      })),
      liabilities: liabilities.map((e) => ({
        ...e,
        amount: e.closingCredit - e.closingDebit,
      })),
      totalAssets: Math.round(totalAssets * 100) / 100,
      totalLiabilities:
        Math.round((totalLiabilities + pnl.netProfit) * 100) / 100,
      netProfit: pnl.netProfit,
    };
  }

  // ═══════════════ PRODUCT REPORTS ═══════════════

  async getProductDetails(
    companyId: string,
    query: { productId?: string; dateFrom?: string; dateTo?: string },
  ) {
    const dateFilter = this.buildDateFilter(query.dateFrom, query.dateTo);

    const items = await this.prisma.invoiceItem.findMany({
      where: {
        ...(query.productId ? { productId: query.productId } : {}),
        invoice: { companyId, status: { not: 'CANCELLED' }, ...dateFilter },
      },
      select: {
        quantity: true,
        rate: true,
        amount: true,
        taxableAmount: true,
        product: { select: { id: true, name: true, hsnCode: true } },
        invoice: {
          select: {
            invoiceNumber: true,
            invoiceDate: true,
            invoiceType: true,
            account: { select: { name: true } },
          },
        },
      },
      orderBy: { invoice: { invoiceDate: 'asc' } },
    });

    return items.map((i) => ({
      invoiceNumber: i.invoice.invoiceNumber,
      invoiceDate: i.invoice.invoiceDate,
      invoiceType: i.invoice.invoiceType,
      partyName: i.invoice.account.name,
      productName: i.product.name,
      hsnCode: i.product.hsnCode,
      quantity: Number(i.quantity),
      rate: Number(i.rate),
      amount: Number(i.amount),
      taxableAmount: Number(i.taxableAmount),
    }));
  }

  async getProductDetailsByCustomer(
    companyId: string,
    query: { productId: string; dateFrom?: string; dateTo?: string },
  ) {
    const conditions = [
      Prisma.sql`ii."productId" = ${query.productId}`,
      Prisma.sql`i."companyId" = ${companyId}`,
      Prisma.sql`i."invoiceType" = 'SALE'`,
      Prisma.sql`i."status" <> 'CANCELLED'`,
    ];

    if (query.dateFrom) {
      conditions.push(
        Prisma.sql`i."invoiceDate" >= ${new Date(query.dateFrom)}`,
      );
    }
    if (query.dateTo) {
      conditions.push(Prisma.sql`i."invoiceDate" <= ${new Date(query.dateTo)}`);
    }

    const rows = await this.prisma.$queryRaw<
      Array<{
        accountId: string;
        accountName: string;
        totalQty: Decimal | number;
        totalAmount: Decimal | number;
      }>
    >(Prisma.sql`
      SELECT
        i."accountId" AS "accountId",
        a."name" AS "accountName",
        COALESCE(SUM(ii."quantity"), 0) AS "totalQty",
        COALESCE(SUM(ii."amount"), 0) AS "totalAmount"
      FROM "InvoiceItem" ii
      INNER JOIN "Invoice" i ON i."id" = ii."invoiceId"
      INNER JOIN "Account" a ON a."id" = i."accountId"
      WHERE ${Prisma.join(conditions, ' AND ')}
      GROUP BY i."accountId", a."name"
      ORDER BY a."name" ASC
    `);

    return rows.map((row) => ({
      accountId: row.accountId,
      accountName: row.accountName,
      totalQty: this.round3(Number(row.totalQty ?? 0)),
      totalAmount: this.round2(Number(row.totalAmount ?? 0)),
    }));
  }

  // ═══════════════ DASHBOARD KPIs ═══════════════

  async getDashboardKpis(companyId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [todayTotals, lifetimeTotals, totalProducts] = await Promise.all([
      this.prisma.invoice.groupBy({
        by: ['invoiceType'],
        where: {
          companyId,
          invoiceType: { in: ['SALE', 'PURCHASE'] },
          status: { not: 'CANCELLED' },
          invoiceDate: { gte: today, lt: tomorrow },
        },
        _sum: { grandTotal: true },
      }),
      this.prisma.invoice.groupBy({
        by: ['invoiceType'],
        where: {
          companyId,
          invoiceType: { in: ['SALE', 'PURCHASE'] },
          status: { not: 'CANCELLED' },
        },
        _sum: { grandTotal: true, paidAmount: true },
      }),
      this.prisma.product.count({
        where: { companyId },
      }),
    ]);

    const saleToday = this.getInvoiceSummary(todayTotals, 'SALE');
    const purchaseToday = this.getInvoiceSummary(todayTotals, 'PURCHASE');
    const saleLifetime = this.getInvoiceSummary(lifetimeTotals, 'SALE');
    const purchaseLifetime = this.getInvoiceSummary(lifetimeTotals, 'PURCHASE');

    return {
      todaySales: this.round2(saleToday.grandTotal),
      todayPurchases: this.round2(purchaseToday.grandTotal),
      outstandingReceivable: this.round2(
        saleLifetime.grandTotal - saleLifetime.paidAmount,
      ),
      outstandingPayable: this.round2(
        purchaseLifetime.grandTotal - purchaseLifetime.paidAmount,
      ),
      totalProducts,
    };
  }

  async getMonthlySalesChart(companyId: string, year: number) {
    const yearStart = new Date(year, 0, 1);
    const nextYearStart = new Date(year + 1, 0, 1);

    const rows = await this.prisma.$queryRaw<MonthlyInvoiceChartRow[]>(
      Prisma.sql`
        SELECT
          EXTRACT(MONTH FROM "invoiceDate")::int AS "monthIndex",
          "invoiceType" AS "invoiceType",
          COALESCE(SUM("grandTotal"), 0) AS "total"
        FROM "Invoice"
        WHERE "companyId" = ${companyId}
          AND "invoiceType" IN ('SALE', 'PURCHASE')
          AND "status" <> 'CANCELLED'
          AND "invoiceDate" >= ${yearStart}
          AND "invoiceDate" < ${nextYearStart}
        GROUP BY EXTRACT(MONTH FROM "invoiceDate"), "invoiceType"
        ORDER BY EXTRACT(MONTH FROM "invoiceDate") ASC, "invoiceType" ASC
      `,
    );

    return this.buildMonthlyChartSeries(rows);
  }

  private buildDateFilter(dateFrom?: string, dateTo?: string) {
    if (!dateFrom && !dateTo) return {};
    const filter: Record<string, unknown> = { invoiceDate: {} };
    if (dateFrom)
      (filter.invoiceDate as Record<string, unknown>).gte = new Date(dateFrom);
    if (dateTo)
      (filter.invoiceDate as Record<string, unknown>).lte = new Date(dateTo);
    return filter;
  }

  private buildMovementDateFilter(dateFrom?: string, dateTo?: string) {
    if (!dateFrom && !dateTo) return {};
    const filter: Record<string, unknown> = { date: {} };
    if (dateFrom)
      (filter.date as Record<string, unknown>).gte = new Date(dateFrom);
    if (dateTo) (filter.date as Record<string, unknown>).lte = new Date(dateTo);
    return filter;
  }

  private isInboundMovement(type: string) {
    return ['IN', 'ADJUSTMENT_IN', 'OPENING'].includes(type);
  }

  private getInvoiceSummary(
    rows: InvoiceTypeSummaryRow[],
    invoiceType: string,
  ) {
    const match = rows.find((row) => row.invoiceType === invoiceType);

    return {
      grandTotal: Number(match?._sum.grandTotal ?? 0),
      paidAmount: Number(match?._sum.paidAmount ?? 0),
    };
  }

  private buildMonthlyChartSeries(rows: MonthlyInvoiceChartRow[]) {
    const totals = new Map<string, number>();

    rows.forEach((row) => {
      totals.set(
        `${row.monthIndex}:${row.invoiceType}`,
        this.round2(Number(row.total ?? 0)),
      );
    });

    return MONTH_LABELS.map((month, index) => ({
      month,
      sales: totals.get(`${index + 1}:SALE`) ?? 0,
      purchases: totals.get(`${index + 1}:PURCHASE`) ?? 0,
    }));
  }

  private getSignedStockQuantity(type: string, quantity: number) {
    return this.isInboundMovement(type) ? quantity : -quantity;
  }

  private round2(value: number) {
    return Math.round(value * 100) / 100;
  }

  private round3(value: number) {
    return Math.round(value * 1000) / 1000;
  }
}
