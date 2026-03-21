import { ValidationPipe } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { AccountingController } from '../src/modules/accounting/accounting.controller';
import {
  CreateBankBookEntryDto,
  CreateCashBookEntryDto,
  CreateJournalEntryDto,
  CreateOpeningBalanceDto,
} from '../src/modules/accounting/dto';

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

describe('Accounting voucher contract (e2e)', () => {
  const validationPipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  it('binds cash-book list query filters from the query string', () => {
    const metadata = getRouteParamMetadata(
      AccountingController.prototype,
      'getCashBook',
    );

    expect(
      Object.values(metadata).filter((entry) =>
        ['bookName', 'dateFrom', 'dateTo', 'page', 'limit'].includes(
          String(entry?.data),
        ),
      ),
    ).toHaveLength(5);
  });

  it('binds bank-book list query filters from the query string', () => {
    const metadata = getRouteParamMetadata(
      AccountingController.prototype,
      'getBankBook',
    );

    expect(
      Object.values(metadata).filter((entry) =>
        ['bookName', 'dateFrom', 'dateTo', 'page', 'limit'].includes(
          String(entry?.data),
        ),
      ),
    ).toHaveLength(5);
  });

  it('binds journal list query filters from the query string', () => {
    const metadata = getRouteParamMetadata(
      AccountingController.prototype,
      'getJournalEntries',
    );

    expect(
      Object.values(metadata).filter((entry) =>
        ['dateFrom', 'dateTo', 'page', 'limit'].includes(String(entry?.data)),
      ),
    ).toHaveLength(4);
  });

  it('validates cash-book voucher payload DTO', async () => {
    await expect(
      validationPipe.transform(
        {
          date: '2025-07-14',
          accountId: 'acc-1',
          type: 'INVALID',
          amount: 200,
        },
        {
          type: 'body',
          metatype: CreateCashBookEntryDto,
          data: '',
        },
      ),
    ).rejects.toBeDefined();

    await expect(
      validationPipe.transform(
        {
          date: '2025-07-14',
          accountId: 'acc-1',
          type: 'CR',
          amount: 200,
          narration: 'Receipt',
        },
        {
          type: 'body',
          metatype: CreateCashBookEntryDto,
          data: '',
        },
      ),
    ).resolves.toMatchObject({
      type: 'CR',
      amount: 200,
    });
  });

  it('validates bank-book voucher payload DTO', async () => {
    await expect(
      validationPipe.transform(
        {
          date: '2025-07-14',
          accountId: 'acc-1',
          type: 'DR',
          amount: 400,
          chequeNumber: '12345',
        },
        {
          type: 'body',
          metatype: CreateBankBookEntryDto,
          data: '',
        },
      ),
    ).resolves.toMatchObject({
      type: 'DR',
      amount: 400,
      chequeNumber: '12345',
    });
  });

  it('validates journal voucher payload DTO', async () => {
    await expect(
      validationPipe.transform(
        {
          date: '2025-07-14',
          lines: [{ accountId: 'acc-1', type: 'XX', amount: 100 }],
        },
        {
          type: 'body',
          metatype: CreateJournalEntryDto,
          data: '',
        },
      ),
    ).rejects.toBeDefined();

    await expect(
      validationPipe.transform(
        {
          date: '2025-07-14',
          narration: 'Adjustment',
          lines: [
            { accountId: 'acc-1', type: 'DR', amount: 100 },
            { accountId: 'acc-2', type: 'CR', amount: 100 },
          ],
        },
        {
          type: 'body',
          metatype: CreateJournalEntryDto,
          data: '',
        },
      ),
    ).resolves.toMatchObject({
      narration: 'Adjustment',
      lines: expect.arrayContaining([
        expect.objectContaining({ type: 'DR' }),
        expect.objectContaining({ type: 'CR' }),
      ]),
    });
  });

  it('validates opening-balance voucher payload DTO', async () => {
    await expect(
      validationPipe.transform(
        {
          accountId: 'acc-1',
          type: 'DR',
          amount: 999,
          date: '2025-04-01',
        },
        {
          type: 'body',
          metatype: CreateOpeningBalanceDto,
          data: '',
        },
      ),
    ).resolves.toMatchObject({
      type: 'DR',
      amount: 999,
    });
  });
});
