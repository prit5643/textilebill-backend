import { AccountingService } from './accounting.service';
import { PrismaService } from '../prisma/prisma.service';
import { VoucherNumberService } from './voucher-number.service';

describe('AccountingService', () => {
  let service: AccountingService;
  let prisma: jest.Mocked<Partial<PrismaService>>;
  let voucherNumberService: jest.Mocked<Partial<VoucherNumberService>>;

  beforeEach(() => {
    prisma = {
      openingStock: {
        findMany: jest.fn(),
        count: jest.fn(),
      } as any,
      ledgerEntry: {
        findMany: jest.fn(),
        aggregate: jest.fn(),
        count: jest.fn(),
      } as any,
      $transaction: jest.fn(),
    };

    voucherNumberService = {
      getNextNumber: jest.fn(),
    };

    service = new AccountingService(
      prisma as PrismaService,
      voucherNumberService as VoucherNumberService,
    );
  });

  describe('getOpeningStock', () => {
    it('returns the canonical paginated response shape', async () => {
      (prisma.openingStock!.findMany as jest.Mock).mockResolvedValueOnce([
        {
          id: 'os-1',
          quantity: 10,
          product: { id: 'product-1', name: 'Cotton Roll', hsnCode: '5208' },
        },
      ]);
      (prisma.openingStock!.count as jest.Mock).mockResolvedValueOnce(1);

      await expect(
        service.getOpeningStock('company-1', { page: 1, limit: 25 }),
      ).resolves.toEqual({
        data: [
          {
            id: 'os-1',
            quantity: 10,
            product: {
              id: 'product-1',
              name: 'Cotton Roll',
              hsnCode: '5208',
            },
          },
        ],
        meta: {
          total: 1,
          page: 1,
          limit: 25,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        },
      });
    });
  });

  describe('getLedger', () => {
    it('carries forward opening balance when page > 1', async () => {
      (prisma.ledgerEntry!.findMany as jest.Mock)
        // Boundary entry (skip/take=1 lookup)
        .mockResolvedValueOnce([
          {
            id: 'entry-3',
            date: new Date('2025-04-03T00:00:00.000Z'),
          },
        ])
        // Paged entries
        .mockResolvedValueOnce([
          {
            id: 'entry-3',
            debit: 4,
            credit: 0,
            account: { id: 'acc-1', name: 'Party' },
            invoice: null,
          },
          {
            id: 'entry-4',
            debit: 0,
            credit: 2,
            account: { id: 'acc-1', name: 'Party' },
            invoice: null,
          },
        ]);
      (prisma.ledgerEntry!.aggregate as jest.Mock).mockResolvedValueOnce({
        _sum: { debit: 10, credit: 5 },
      });
      (prisma.ledgerEntry!.count as jest.Mock).mockResolvedValueOnce(4);

      await expect(
        service.getLedger('company-1', { page: 2, limit: 2 }),
      ).resolves.toMatchObject({
        data: [
          expect.objectContaining({ id: 'entry-3', runningBalance: 9 }),
          expect.objectContaining({ id: 'entry-4', runningBalance: 7 }),
        ],
        meta: expect.objectContaining({
          total: 4,
          page: 2,
          limit: 2,
        }),
      });

      expect(prisma.ledgerEntry!.findMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          orderBy: [{ date: 'asc' }, { id: 'asc' }],
          skip: 2,
          take: 2,
        }),
      );
    });
  });

  describe('createOpeningStock', () => {
    it('creates opening stock and stock movement atomically', async () => {
      (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb) => {
        const tx = {
          openingStock: {
            create: jest.fn().mockResolvedValue({ id: 'os-1' }),
          },
          stockMovement: {
            create: jest.fn().mockResolvedValue({ id: 'sm-1' }),
          },
        };

        const result = await cb(tx);
        expect(tx.openingStock.create).toHaveBeenCalled();
        expect(tx.stockMovement.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            companyId: 'company-1',
            productId: 'product-1',
            type: 'OPENING',
          }),
        });

        return result;
      });

      await expect(
        service.createOpeningStock('company-1', {
          productId: 'product-1',
          quantity: 10,
          rate: 50,
          date: '2025-04-01',
        }),
      ).resolves.toEqual({ id: 'os-1' });
    });
  });

  describe('createOpeningBalance', () => {
    it('allocates voucher number inside transaction using financial-year sequence', async () => {
      const voucherNumber = 'OB-2025-26-0001';
      (voucherNumberService.getNextNumber as jest.Mock).mockResolvedValueOnce(
        voucherNumber,
      );

      (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb) => {
        const tx = {
          ledgerEntry: {
            create: jest.fn().mockResolvedValue({
              id: 'ledger-1',
              voucherNumber,
            }),
          },
        };

        const result = await cb(tx);

        expect(voucherNumberService.getNextNumber).toHaveBeenCalledWith(
          tx,
          expect.objectContaining({
            companyId: 'company-1',
            series: 'OB',
          }),
        );

        expect(tx.ledgerEntry.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            companyId: 'company-1',
            accountId: 'acc-1',
            voucherType: 'OPENING_BALANCE',
            voucherNumber,
          }),
        });

        return result;
      });

      await expect(
        service.createOpeningBalance('company-1', {
          accountId: 'acc-1',
          type: 'DR',
          amount: 1500,
          date: '2025-05-12',
        }),
      ).resolves.toEqual({ id: 'ledger-1', voucherNumber });
    });
  });
});
