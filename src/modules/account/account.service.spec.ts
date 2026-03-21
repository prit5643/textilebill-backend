import { Test, TestingModule } from '@nestjs/testing';
import { AccountService } from './account.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AccountService', () => {
  let service: AccountService;
  let prisma: jest.Mocked<Partial<PrismaService>>;

  beforeEach(async () => {
    prisma = {
      account: {
        findMany: jest.fn(),
        count: jest.fn(),
      } as any,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [AccountService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<AccountService>(AccountService);
  });

  it('uses selector projection for dropdown payloads', async () => {
    (prisma.account!.findMany as jest.Mock).mockResolvedValueOnce([]);
    (prisma.account!.count as jest.Mock).mockResolvedValueOnce(0);

    await service.findAllAccounts('company-1', {
      page: 1,
      limit: 25,
      view: 'selector',
    });

    const queryArg = (prisma.account!.findMany as jest.Mock).mock.calls[0][0];
    expect(queryArg.select).toEqual(
      expect.objectContaining({
        id: true,
        name: true,
        city: true,
        isActive: true,
      }),
    );
    expect(queryArg.select.group).toBeUndefined();
  });

  it('uses trimmed default projection for account list pages', async () => {
    (prisma.account!.findMany as jest.Mock).mockResolvedValueOnce([]);
    (prisma.account!.count as jest.Mock).mockResolvedValueOnce(0);

    await service.findAllAccounts('company-1', {
      page: 1,
      limit: 25,
    });

    const queryArg = (prisma.account!.findMany as jest.Mock).mock.calls[0][0];
    expect(queryArg.select).toEqual(
      expect.objectContaining({
        id: true,
        companyId: true,
        name: true,
        gstin: true,
        city: true,
        phone: true,
        openingBalance: true,
        openingBalanceType: true,
        isActive: true,
        group: { select: { id: true, name: true } },
      }),
    );
    expect(queryArg.include).toBeUndefined();
  });
});
