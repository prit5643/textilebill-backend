import { Test, TestingModule } from '@nestjs/testing';
import { ReportService } from './report.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ReportService', () => {
  let service: ReportService;
  let prisma: jest.Mocked<Partial<PrismaService>>;

  beforeEach(async () => {
    prisma = {
      invoice: {
        aggregate: jest.fn(),
        findMany: jest.fn(),
      } as any,
      ledgerEntry: {
        groupBy: jest.fn(),
      } as any,
      product: {
        count: jest.fn(),
        findMany: jest.fn(),
      } as any,
      stockMovement: {
        findMany: jest.fn(),
      } as any,
      invoiceItem: {
        groupBy: jest.fn(),
      } as any,
      account: {
        findMany: jest.fn(),
      } as any,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ReportService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<ReportService>(ReportService);
  });

  it('computes dashboard KPIs from invoice aggregates and product count', async () => {
    (prisma.invoice!.aggregate as jest.Mock)
      .mockResolvedValueOnce({ _sum: { totalAmount: 1500 } })
      .mockResolvedValueOnce({ _sum: { totalAmount: 650 } });
    (prisma.product!.count as jest.Mock).mockResolvedValueOnce(14);
    (prisma.invoice!.findMany as jest.Mock).mockResolvedValueOnce([
      { id: 'inv-1', type: 'SALE', totalAmount: 1000 },
      { id: 'inv-2', type: 'PURCHASE', totalAmount: 700 },
    ]);
    (prisma.ledgerEntry!.groupBy as jest.Mock).mockResolvedValueOnce([
      { invoiceId: 'inv-1', _sum: { credit: 250 } },
      { invoiceId: 'inv-2', _sum: { credit: 100 } },
    ]);

    const result = await service.getDashboardKpis('company-1');

    expect(result).toEqual({
      todaySales: 1500,
      todayPurchases: 650,
      outstandingReceivable: 750,
      outstandingPayable: 600,
      totalProducts: 14,
    });
  });

  it('builds monthly sales/purchase chart with dense Jan-Dec buckets', async () => {
    (prisma.invoice!.findMany as jest.Mock).mockResolvedValueOnce([
      {
        invoiceDate: new Date('2026-01-10'),
        type: 'SALE',
        totalAmount: 2500.5,
      },
      {
        invoiceDate: new Date('2026-01-15'),
        type: 'PURCHASE',
        totalAmount: 1200,
      },
      { invoiceDate: new Date('2026-03-07'), type: 'SALE', totalAmount: 500 },
    ]);

    const result = await service.getMonthlySalesChart('company-1', 2026);

    expect(result[0]).toEqual({ month: 'Jan', sales: 2500.5, purchases: 1200 });
    expect(result[1]).toEqual({ month: 'Feb', sales: 0, purchases: 0 });
    expect(result[2]).toEqual({ month: 'Mar', sales: 500, purchases: 0 });
    expect(result).toHaveLength(12);
  });

  it('computes stock report using opening and in-period stock movement batches', async () => {
    (prisma.product!.findMany as jest.Mock).mockResolvedValueOnce([
      { id: 'product-1', name: 'Grey Fabric', hsnCode: '5208' },
      { id: 'product-2', name: 'Dyed Fabric', hsnCode: '5209' },
    ]);
    (prisma.stockMovement!.findMany as jest.Mock)
      .mockResolvedValueOnce([
        { productId: 'product-1', type: 'IN', quantity: 10 },
        { productId: 'product-1', type: 'OUT', quantity: 4 },
        { productId: 'product-2', type: 'IN', quantity: 2 },
      ])
      .mockResolvedValueOnce([
        { productId: 'product-1', type: 'IN', quantity: 5 },
        { productId: 'product-2', type: 'OUT', quantity: 1 },
      ]);

    const result = await service.getStockReport('company-1', {
      dateFrom: '2026-01-01',
      dateTo: '2026-01-31',
    });

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

  it('returns GST slab aggregates from invoice-item groupBy', async () => {
    (prisma.invoiceItem!.groupBy as jest.Mock).mockResolvedValueOnce([
      {
        taxRate: 5,
        _sum: { amount: 1000, taxAmount: 50 },
        _count: { _all: 2 },
      },
      {
        taxRate: 12,
        _sum: { amount: 500, taxAmount: 60 },
        _count: { _all: 1 },
      },
    ]);

    const result = await service.getGstSlabWise('company-1', {
      dateFrom: '2026-04-01',
      dateTo: '2026-04-30',
    });

    expect(result).toEqual([
      {
        gstRate: 5,
        taxableAmount: 1000,
        taxAmount: 50,
        count: 2,
      },
      {
        gstRate: 12,
        taxableAmount: 500,
        taxAmount: 60,
        count: 1,
      },
    ]);
  });
});
