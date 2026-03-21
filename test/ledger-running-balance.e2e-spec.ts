import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { AccountingController } from '../src/modules/accounting/accounting.controller';
import { AccountingService } from '../src/modules/accounting/accounting.service';

function getRouteParamMetadata(
  target: any,
  methodName: keyof AccountingController,
): Record<string, { data?: unknown }> {
  return (
    Reflect.getMetadata(ROUTE_ARGS_METADATA, target[methodName]) ??
    Reflect.getMetadata(ROUTE_ARGS_METADATA, target.constructor, methodName) ??
    Reflect.getMetadata(ROUTE_ARGS_METADATA, target, methodName) ??
    {}
  );
}

describe('Ledger running-balance smoke (e2e)', () => {
  it('binds ledger filters from the query string', () => {
    const metadata = getRouteParamMetadata(
      AccountingController.prototype,
      'getLedger',
    );

    expect(
      Object.values(metadata).filter((entry) =>
        ['accountId', 'dateFrom', 'dateTo', 'page', 'limit'].includes(
          String(entry?.data),
        ),
      ),
    ).toHaveLength(5);
  });

  it('returns correct running balances for paged seeded ledger entries', async () => {
    const prisma = {
      ledgerEntry: {
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
      },
    } as any;

    const service = new AccountingService(prisma, {
      getNextNumber: jest.fn(),
    } as any);

    const result = await service.getLedger('company-1', { page: 2, limit: 2 });

    expect(result.data).toEqual([
      expect.objectContaining({ id: 'entry-3', runningBalance: 9 }),
      expect.objectContaining({ id: 'entry-4', runningBalance: 7 }),
    ]);
    expect(result.meta).toMatchObject({ page: 2, limit: 2, total: 4 });
  });
});
