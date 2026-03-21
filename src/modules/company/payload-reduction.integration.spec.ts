import { AccountController } from '../account/account.controller';
import { AccountService } from '../account/account.service';
import { CompanyController } from './company.controller';
import { CompanyService } from './company.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProductController } from '../product/product.controller';
import { ProductService } from '../product/product.service';
import { ConfigService } from '@nestjs/config';

describe('Payload reduction integration', () => {
  let prisma: jest.Mocked<Partial<PrismaService>>;
  let accountController: AccountController;
  let productController: ProductController;
  let companyController: CompanyController;

  beforeEach(() => {
    prisma = {
      account: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      } as any,
      product: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      } as any,
      company: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      } as any,
    };

    accountController = new AccountController(
      new AccountService(prisma as PrismaService),
    );
    productController = new ProductController(
      new ProductService(prisma as PrismaService),
    );
    companyController = new CompanyController(
      new CompanyService(prisma as PrismaService, {
        get: jest.fn((key: string) =>
          key === 'app.secretKey' ? 'test-app-secret' : undefined,
        ),
      } as unknown as ConfigService),
    );
  });

  it('wires account selector view to a lightweight response projection', async () => {
    await accountController.findAll(
      { companyId: 'company-1' } as any,
      1,
      25,
      undefined,
      undefined,
      'selector',
    );

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

  it('wires product selector view to a lightweight response projection', async () => {
    await productController.findAll(
      { companyId: 'company-1' } as any,
      1,
      25,
      undefined,
      undefined,
      undefined,
      undefined,
      'selector',
    );

    const queryArg = (prisma.product!.findMany as jest.Mock).mock.calls[0][0];
    expect(queryArg.select).toEqual(
      expect.objectContaining({
        id: true,
        name: true,
        hsnCode: true,
        retailPrice: true,
        gstRate: true,
        isActive: true,
      }),
    );
    expect(queryArg.select.category).toBeUndefined();
    expect(queryArg.select.brand).toBeUndefined();
  });

  it('wires company header view to a lightweight response projection', async () => {
    await companyController.findAll(
      'tenant-1',
      'user-1',
      'STAFF',
      1,
      25,
      'header',
    );

    const queryArg = (prisma.company!.findMany as jest.Mock).mock.calls[0][0];
    expect(queryArg.select).toEqual(
      expect.objectContaining({
        id: true,
        name: true,
        gstin: true,
        city: true,
        state: true,
        isActive: true,
      }),
    );
    expect(queryArg.select.tenantId).toBeUndefined();
  });
});
