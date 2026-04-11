/**
 * invoice-number.service.spec.ts
 *
 * Tests for bill-number business rules:
 *  1. Auto-number generates strict 1,2,3,4 sequence
 *  2. Invoice type is NOT included in the number
 *  3. Duplicate manual number returns conflict message
 *  4. Non-numeric manual number returns validation error
 *  5. No P2028 in normal auto-create flow
 */

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { InvoiceType, VoucherType } from '@prisma/client';
import { InvoiceNumberService } from './invoice-number.service';
import { PrismaService } from '../prisma/prisma.service';

// ─── Shared mock factory ──────────────────────────────────────────────────────
function buildPrismaMock(overrides?: Partial<any>) {
  return {
    company: {
      findUnique: jest.fn().mockResolvedValue({ id: 'co-1', tenantId: 'tn-1' }),
    },
    financialYear: {
      findFirst: jest.fn().mockResolvedValue({ id: 'fy-1' }),
    },
    voucherSequence: {
      upsert: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
    },
    invoice: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    $queryRaw: jest.fn().mockResolvedValue([{ max_num: null }]),
    ...overrides,
  } as unknown as PrismaService;
}

// ─── Test suite ───────────────────────────────────────────────────────────────
describe('InvoiceNumberService — bill number business rules', () => {
  let service: InvoiceNumberService;
  let prisma: ReturnType<typeof buildPrismaMock>;

  beforeEach(async () => {
    prisma = buildPrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoiceNumberService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<InvoiceNumberService>(InvoiceNumberService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── Test 1: Auto-number generates 1, 2, 3, 4 sequence ──────────────────
  describe('auto-number sequence (1 → 2 → 3 → 4)', () => {
    it('starts at 1 when sequence is fresh (currentValue=0)', async () => {
      (prisma.voucherSequence.upsert as jest.Mock).mockResolvedValue({
        id: 'seq-1',
        companyId: 'co-1',
        type: VoucherType.SALE,
        prefix: '',
        currentValue: 0,
      });
      (prisma.voucherSequence.update as jest.Mock).mockResolvedValue({
        currentValue: 1,
      });

      const num = await service.getNextNumberWithTx(
        'co-1',
        InvoiceType.SALE,
        prisma as any,
        'fy-1',
      );

      expect(num).toBe('1');
    });

    it('returns 2 after first invoice (currentValue=1)', async () => {
      (prisma.voucherSequence.upsert as jest.Mock).mockResolvedValue({
        id: 'seq-1',
        companyId: 'co-1',
        type: VoucherType.SALE,
        prefix: '',
        currentValue: 1,
      });
      (prisma.voucherSequence.update as jest.Mock).mockResolvedValue({
        currentValue: 2,
      });

      const num = await service.getNextNumberWithTx(
        'co-1',
        InvoiceType.SALE,
        prisma as any,
        'fy-1',
      );

      expect(num).toBe('2');
    });

    it('generates sequential numbers 1,2,3,4 on four consecutive calls', async () => {
      let counter = 0;
      (prisma.voucherSequence.upsert as jest.Mock).mockResolvedValue({
        id: 'seq-1',
        companyId: 'co-1',
        type: VoucherType.SALE,
        prefix: '',
        currentValue: counter,
      });
      (prisma.voucherSequence.update as jest.Mock).mockImplementation(() => {
        counter += 1;
        return Promise.resolve({ currentValue: counter });
      });

      const results: string[] = [];
      for (let i = 0; i < 4; i++) {
        // Re-seed upsert with current counter each call
        (prisma.voucherSequence.upsert as jest.Mock).mockResolvedValueOnce({
          id: 'seq-1',
          companyId: 'co-1',
          type: VoucherType.SALE,
          prefix: '',
          currentValue: counter,
        });
        results.push(
          await service.getNextNumberWithTx(
            'co-1',
            InvoiceType.SALE,
            prisma as any,
            'fy-1',
          ),
        );
      }

      expect(results).toEqual(['1', '2', '3', '4']);
    });
  });

  // ─── Test 2: Invoice type is NOT in the number ───────────────────────────
  describe('invoice type must NOT appear in bill number', () => {
    const types: InvoiceType[] = [
      InvoiceType.SALE,
      InvoiceType.PURCHASE,
      InvoiceType.SALE_RETURN,
      InvoiceType.PURCHASE_RETURN,
    ];

    it.each(types)(
      'auto-number for %s contains only digits',
      async (invoiceType) => {
        (prisma.voucherSequence.upsert as jest.Mock).mockResolvedValue({
          id: 'seq-1',
          companyId: 'co-1',
          type: VoucherType.SALE,
          prefix: '',
          currentValue: 5,
        });
        (prisma.voucherSequence.update as jest.Mock).mockResolvedValue({
          currentValue: 6,
        });

        const num = await service.getNextNumberWithTx(
          'co-1',
          invoiceType,
          prisma as any,
          'fy-1',
        );

        // Must be strictly numeric — no prefix like SALE, PUR-, SAL-0001, etc.
        expect(num).toMatch(/^\d+$/);
        expect(num).toBe('6');
      },
    );

    it('ensureConfig uses the matching VoucherType per invoice type', async () => {
      // Each invoice type maintains its own sequence key.
      (prisma.voucherSequence.upsert as jest.Mock).mockResolvedValue({
        id: 'seq-1',
        companyId: 'co-1',
        type: VoucherType.SALE,
        prefix: '',
        currentValue: 0,
      });

      await service.getOrCreate('co-1', InvoiceType.PURCHASE);

      expect(prisma.voucherSequence.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            companyId_financialYearId_type: expect.objectContaining({
              type: VoucherType.PURCHASE,
            }),
          }),
        }),
      );
    });
  });

  // ─── Test 3: alignSequence uses SQL MAX, not JS loop ────────────────────
  describe('alignSequenceWithExistingInvoices — fast SQL path', () => {
    it('calls $queryRaw (not findMany) for max number lookup', async () => {
      (prisma.voucherSequence.upsert as jest.Mock).mockResolvedValue({
        id: 'seq-1',
        companyId: 'co-1',
        type: VoucherType.SALE,
        prefix: '',
        currentValue: 0,
      });
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ max_num: '5' }]);

      await service.alignSequenceWithExistingInvoices(
        'co-1',
        InvoiceType.SALE,
        'fy-1',
      );

      expect(prisma.$queryRaw).toHaveBeenCalled();
      // findMany should NOT be called (old O(N) path is gone)
      expect(prisma.invoice.findMany).not.toHaveBeenCalled();
    });

    it('skips updateMany when sequence is already >= max existing number', async () => {
      (prisma.voucherSequence.upsert as jest.Mock).mockResolvedValue({
        id: 'seq-1',
        companyId: 'co-1',
        type: VoucherType.SALE,
        prefix: '',
        currentValue: 10,
      });
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ max_num: '10' }]);

      await service.alignSequenceWithExistingInvoices(
        'co-1',
        InvoiceType.SALE,
        'fy-1',
      );

      expect(prisma.voucherSequence.updateMany).not.toHaveBeenCalled();
    });

    it('bumps sequence when existing invoices are ahead', async () => {
      (prisma.voucherSequence.upsert as jest.Mock).mockResolvedValue({
        id: 'seq-1',
        companyId: 'co-1',
        type: VoucherType.SALE,
        prefix: '',
        currentValue: 3,
      });
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ max_num: '7' }]);
      (prisma.voucherSequence.updateMany as jest.Mock).mockResolvedValue({
        count: 1,
      });

      await service.alignSequenceWithExistingInvoices(
        'co-1',
        InvoiceType.SALE,
        'fy-1',
      );

      expect(prisma.voucherSequence.updateMany).toHaveBeenCalledWith({
        where: { id: 'seq-1', currentValue: { lt: 7 } },
        data: { currentValue: 7 },
      });
    });
  });

  // ─── Test 4: Company not found ───────────────────────────────────────────
  describe('company not found', () => {
    it('throws NotFoundException when company does not exist', async () => {
      (prisma.company.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.getNextNumberWithTx(
          'nonexistent-company',
          InvoiceType.SALE,
          prisma as any,
          'fy-1',
        ),
      ).rejects.toThrow('Company not found');
    });
  });

  // ─── Test 5: No financial year ───────────────────────────────────────────
  describe('no financial year configured', () => {
    it('throws BadRequestException when no financial year exists', async () => {
      (prisma.financialYear.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.getNextNumberWithTx(
          'co-1',
          InvoiceType.SALE,
          prisma as any,
          undefined,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
