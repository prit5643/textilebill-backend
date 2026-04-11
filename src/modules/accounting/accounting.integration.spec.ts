import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AccountingService } from './accounting.service';
import { VoucherNumberService } from './voucher-number.service';
import { PrismaService } from '../prisma/prisma.service';

describe('Accounting voucher integration', () => {
  let service: AccountingService;
  let prisma: jest.Mocked<Partial<PrismaService>>;

  beforeEach(async () => {
    prisma = {
      company: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'company-1',
          tenantId: 'tenant-1',
        }),
      } as any,
      $transaction: jest.fn(),
      ledgerEntry: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        aggregate: jest.fn(),
        count: jest.fn(),
      } as any,
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

  it('creates cash-book entries with sequential voucher numbers', async () => {
    let sequence = 0;
    const tx = {
      company: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'company-1',
          tenantId: 'tenant-1',
        }),
      },
      financialYear: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'fy-1',
        }),
      },
      voucherSequence: {
        upsert: jest.fn().mockImplementation(async () => {
          sequence += 1;
          return { prefix: 'CB-', currentValue: sequence };
        }),
      },
      ledgerEntry: {
        create: jest.fn().mockImplementation(({ data }) => ({
          id: `ledger-${data.debit || data.credit}`,
          narration: data.narration,
        })),
      },
    } as any;

    (prisma.$transaction as jest.Mock).mockImplementation(async (cb) => cb(tx));

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        service.createCashBookEntry('company-1', {
          date: '2025-07-14',
          accountId: 'party-account-1',
          type: 'CR',
          amount: 100,
          narration: 'Receipt',
        }),
      ),
    );

    const voucherNumbers = results.map((entry) => entry.voucherNumber);
    expect(new Set(voucherNumbers).size).toBe(5);
    expect(voucherNumbers).toContain('CB-0001');
    expect(voucherNumbers).toContain('CB-0005');
  });

  it('computes paginated running balances', async () => {
    (prisma.ledgerEntry!.findMany as jest.Mock)
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
    (prisma.ledgerEntry!.aggregate as jest.Mock).mockResolvedValue({
      _sum: { debit: 10, credit: 5 },
    });
    (prisma.ledgerEntry!.count as jest.Mock).mockResolvedValue(4);

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

  it('rejects deleting missing cash-book entry', async () => {
    (prisma.ledgerEntry!.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(
      service.deleteCashBookEntry('company-1', 'missing-id'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
