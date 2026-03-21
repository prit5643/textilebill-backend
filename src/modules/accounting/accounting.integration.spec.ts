import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AccountingService } from './accounting.service';
import { VoucherNumberService } from './voucher-number.service';
import { PrismaService } from '../prisma/prisma.service';

describe('Accounting voucher integration', () => {
  let service: AccountingService;
  let prisma: jest.Mocked<Partial<PrismaService>>;

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountingService,
        VoucherNumberService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<AccountingService>(AccountingService);
  });

  it('creates cash-book entry with FY-reset voucher number and mirrored ledger rows', async () => {
    let seq = 0;
    const tx = {
      financialYear: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'fy-1',
          startDate: new Date('2025-04-01T00:00:00.000Z'),
          endDate: new Date('2026-03-31T00:00:00.000Z'),
        }),
      },
      voucherSequence: {
        upsert: jest.fn().mockImplementation(async () => {
          seq += 1;
          return { currentNumber: seq };
        }),
      },
      cashBookEntry: {
        create: jest.fn().mockImplementation(({ data }) => ({
          id: 'cb-1',
          voucherNumber: data.voucherNumber,
        })),
      },
      account: {
        findFirst: jest.fn().mockResolvedValue({ id: 'cash-account-1' }),
      },
      accountGroup: {
        findFirst: jest.fn(),
      },
      ledgerEntry: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    } as any;

    (prisma.$transaction as jest.Mock).mockImplementation(async (cb) => cb(tx));

    const result = await service.createCashBookEntry('company-1', {
      date: '2025-07-14',
      accountId: 'party-account-1',
      type: 'CR',
      amount: 250,
      narration: 'Receipt',
    });

    expect(result.voucherNumber).toBe('CB-2025-26-0001');
    expect(tx.ledgerEntry.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            voucherType: 'CASH_RECEIPT',
            voucherNumber: 'CB-2025-26-0001',
            debit: 250,
          }),
          expect.objectContaining({
            voucherType: 'CASH_RECEIPT',
            voucherNumber: 'CB-2025-26-0001',
            credit: 250,
          }),
        ]),
      }),
    );
  });

  it('allocates unique sequential voucher numbers under concurrent bank-book writes', async () => {
    let seq = 0;
    const tx = {
      financialYear: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'fy-1',
          startDate: new Date('2025-04-01T00:00:00.000Z'),
          endDate: new Date('2026-03-31T00:00:00.000Z'),
        }),
      },
      voucherSequence: {
        upsert: jest.fn().mockImplementation(async () => {
          seq += 1;
          return { currentNumber: seq };
        }),
      },
      bankBookEntry: {
        create: jest.fn().mockImplementation(({ data }) => ({
          id: `bb-${data.voucherNumber}`,
          voucherNumber: data.voucherNumber,
        })),
      },
      account: {
        findFirst: jest.fn().mockResolvedValue({ id: 'bank-account-1' }),
      },
      accountGroup: {
        findFirst: jest.fn(),
      },
      ledgerEntry: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    } as any;

    (prisma.$transaction as jest.Mock).mockImplementation(async (cb) => cb(tx));

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        service.createBankBookEntry('company-1', {
          date: '2025-07-14',
          accountId: 'party-account-1',
          type: 'CR',
          amount: 100,
          narration: 'Deposit',
        }),
      ),
    );

    const voucherNumbers = results.map((entry) => entry.voucherNumber);
    expect(new Set(voucherNumbers).size).toBe(10);
    expect(voucherNumbers).toContain('BB-2025-26-0001');
    expect(voucherNumbers).toContain('BB-2025-26-0010');
  });

  it('computes paginated ledger running balance using opening totals', async () => {
    (prisma as any).ledgerEntry = {
      findMany: jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: 'entry-3',
            date: new Date('2025-04-03T00:00:00.000Z'),
          },
        ])
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
        ]),
      aggregate: jest.fn().mockResolvedValue({
        _sum: { debit: 10, credit: 5 },
      }),
      count: jest.fn().mockResolvedValue(4),
    };

    const result = await service.getLedger('company-1', {
      accountId: 'acc-1',
      page: 2,
      limit: 2,
    });

    expect(result.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'entry-3', runningBalance: 9 }),
        expect.objectContaining({ id: 'entry-4', runningBalance: 7 }),
      ]),
    );
  });

  it('rejects unsafe cash-book deletion when voucher number is missing', async () => {
    (prisma as any).cashBookEntry = {
      findFirst: jest.fn().mockResolvedValue({
        id: 'cash-1',
        companyId: 'company-1',
        voucherNumber: null,
      }),
    };

    await expect(
      service.deleteCashBookEntry('company-1', 'cash-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
