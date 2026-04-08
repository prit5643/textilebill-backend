import { GUARDS_METADATA } from '@nestjs/common/constants';
import { COMPANY_ACCESS_KEY } from '../src/common/decorators';
import { CompanyAccessGuard } from '../src/common/guards';
import { CompanyController } from '../src/modules/company/company.controller';
import { UsersController } from '../src/modules/users/users.controller';
import { ProductController } from '../src/modules/product/product.controller';
import { ClassificationController } from '../src/modules/product/classification.controller';
import { CardTypeController } from '../src/modules/product/card-type.controller';
import { BrandController } from '../src/modules/product/brand.controller';
import { CategoryController } from '../src/modules/product/category.controller';
import { ServiceCategoryController } from '../src/modules/product/service-category.controller';
import { UomController } from '../src/modules/product/uom.controller';
import { AccountController } from '../src/modules/account/account.controller';
import { BrokerController } from '../src/modules/account/broker.controller';
import { AccountingController } from '../src/modules/accounting/accounting.controller';
import { InvoiceController } from '../src/modules/invoice/invoice.controller';
import { InvoiceNumberConfigController } from '../src/modules/invoice/invoice-number-config.controller';
import { ReportController } from '../src/modules/report/report.controller';

const headerScopedControllers = [
  ProductController,
  ClassificationController,
  CardTypeController,
  BrandController,
  CategoryController,
  ServiceCategoryController,
  UomController,
  AccountController,
  BrokerController,
  AccountingController,
  InvoiceController,
  InvoiceNumberConfigController,
  ReportController,
];

describe('Company access route contract (e2e)', () => {
  it.each(headerScopedControllers)(
    '%p uses the company-access guard and header metadata',
    (controller) => {
      const guards = Reflect.getMetadata(GUARDS_METADATA, controller) ?? [];
      const metadata = Reflect.getMetadata(COMPANY_ACCESS_KEY, controller);

      expect(guards).toContain(CompanyAccessGuard);
      expect(metadata).toEqual({
        source: 'header',
        key: 'x-company-id',
      });
    },
  );

  it('attaches param-based company access metadata to company routes', () => {
    const guardedMethods: Array<keyof CompanyController> = [
      'findOne',
      'update',
      'remove',
      'getSettings',
      'updateSettings',
      'getFinancialYears',
      'createFinancialYear',
      'setActiveFinancialYear',
    ];

    const guards =
      Reflect.getMetadata(GUARDS_METADATA, CompanyController) ?? [];

    expect(guards).toContain(CompanyAccessGuard);

    for (const method of guardedMethods) {
      expect(
        Reflect.getMetadata(
          COMPANY_ACCESS_KEY,
          CompanyController.prototype[method],
        ),
      ).toEqual({
        source: 'param',
        key: 'id',
      });
    }
  });

  it('attaches body/param company access metadata to company assignment routes', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, UsersController) ?? [];

    expect(guards).toContain(CompanyAccessGuard);
    expect(
      Reflect.getMetadata(
        COMPANY_ACCESS_KEY,
        UsersController.prototype.addCompanyAccess,
      ),
    ).toEqual({
      source: 'body',
      key: 'companyId',
    });
    expect(
      Reflect.getMetadata(
        COMPANY_ACCESS_KEY,
        UsersController.prototype.removeCompanyAccess,
      ),
    ).toEqual({
      source: 'param',
      key: 'companyId',
    });
  });
});
