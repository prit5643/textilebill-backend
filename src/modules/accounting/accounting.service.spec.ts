import { AccountingService } from './accounting.service';
import { PrismaService } from '../prisma/prisma.service';
import { VoucherNumberService } from './voucher-number.service';

describe('AccountingService', () => {
  let service: AccountingService;
  let prisma: jest.Mocked<Partial<PrismaService>>;
  let voucherNumberService: jest.Mocked<Partial<VoucherNumberService>>;

  beforeEach(() => {
    prisma = {
      company: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'company-1',
          tenantId: 'tenant-1',
        }),
      } as any,
      stockMovement: {
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
      } as any,
      ledgerEntry: {
        findMany: jest.fn(),
        aggregate: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findFirst: jest.fn(),
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

  it('returns paginated opening stock rows from stock movements', async () => {
    (prisma.stockMovement!.findMany as jest.Mock).mockResolvedValueOnce([
      {
        id: 'sm-1',
        quantity: 10,
        product: { id: 'product-1', name: 'Cotton Roll', hsnCode: '5208' },
      },
    ]);
    (prisma.stockMovement!.count as jest.Mock).mockResolvedValueOnce(1);

    await expect(
      service.getOpeningStock('company-1', { page: 1, limit: 25 }),
    ).resolves.toEqual({
      data: [
        {
          id: 'sm-1',
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

  it('computes running ledger balance with opening totals for paginated pages', async () => {
    (prisma.ledgerEntry!.findMany as jest.Mock)
      .mockResolvedValueOnce([
        { id: 'entry-3', date: new Date('2025-04-03T00:00:00.000Z') },
      ])
      .mockResolvedValueOnce([
        {
          id: 'entry-3',
          debit: 4,
          credit: 0,
          account: {
            id: 'acc-1',
            group: 'SUNDRY_DEBTORS',
            party: { name: 'Party' },
          },
          invoice: null,
        },
        {
          id: 'entry-4',
          debit: 0,
          credit: 2,
          account: {
            id: 'acc-1',
            group: 'SUNDRY_DEBTORS',
            party: { name: 'Party' },
          },
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
  });

  it('creates opening stock as IN stock movement', async () => {
    (prisma.stockMovement!.create as jest.Mock).mockResolvedValueOnce({
      id: 'sm-1',
    });

    await expect(
      service.createOpeningStock('company-1', {
        productId: 'product-1',
        quantity: 10,
        rate: 50,
        date: '2025-04-01',
      }),
    ).resolves.toEqual({ id: 'sm-1' });

    expect(prisma.stockMovement!.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        companyId: 'company-1',
        productId: 'product-1',
        type: 'IN',
      }),
    });
  });

  it('creates opening balance entry with allocated voucher number', async () => {
    const voucherNumber = 'OB-0001';
    (voucherNumberService.getNextNumber as jest.Mock).mockResolvedValueOnce(
      voucherNumber,
    );

    (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb) => {
      const tx = {
        ledgerEntry: {
          create: jest.fn().mockResolvedValue({
            id: 'ledger-1',
            narration: '[OPENING_BALANCE][VNO:OB-0001] Opening Balance',
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
      return result;
    });

    await expect(
      service.createOpeningBalance('company-1', {
        accountId: 'acc-1',
        type: 'DR',
        amount: 1500,
        date: '2025-05-12',
      }),
    ).resolves.toMatchObject({
      id: 'ledger-1',
      voucherNumber: 'OB-0001',
    });
  });

  it('appends [RECONCILED:date] to bank book entry narration', async () => {
    (prisma.ledgerEntry!.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'entry-1',
      narration: '[BANK_BOOK] Check Deposit',
    });
    (prisma.ledgerEntry!.update as jest.Mock).mockResolvedValueOnce({
      id: 'entry-1',
    });

    await service.reconcileBankEntry('company-1', 'entry-1');

    expect(prisma.ledgerEntry!.update).toHaveBeenCalledWith({
      where: { id: 'entry-1' },
      data: {
        narration: expect.stringMatching(
          /\[RECONCILED:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/,
        ),
      },
    });
  });
});
