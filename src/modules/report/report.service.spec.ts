import { Test, TestingModule } from '@nestjs/testing';
import { ReportService } from './report.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ReportService', () => {
  let service: ReportService;
  let prisma: jest.Mocked<Partial<PrismaService>>;

  beforeEach(async () => {
    prisma = {
      accountGroup: {
        findFirst: jest.fn(),
      } as any,
      invoice: {
        groupBy: jest.fn(),
        findMany: jest.fn(),
      } as any,
      invoiceItem: {
        groupBy: jest.fn(),
        findMany: jest.fn(),
      } as any,
      account: {
        findMany: jest.fn(),
      } as any,
      product: {
        findMany: jest.fn(),
        count: jest.fn(),
      } as any,
      stockMovement: {
        findMany: jest.fn(),
      } as any,
      $queryRaw: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ReportService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<ReportService>(ReportService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('aggregates outstanding debtors in grouped queries and applies date filters', async () => {
    (prisma.accountGroup!.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'group-1',
    });
    (prisma.invoice!.groupBy as jest.Mock).mockResolvedValueOnce([
      {
        accountId: 'account-1',
        _sum: { grandTotal: 1000, paidAmount: 400 },
        _count: { _all: 3 },
      },
    ]);
    (prisma.account!.findMany as jest.Mock).mockResolvedValueOnce([
      {
        id: 'account-1',
        name: 'Alpha Traders',
        gstin: '24ABCDE1234F1Z5',
        city: 'Surat',
      },
    ]);

    const result = await service.getOutstandingDebtors('company-1', {
      dateFrom: '2026-01-01',
      dateTo: '2026-01-31',
    });

    expect(prisma.invoice!.groupBy).toHaveBeenCalledWith({
      by: ['accountId'],
      where: {
        companyId: 'company-1',
        invoiceType: 'SALE',
        status: { notIn: ['CANCELLED', 'DRAFT'] },
        account: { groupId: 'group-1' },
        invoiceDate: {
          gte: new Date('2026-01-01'),
          lte: new Date('2026-01-31'),
        },
      },
      _sum: {
        grandTotal: true,
        paidAmount: true,
      },
      _count: {
        _all: true,
      },
    });
    expect(result).toEqual([
      {
        id: 'account-1',
        name: 'Alpha Traders',
        gstin: '24ABCDE1234F1Z5',
        city: 'Surat',
        totalDue: 600,
        invoiceCount: 3,
      },
    ]);
  });

  it('builds stock reports from batched movement queries instead of per-product loops', async () => {
    (prisma.product!.findMany as jest.Mock).mockResolvedValueOnce([
      { id: 'product-1', name: 'Grey Fabric', hsnCode: '5208' },
      { id: 'product-2', name: 'Dyed Fabric', hsnCode: '5209' },
    ]);
    (prisma.stockMovement!.findMany as jest.Mock)
      .mockResolvedValueOnce([
        { productId: 'product-1', type: 'IN', quantity: 10 },
        { productId: 'product-1', type: 'OUT', quantity: 4 },
        { productId: 'product-2', type: 'ADJUSTMENT_IN', quantity: 2 },
      ])
      .mockResolvedValueOnce([
        { productId: 'product-1', type: 'OPENING', quantity: 5 },
        { productId: 'product-2', type: 'OUT', quantity: 1 },
      ]);

    const result = await service.getStockReport('company-1', {
      dateFrom: '2026-01-01',
      dateTo: '2026-01-31',
    });

    expect(prisma.stockMovement!.findMany).toHaveBeenCalledTimes(2);
    expect(result).toEqual([
      {
        productId: 'product-1',
        productName: 'Grey Fabric',
        hsnCode: '5208',
        opening: 5,
        inward: 10,
        outward: 4,
        closing: 11,
      },
      {
        productId: 'product-2',
        productName: 'Dyed Fabric',
        hsnCode: '5209',
        opening: -1,
        inward: 2,
        outward: 0,
        closing: 1,
      },
    ]);
  });

  it('aggregates product profit data without loading every invoice item row', async () => {
    (prisma.product!.findMany as jest.Mock).mockResolvedValueOnce([
      { id: 'product-1', name: 'Grey Fabric' },
      { id: 'product-2', name: 'Dyed Fabric' },
    ]);
    (prisma.invoiceItem!.groupBy as jest.Mock)
      .mockResolvedValueOnce([
        {
          productId: 'product-1',
          _sum: { quantity: 10, amount: 1500 },
        },
      ])
      .mockResolvedValueOnce([
        {
          productId: 'product-1',
          _sum: { quantity: 8, amount: 1000 },
        },
        {
          productId: 'product-2',
          _sum: { quantity: 4, amount: 600 },
        },
      ]);

    const result = await service.getProfitByProductFifo('company-1', {
      dateFrom: '2026-01-01',
      dateTo: '2026-01-31',
    });

    expect(prisma.invoiceItem!.groupBy).toHaveBeenNthCalledWith(1, {
      by: ['productId'],
      where: {
        invoice: {
          companyId: 'company-1',
          invoiceType: 'SALE',
          status: { not: 'CANCELLED' },
          invoiceDate: {
            gte: new Date('2026-01-01'),
            lte: new Date('2026-01-31'),
          },
        },
      },
      _sum: {
        quantity: true,
        amount: true,
      },
    });
    expect(result).toEqual([
      {
        productId: 'product-1',
        productName: 'Grey Fabric',
        saleQty: 10,
        saleAmount: 1500,
        purchaseQty: 8,
        purchaseAmount: 1000,
        profit: 500,
        margin: 33.33,
      },
      {
        productId: 'product-2',
        productName: 'Dyed Fabric',
        saleQty: 0,
        saleAmount: 0,
        purchaseQty: 4,
        purchaseAmount: 600,
        profit: -600,
        margin: 0,
      },
    ]);
  });

  it('aggregates GST slab totals in the database', async () => {
    (prisma.invoiceItem!.groupBy as jest.Mock).mockResolvedValueOnce([
      {
        gstRate: 5,
        _sum: {
          taxableAmount: 1000,
          cgstAmount: 25,
          sgstAmount: 25,
          igstAmount: 0,
        },
        _count: { _all: 2 },
      },
      {
        gstRate: 12,
        _sum: {
          taxableAmount: 500,
          cgstAmount: 0,
          sgstAmount: 0,
          igstAmount: 60,
        },
        _count: { _all: 1 },
      },
    ]);

    const result = await service.getGstSlabWise('company-1', {
      dateFrom: '2026-04-01',
      dateTo: '2026-04-30',
    });

    expect(prisma.invoiceItem!.groupBy).toHaveBeenCalledWith({
      by: ['gstRate'],
      where: {
        invoice: {
          companyId: 'company-1',
          invoiceType: { in: ['SALE', 'PURCHASE'] },
          status: { not: 'CANCELLED' },
          invoiceDate: {
            gte: new Date('2026-04-01'),
            lte: new Date('2026-04-30'),
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
    expect(result).toEqual([
      {
        gstRate: 5,
        taxableAmount: 1000,
        cgst: 25,
        sgst: 25,
        igst: 0,
        count: 2,
        totalTax: 50,
      },
      {
        gstRate: 12,
        taxableAmount: 500,
        cgst: 0,
        sgst: 0,
        igst: 60,
        count: 1,
        totalTax: 60,
      },
    ]);
  });

  it('aggregates dashboard KPIs with grouped invoice summaries and a direct product count', async () => {
    const frozenNow = new Date('2026-03-12T10:30:00.000Z');
    const dayStart = new Date(frozenNow);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    jest.useFakeTimers().setSystemTime(frozenNow);

    (prisma.invoice!.groupBy as jest.Mock)
      .mockResolvedValueOnce([
        {
          invoiceType: 'SALE',
          _sum: { grandTotal: 1500 },
        },
        {
          invoiceType: 'PURCHASE',
          _sum: { grandTotal: 650 },
        },
      ])
      .mockResolvedValueOnce([
        {
          invoiceType: 'SALE',
          _sum: { grandTotal: 5000, paidAmount: 1500 },
        },
        {
          invoiceType: 'PURCHASE',
          _sum: { grandTotal: 3200, paidAmount: 2000 },
        },
      ]);
    (prisma.product!.count as jest.Mock).mockResolvedValueOnce(14);

    const result = await service.getDashboardKpis('company-1');

    expect(prisma.invoice!.groupBy).toHaveBeenNthCalledWith(1, {
      by: ['invoiceType'],
      where: {
        companyId: 'company-1',
        invoiceType: { in: ['SALE', 'PURCHASE'] },
        status: { not: 'CANCELLED' },
        invoiceDate: {
          gte: dayStart,
          lt: dayEnd,
        },
      },
      _sum: { grandTotal: true },
    });
    expect(prisma.invoice!.groupBy).toHaveBeenNthCalledWith(2, {
      by: ['invoiceType'],
      where: {
        companyId: 'company-1',
        invoiceType: { in: ['SALE', 'PURCHASE'] },
        status: { not: 'CANCELLED' },
      },
      _sum: { grandTotal: true, paidAmount: true },
    });
    expect(prisma.product!.count).toHaveBeenCalledWith({
      where: { companyId: 'company-1' },
    });
    expect(result).toEqual({
      todaySales: 1500,
      todayPurchases: 650,
      outstandingReceivable: 3500,
      outstandingPayable: 1200,
      totalProducts: 14,
    });
  });

  it('returns a dense Jan-Dec monthly chart from one grouped query', async () => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValueOnce([
      { monthIndex: 1, invoiceType: 'SALE', total: 2500.5 },
      { monthIndex: 1, invoiceType: 'PURCHASE', total: 1200 },
      { monthIndex: 3, invoiceType: 'SALE', total: 500 },
    ]);

    const result = await service.getMonthlySalesChart('company-1', 2026);

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      { month: 'Jan', sales: 2500.5, purchases: 1200 },
      { month: 'Feb', sales: 0, purchases: 0 },
      { month: 'Mar', sales: 500, purchases: 0 },
      { month: 'Apr', sales: 0, purchases: 0 },
      { month: 'May', sales: 0, purchases: 0 },
      { month: 'Jun', sales: 0, purchases: 0 },
      { month: 'Jul', sales: 0, purchases: 0 },
      { month: 'Aug', sales: 0, purchases: 0 },
      { month: 'Sep', sales: 0, purchases: 0 },
      { month: 'Oct', sales: 0, purchases: 0 },
      { month: 'Nov', sales: 0, purchases: 0 },
      { month: 'Dec', sales: 0, purchases: 0 },
    ]);
  });

  it('groups product details by customer in the database', async () => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValueOnce([
      {
        accountId: 'account-1',
        accountName: 'Alpha Traders',
        totalQty: 12.5,
        totalAmount: 1560.25,
      },
      {
        accountId: 'account-2',
        accountName: 'Beta Traders',
        totalQty: 4,
        totalAmount: 500,
      },
    ]);

    const result = await service.getProductDetailsByCustomer('company-1', {
      productId: 'product-1',
      dateFrom: '2026-05-01',
      dateTo: '2026-05-31',
    });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      {
        accountId: 'account-1',
        accountName: 'Alpha Traders',
        totalQty: 12.5,
        totalAmount: 1560.25,
      },
      {
        accountId: 'account-2',
        accountName: 'Beta Traders',
        totalQty: 4,
        totalAmount: 500,
      },
    ]);
  });

  it('loads only the fields used by GSTR1', async () => {
    (prisma.invoice!.findMany as jest.Mock).mockResolvedValueOnce([]);

    await service.getGstr1('company-1', {
      dateFrom: '2026-06-01',
      dateTo: '2026-06-30',
    });

    expect(prisma.invoice!.findMany).toHaveBeenCalledWith({
      where: {
        companyId: 'company-1',
        invoiceType: { in: ['SALE', 'SALE_RETURN'] },
        status: { not: 'CANCELLED' },
        invoiceDate: {
          gte: new Date('2026-06-01'),
          lte: new Date('2026-06-30'),
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
  });

  it('loads only the fields needed for product details', async () => {
    (prisma.invoiceItem!.findMany as jest.Mock).mockResolvedValueOnce([]);

    await service.getProductDetails('company-1', {
      productId: 'product-1',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
    });

    expect(prisma.invoiceItem!.findMany).toHaveBeenCalledWith({
      where: {
        productId: 'product-1',
        invoice: {
          companyId: 'company-1',
          status: { not: 'CANCELLED' },
          invoiceDate: {
            gte: new Date('2026-07-01'),
            lte: new Date('2026-07-31'),
          },
        },
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
  });
});
