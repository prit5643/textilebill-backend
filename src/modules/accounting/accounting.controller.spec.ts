import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';

describe('AccountingController', () => {
  let controller: AccountingController;
  let accountingService: jest.Mocked<
    Pick<
      AccountingService,
      'createCashBookEntry' | 'createOpeningBalance' | 'getCashBook'
    >
  >;

  beforeEach(() => {
    accountingService = {
      createCashBookEntry: jest.fn(),
      createOpeningBalance: jest.fn(),
      getCashBook: jest.fn(),
    };

    controller = new AccountingController(
      accountingService as unknown as AccountingService,
    );
  });

  it('forwards cash-book creation payload to the service with company scope', async () => {
    await controller.createCashBookEntry('company-1', {
      date: '2025-07-14',
      accountId: 'account-1',
      type: 'CR',
      amount: 250,
      narration: 'Receipt',
    });

    expect(accountingService.createCashBookEntry).toHaveBeenCalledWith(
      'company-1',
      expect.objectContaining({
        type: 'CR',
        amount: 250,
      }),
    );
  });

  it('forwards opening-balance creation payload to the service with company scope', async () => {
    await controller.createOpeningBalance('company-1', {
      accountId: 'account-1',
      type: 'DR',
      amount: 1000,
      date: '2025-04-01',
    });

    expect(accountingService.createOpeningBalance).toHaveBeenCalledWith(
      'company-1',
      {
        accountId: 'account-1',
        type: 'DR',
        amount: 1000,
        date: '2025-04-01',
      },
    );
  });

  it('forwards cash-book query filters unchanged', async () => {
    await controller.getCashBook(
      'company-1',
      'Main Cash',
      '2025-04-01',
      '2025-04-30',
      2,
      50,
    );

    expect(accountingService.getCashBook).toHaveBeenCalledWith('company-1', {
      bookName: 'Main Cash',
      dateFrom: '2025-04-01',
      dateTo: '2025-04-30',
      page: 2,
      limit: 50,
    });
  });
});
