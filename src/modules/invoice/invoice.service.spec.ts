import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { InvoiceService } from './invoice.service';
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceNumberService } from './invoice-number.service';
import { Decimal } from '@prisma/client/runtime/library';

describe('InvoiceService', () => {
  let service: InvoiceService;
  let prisma: jest.Mocked<Partial<PrismaService>>;
  let invoiceNumberService: jest.Mocked<Partial<InvoiceNumberService>>;

  beforeEach(async () => {
    prisma = {
      company: {
        findUnique: jest.fn(),
      } as any,
      invoice: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      } as any,
      invoicePayment: {
        findFirst: jest.fn(),
      } as any,
      $transaction: jest.fn(),
    };


    invoiceNumberService = {
      getNextNumber: jest.fn(),
      getNextNumberWithTx: jest.fn(),
      getOrCreate: jest.fn(),
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

  describe('create', () => {
    it('stores initial payments atomically and derives PARTIALLY_PAID status', async () => {
      (invoiceNumberService.getNextNumberWithTx as jest.Mock).mockResolvedValueOnce(
        'INV-0001',
      );
      (invoiceNumberService.getOrCreate as jest.Mock).mockResolvedValueOnce({
        stockEffect: false,
        ledgerEffect: true,
      });
      (prisma.company!.findUnique as jest.Mock).mockResolvedValueOnce({
        state: 'Gujarat',
        gstin: '24ABCDE1234F1Z5',
      });

      (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb) => {
        const tx = {
          invoice: {
            create: jest.fn().mockImplementation(({ data }) => {
              expect(data.status).toBe('PARTIALLY_PAID');
              expect(data.paidAmount.toNumber()).toBe(200);
              expect(data.receivedAmount.toNumber()).toBe(200);
              expect(data.remainingAmount.toNumber()).toBe(800);

              return {
                id: 'inv-1',
                status: 'PARTIALLY_PAID',
                accountId: 'acc-1',
                invoiceNumber: 'INV-001',
              };
            }),
          },
          invoicePayment: {
            create: jest.fn().mockResolvedValue({ id: 'pay-1' }),
          },
          ledgerEntry: {
            create: jest.fn().mockResolvedValue({}),
          },
        };


        const tx_with_invoiceNumberConfig = {
          ...tx,
          invoiceNumberConfig: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'config-1',
              isAutoNumber: true,
              currentNumber: 0,
              prefix: 'INV',
              suffix: undefined,
              startingNumber: 1,
            }),
            update: jest.fn().mockResolvedValue({
              id: 'config-1',
              currentNumber: 1,
              prefix: 'INV',
              suffix: null,
              startingNumber: 1,
            }),
            create: jest.fn().mockResolvedValue({
              id: 'config-1',
              isAutoNumber: true,
              currentNumber: 1,
              prefix: 'INV',
              suffix: null,
              startingNumber: 1,
            }),
          },
        };

        const result = await cb(tx_with_invoiceNumberConfig);
        expect(tx.invoicePayment.create).toHaveBeenCalledWith({
          data: {
            invoiceId: 'inv-1',
            paymentDate: new Date('2026-03-12'),
            amount: expect.anything(),
            paymentMode: 'CASH',
            bookName: 'Cash Book',
            narration: 'Advance payment',
          },
          select: { id: true },
        });
        expect(tx.ledgerEntry.create).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({
            data: expect.objectContaining({
              voucherType: 'RECEIPT',
              voucherNumber: 'pay-1',
            }),
          }),
        );

        return result;
      });

      await service.create('company-1', 'fy-1', 'user-1', {
        invoiceType: 'SALE',
        invoiceDate: '2026-03-12',
        accountId: 'acc-1',
        receivedAmount: 200,
        paymentMode: 'CASH',
        paymentBookName: 'Cash Book',
        paymentNarration: 'Advance payment',
        items: [
          {
            productId: 'product-1',
            quantity: 10,
            rate: 100,
            discountPercent: 0,
            gstRate: 0,
          },
        ],
      } as any);
    });

    it('rejects draft invoices that include a received amount', async () => {
      (invoiceNumberService.getNextNumber as jest.Mock).mockResolvedValueOnce(
        'INV-001',
      );
      (prisma.company!.findUnique as jest.Mock).mockResolvedValueOnce({
        state: 'Gujarat',
        gstin: '24ABCDE1234F1Z5',
      });

      await expect(
        service.create('company-1', 'fy-1', 'user-1', {
          invoiceType: 'SALE',
          invoiceDate: '2026-03-12',
          accountId: 'acc-1',
          status: 'DRAFT',
          receivedAmount: 100,
          items: [
            {
              productId: 'product-1',
              quantity: 1,
              rate: 100,
              discountPercent: 0,
              gstRate: 0,
            },
          ],
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('resolves invoice numbers inside the transaction context', async () => {
      (invoiceNumberService.getNextNumberWithTx as jest.Mock).mockResolvedValueOnce(
        'INV-0001',
      );
      (invoiceNumberService.getOrCreate as jest.Mock).mockResolvedValueOnce({
        stockEffect: false,
        ledgerEffect: true,
      });
      (prisma.company!.findUnique as jest.Mock).mockResolvedValueOnce({
        state: 'Gujarat',
        gstin: '24ABCDE1234F1Z5',
      });

      (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb) => {
        const tx = {
          invoiceNumberConfig: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'config-1',
              isAutoNumber: true,
              currentNumber: 0,
              prefix: 'INV',
              suffix: null,
              startingNumber: 1,
            }),
            update: jest.fn().mockResolvedValue({
              id: 'config-1',
              currentNumber: 1,
              prefix: 'INV',
              suffix: null,
              startingNumber: 1,
            }),
            create: jest.fn().mockResolvedValue({
              id: 'config-1',
              currentNumber: 1,
              isAutoNumber: true,
              prefix: 'INV',
              suffix: null,
              startingNumber: 1,
            }),
          },
          invoice: {
            create: jest.fn().mockResolvedValue({
              id: 'inv-2',
              status: 'ACTIVE',
              accountId: 'acc-1',
              invoiceNumber: 'INV-0001',
            }),
          },
          invoicePayment: {
            create: jest.fn(),
          },
          ledgerEntry: {
            create: jest.fn().mockResolvedValue({}),
          },
        };

        return cb(tx);
      });

      await service.create('company-1', 'fy-1', 'user-1', {
        invoiceType: 'SALE',
        invoiceDate: '2026-03-12',
        accountId: 'acc-1',
        items: [
          {
            productId: 'product-1',
            quantity: 1,
            rate: 100,
            discountPercent: 0,
            gstRate: 0,
          },
        ],
      } as any);

      expect(invoiceNumberService.getNextNumberWithTx).toHaveBeenCalledTimes(1);
      const txArg = (invoiceNumberService.getNextNumberWithTx as jest.Mock).mock
        .calls[0][2];
      expect(txArg).toBeDefined();
      expect(txArg.invoiceNumberConfig).toBeDefined();
    });

    it('allows only one winner when parallel creates collide on unique invoice number', async () => {
      (invoiceNumberService.getNextNumberWithTx as jest.Mock).mockResolvedValue(
        'INV-0001',
      );
      (invoiceNumberService.getOrCreate as jest.Mock).mockResolvedValue({
        stockEffect: false,
        ledgerEffect: false,
      });
      (prisma.company!.findUnique as jest.Mock).mockResolvedValue({
        state: 'Gujarat',
        gstin: '24ABCDE1234F1Z5',
      });

      let createCount = 0;
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb) => {
        const tx = {
          invoiceNumberConfig: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'config-1',
              isAutoNumber: true,
              currentNumber: 0,
              prefix: 'INV',
              suffix: null,
              startingNumber: 1,
            }),
            update: jest.fn().mockResolvedValue({
              id: 'config-1',
              currentNumber: 1,
              prefix: 'INV',
              suffix: null,
              startingNumber: 1,
            }),
            create: jest.fn(),
          },
          invoice: {
            create: jest.fn().mockImplementation(async () => {
              createCount += 1;
              if (createCount === 1) {
                return {
                  id: 'inv-1',
                  status: 'ACTIVE',
                  accountId: 'acc-1',
                  invoiceNumber: 'INV-0001',
                };
              }

              const error = new Error('Unique constraint failed');
              (error as any).code = 'P2002';
              throw error;
            }),
          },
          invoicePayment: {
            create: jest.fn(),
          },
          ledgerEntry: {
            create: jest.fn(),
          },
        };

        return cb(tx);
      });

      const dto = {
        invoiceType: 'SALE',
        invoiceDate: '2026-03-12',
        accountId: 'acc-1',
        items: [
          {
            productId: 'product-1',
            quantity: 1,
            rate: 100,
            discountPercent: 0,
            gstRate: 0,
          },
        ],
      } as any;

      const [first, second] = await Promise.allSettled([
        service.create('company-1', 'fy-1', 'user-1', dto),
        service.create('company-1', 'fy-1', 'user-1', dto),
      ]);

      const fulfilledCount = [first, second].filter(
        (entry) => entry.status === 'fulfilled',
      ).length;
      const rejectedCount = [first, second].filter(
        (entry) => entry.status === 'rejected',
      ).length;

      expect(fulfilledCount).toBe(1);
      expect(rejectedCount).toBe(1);
    });
  });

  describe('recordPayment', () => {
    it('updates paidAmount, remainingAmount, status, and ledger links', async () => {
      (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb) => {
        const tx = {
          $queryRaw: jest.fn().mockResolvedValue([{ id: 'inv-1' }]),
          invoicePayment: {
            create: jest.fn().mockResolvedValue({ id: 'pay-2' }),
            aggregate: jest
              .fn()
              .mockResolvedValue({ _sum: { amount: new Decimal(200) } }),
          },
          invoice: {
            findFirst: jest.fn().mockResolvedValue({
              id: 'inv-1',
              companyId: 'company-1',
              accountId: 'acc-1',
              invoiceType: 'SALE',
              invoiceNumber: 'INV-001',
              grandTotal: new Decimal(1000),
              status: 'PARTIALLY_PAID',
            }),
            update: jest.fn().mockResolvedValue({}),
          },
          ledgerEntry: {
            create: jest.fn().mockResolvedValue({}),
          },
        };

        const result = await cb(tx);

        expect(tx.invoice.update).toHaveBeenCalledWith({
          where: { id: 'inv-1' },
          data: expect.objectContaining({
            status: 'PAID',
            paymentMode: 'UPI',
            paymentBookName: 'Main Bank',
            paymentNarration: 'Final settlement',
          }),
        });
        expect(tx.ledgerEntry.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            voucherType: 'RECEIPT',
            voucherNumber: 'pay-2',
          }),
        });

        return result;
      });

      await service.recordPayment('company-1', 'inv-1', {
        paymentDate: '2026-03-13',
        amount: 800,
        paymentMode: 'UPI',
        bookName: 'Main Bank',
        narration: 'Final settlement',
      });
    });

    it('serializes concurrent payment attempts by recomputing totals inside the transaction', async () => {
      let paidSoFar = 0;
      let lock = Promise.resolve();

      (prisma.$transaction as jest.Mock).mockImplementation((cb) => {
        const run = async () => {
          const tx = {
            $queryRaw: jest.fn().mockResolvedValue([{ id: 'inv-1' }]),
            invoice: {
              findFirst: jest.fn().mockResolvedValue({
                id: 'inv-1',
                companyId: 'company-1',
                accountId: 'acc-1',
                invoiceType: 'SALE',
                invoiceNumber: 'INV-001',
                grandTotal: new Decimal(100),
                status: 'PARTIALLY_PAID',
              }),
              update: jest.fn().mockImplementation(({ data }) => {
                paidSoFar = Number(data.paidAmount.toString());
                return {};
              }),
            },
            invoicePayment: {
              aggregate: jest
                .fn()
                .mockImplementation(async () => ({ _sum: { amount: new Decimal(paidSoFar) } })),
              create: jest.fn().mockResolvedValue({ id: `pay-${paidSoFar}` }),
            },
            ledgerEntry: {
              create: jest.fn().mockResolvedValue({}),
            },
          };

          return cb(tx);
        };

        const next = lock.then(run, run);
        lock = next.catch(() => undefined);
        return next;
      });

      const [first, second] = await Promise.allSettled([
        service.recordPayment('company-1', 'inv-1', {
          paymentDate: '2026-03-13',
          amount: 60,
          paymentMode: 'UPI',
        }),
        service.recordPayment('company-1', 'inv-1', {
          paymentDate: '2026-03-13',
          amount: 50,
          paymentMode: 'UPI',
        }),
      ]);

      const fulfilledCount = [first, second].filter(
        (entry) => entry.status === 'fulfilled',
      ).length;
      const rejectedCount = [first, second].filter(
        (entry) => entry.status === 'rejected',
      ).length;

      expect(fulfilledCount).toBe(1);
      expect(rejectedCount).toBe(1);
      expect(paidSoFar).toBe(60);
    });
  });

  describe('findAll', () => {
    it('returns the canonical paginated response shape', async () => {
      (prisma.$transaction as jest.Mock).mockResolvedValueOnce([
        [
          {
            id: 'inv-1',
            grandTotal: new Decimal(100),
          },
        ],
        1,
      ]);

      await expect(
        service.findAll('company-1', { page: 1, limit: 20 } as any),
      ).resolves.toEqual({
        data: [
          {
            id: 'inv-1',
            grandTotal: new Decimal(100),
          },
        ],
        meta: {
          total: 1,
          page: 1,
          limit: 20,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        },
      });
    });
  });

  describe('deletePayment', () => {
    it('recomputes payment totals and removes the matching ledger entry', async () => {
      (prisma.invoice!.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'inv-1',
        companyId: 'company-1',
        grandTotal: 1000,
        status: 'PARTIALLY_PAID',
      });
      (prisma.invoicePayment!.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'pay-2',
        invoiceId: 'inv-1',
      });

      (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb) => {
        const tx = {
          invoicePayment: {
            delete: jest.fn().mockResolvedValue({}),
            aggregate: jest.fn().mockResolvedValue({
              _sum: { amount: 200 },
            }),
            findFirst: jest.fn().mockResolvedValue({
              paymentMode: 'CASH',
              bookName: 'Cash Book',
              narration: 'Initial advance',
            }),
          },
          ledgerEntry: {
            deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          invoice: {
            update: jest.fn().mockResolvedValue({}),
          },
        };

        const result = await cb(tx);

        expect(tx.ledgerEntry.deleteMany).toHaveBeenCalledWith({
          where: {
            invoiceId: 'inv-1',
            voucherNumber: 'pay-2',
            voucherType: { in: ['RECEIPT', 'PAYMENT'] },
          },
        });
        expect(tx.invoice.update).toHaveBeenCalledWith({
          where: { id: 'inv-1' },
          data: expect.objectContaining({
            status: 'PARTIALLY_PAID',
            paymentMode: 'CASH',
            paymentBookName: 'Cash Book',
            paymentNarration: 'Initial advance',
          }),
        });

        return result;
      });

      await service.deletePayment('company-1', 'inv-1', 'pay-2');
    });
  });

  describe('cancel', () => {
    it('rejects cancellation when payments exist', async () => {
      (prisma.invoice!.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'inv-1',
        companyId: 'company-1',
        status: 'PARTIALLY_PAID',
        paidAmount: 100,
      });

      await expect(service.cancel('company-1', 'inv-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });
});
