import { Test, TestingModule } from '@nestjs/testing';
import { InvoiceService } from './invoice.service';
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceNumberService } from './invoice-number.service';

describe('InvoiceService', () => {
  let service: InvoiceService;
  let prisma: jest.Mocked<Partial<PrismaService>>;
  let invoiceNumberService: jest.Mocked<Partial<InvoiceNumberService>>;

  beforeEach(async () => {
    prisma = {
      company: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'company-1',
          tenantId: 'tenant-1',
          name: 'Alpha',
          gstin: null,
          address: null,
          phone: null,
          email: null,
        }),
      } as any,
      account: {
        findFirst: jest.fn().mockResolvedValue({ id: 'account-1' }),
      } as any,
      financialYear: {
        findFirst: jest.fn().mockResolvedValue({ id: 'fy-1' }),
      } as any,
      $transaction: jest.fn(),
      invoice: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        groupBy: jest.fn(),
        aggregate: jest.fn(),
      } as any,
      ledgerEntry: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        delete: jest.fn(),
        groupBy: jest.fn(),
      } as any,
    };

    invoiceNumberService = {
      getNextNumberWithTx: jest.fn().mockResolvedValue('1'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoiceService,
        { provide: PrismaService, useValue: prisma },
        { provide: InvoiceNumberService, useValue: invoiceNumberService },
      ],
    }).compile();

    service = module.get<InvoiceService>(InvoiceService);
  });

  it('creates invoice with computed totals and generated number', async () => {
    (prisma.invoice!.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'invoice-1',
      invoiceNumber: '1',
      accountId: 'account-1',
      subTotal: 1000,
      taxAmount: 50,
      discountAmount: 0,
      totalAmount: 1050,
      items: [],
      account: { party: { name: 'Party' } },
    });

    (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb) => {
      const tx = {
        product: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ id: 'product-1', taxRate: 5 }]),
        },
        invoice: {
          create: jest.fn().mockResolvedValue({
            id: 'invoice-1',
          }),
        },
        invoiceItem: {
          createMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      };
      return cb(tx);
    });

    const result = await service.create('company-1', null, 'user-1', {
      invoiceType: 'SALE' as any,
      invoiceDate: '2026-04-10',
      accountId: 'account-1',
      items: [{ productId: 'product-1', quantity: 10, rate: 100 }],
    } as any);

    expect(invoiceNumberService.getNextNumberWithTx).toHaveBeenCalled();
    expect(result).toMatchObject({
      id: 'invoice-1',
      invoiceNumber: '1',
    });
  });

  it('records invoice payments as tagged ledger entries', async () => {
    (prisma.invoice!.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'invoice-1',
      accountId: 'account-1',
      invoiceNumber: 'SAL-0001',
      companyId: 'company-1',
      deletedAt: null,
      items: [],
      account: { party: { id: 'party-1', name: 'Party' } },
    });
    (prisma.ledgerEntry!.create as jest.Mock).mockResolvedValueOnce({
      id: 'payment-1',
    });

    await service.recordPayment('company-1', 'invoice-1', {
      paymentDate: '2026-04-12',
      amount: 500,
      paymentMode: 'CASH',
      narration: 'Advance',
    });

    expect(prisma.ledgerEntry!.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: 'company-1',
        invoiceId: 'invoice-1',
        credit: 500,
        narration: expect.stringContaining('[INVOICE_PAYMENT]'),
      }),
    });
  });

  it('finds invoice payments using ledger tag filtering', async () => {
    (prisma.invoice!.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'invoice-1',
      accountId: 'account-1',
      invoiceNumber: 'SAL-0001',
      companyId: 'company-1',
      deletedAt: null,
      items: [],
      account: { party: { id: 'party-1', name: 'Party' } },
    });
    (prisma.ledgerEntry!.findMany as jest.Mock).mockResolvedValueOnce([
      { id: 'p-1', credit: 100, narration: '[INVOICE_PAYMENT]' },
    ]);

    const result = await service.getPayments('company-1', 'invoice-1');

    expect(prisma.ledgerEntry!.findMany).toHaveBeenCalledWith({
      where: {
        companyId: 'company-1',
        invoiceId: 'invoice-1',
        narration: { contains: '[INVOICE_PAYMENT]' },
      },
      orderBy: { date: 'desc' },
      select: { id: true, date: true, credit: true, narration: true },
    });
    expect(result).toEqual([
      { id: 'p-1', credit: 100, narration: '[INVOICE_PAYMENT]' },
    ]);
  });
});
