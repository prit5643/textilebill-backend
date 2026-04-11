/**
 * invoice.service.spec.ts
 *
 * Unit tests for InvoiceService create() path, including:
 *  - auto-number generation
 *  - numeric-only manual bill number validation
 *  - duplicate manual bill number returns conflict message
 *  - no P2028 in normal create flow (tx body stays minimal)
 *  - payment ledger tagging
 */

import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceService } from './invoice.service';
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceNumberService } from './invoice-number.service';

// ─── Shared tx mock ───────────────────────────────────────────────────────────
function buildTx(invoiceId = 'invoice-1') {
  return {
    product: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'product-1', taxRate: 5 }]),
    },
    invoice: {
      create: jest.fn().mockResolvedValue({ id: invoiceId }),
    },
    invoiceItem: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

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
          name: 'Alpha Textiles',
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
      alignSequenceWithExistingInvoices: jest.fn().mockResolvedValue(undefined),
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

  afterEach(() => jest.clearAllMocks());

  // ─── Happy path: auto-number ──────────────────────────────────────────────
  it('creates invoice with auto-generated numeric bill number', async () => {
    (prisma.invoice!.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'invoice-1',
      invoiceNumber: '1', // strictly numeric, no prefix
      accountId: 'account-1',
      subTotal: 1000,
      taxAmount: 50,
      discountAmount: 0,
      totalAmount: 1050,
      items: [],
      account: { party: { name: 'Test Party' } },
    });

    (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb) =>
      cb(buildTx()),
    );

    const result = await service.create('company-1', null, 'user-1', {
      invoiceType: 'SALE' as any,
      invoiceDate: '2026-04-10',
      accountId: 'account-1',
      items: [{ productId: 'product-1', quantity: 10, rate: 100 }],
    } as any);

    // Auto-number flow: alignment runs BEFORE tx, then getNextNumberWithTx inside tx
    expect(invoiceNumberService.alignSequenceWithExistingInvoices).toHaveBeenCalledWith(
      'company-1',
      'SALE',
      'fy-1',
    );
    expect(invoiceNumberService.getNextNumberWithTx).toHaveBeenCalled();
    // Result number is purely numeric
    expect(result.invoiceNumber).toMatch(/^\d+$/);
    expect(result.invoiceNumber).toBe('1');
  });

  // ─── Non-numeric manual bill number → BadRequestException ────────────────
  describe('non-numeric manual bill number', () => {
    const nonNumericCases = [
      'SAL-001',
      'PUR-0001',
      'SAL001',
      'ABC',
      '1A',
      'SALE',
    ];

    it.each(nonNumericCases)(
      'rejects "%s" with a validation error before touching the DB',
      async (badNumber) => {
        await expect(
          service.create('company-1', null, 'user-1', {
            invoiceType: 'SALE' as any,
            invoiceDate: '2026-04-10',
            accountId: 'account-1',
            invoiceNumber: badNumber,
            items: [{ productId: 'product-1', quantity: 1, rate: 100 }],
          } as any),
        ).rejects.toThrow(BadRequestException);

        // Transaction must NOT have been called
        expect(prisma.$transaction).not.toHaveBeenCalled();
      },
    );
  });

  // ─── Duplicate manual bill number → ConflictException ────────────────────
  it('returns a friendly conflict message for duplicate manual bill number', async () => {
    // Simulate an existing invoice with the same number in the DB
    (prisma.invoice!.findFirst as jest.Mock).mockResolvedValueOnce({
      invoiceNumber: '42',
      type: 'SALE',
    });

    await expect(
      service.create('company-1', null, 'user-1', {
        invoiceType: 'SALE' as any,
        invoiceDate: '2026-04-10',
        accountId: 'account-1',
        invoiceNumber: '42',
        items: [{ productId: 'product-1', quantity: 1, rate: 100 }],
      } as any),
    ).rejects.toThrow(ConflictException);

    // Transaction must NOT have been called — duplicate caught pre-tx
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('conflict message mentions the duplicate bill number', async () => {
    (prisma.invoice!.findFirst as jest.Mock).mockResolvedValueOnce({
      invoiceNumber: '99',
      type: 'SALE',
    });

    try {
      await service.create('company-1', null, 'user-1', {
        invoiceType: 'SALE' as any,
        invoiceDate: '2026-04-10',
        accountId: 'account-1',
        invoiceNumber: '99',
        items: [{ productId: 'product-1', quantity: 1, rate: 100 }],
      } as any);
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).message).toContain('99');
      expect((err as ConflictException).message).toContain('already exists');
    }
  });

  // ─── No P2028: transaction body stays minimal ─────────────────────────────
  it('alignment runs OUTSIDE transaction (no P2028 risk)', async () => {
    const txCallOrder: string[] = [];

    (invoiceNumberService.alignSequenceWithExistingInvoices as jest.Mock)
      .mockImplementation(async () => {
        txCallOrder.push('align');
      });

    (prisma.$transaction as jest.Mock).mockImplementation(async (cb) => {
      txCallOrder.push('tx-start');
      const result = await cb(buildTx());
      txCallOrder.push('tx-end');
      return result;
    });

    (invoiceNumberService.getNextNumberWithTx as jest.Mock)
      .mockImplementation(async () => {
        txCallOrder.push('getNextNumber');
        return '1';
      });

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

    await service.create('company-1', null, 'user-1', {
      invoiceType: 'SALE' as any,
      invoiceDate: '2026-04-10',
      accountId: 'account-1',
      items: [{ productId: 'product-1', quantity: 10, rate: 100 }],
    } as any);

    // alignment must come before tx starts
    expect(txCallOrder.indexOf('align')).toBeLessThan(
      txCallOrder.indexOf('tx-start'),
    );
  });

  // ─── Payment ledger tagging ───────────────────────────────────────────────
  it('records invoice payments as tagged ledger entries', async () => {
    (prisma.invoice!.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'invoice-1',
      accountId: 'account-1',
      invoiceNumber: '5', // strictly numeric
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
      invoiceNumber: '5', // strictly numeric
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
    expect(result).toEqual([{ id: 'p-1', credit: 100, narration: '[INVOICE_PAYMENT]' }]);
  });

  // ─── Invoice not found ────────────────────────────────────────────────────
  it('throws NotFoundException when invoice does not exist', async () => {
    (prisma.invoice!.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(service.findById('company-1', 'bad-id')).rejects.toThrow(
      NotFoundException,
    );
  });
});
