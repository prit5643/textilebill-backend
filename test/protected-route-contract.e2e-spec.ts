import { GUARDS_METADATA } from '@nestjs/common/constants';
import {
  CompanyAccessGuard,
  JwtAuthGuard,
  RolesGuard,
  SubscriptionGuard,
} from '../src/common/guards';
import { AuthController } from '../src/modules/auth/auth.controller';
import { CompanyController } from '../src/modules/company/company.controller';
import { UsersController } from '../src/modules/users/users.controller';
import { ReportController } from '../src/modules/report/report.controller';
import { AdminController } from '../src/modules/admin/admin.controller';
import { TenantController } from '../src/modules/tenant/tenant.controller';
import { AccountController } from '../src/modules/account/account.controller';
import { BrokerController } from '../src/modules/account/broker.controller';
import { AccountGroupController } from '../src/modules/account/account-group.controller';
import { ProductController } from '../src/modules/product/product.controller';
import { BrandController } from '../src/modules/product/brand.controller';
import { CategoryController } from '../src/modules/product/category.controller';
import { UomController } from '../src/modules/product/uom.controller';
import { InvoiceController } from '../src/modules/invoice/invoice.controller';
import { InvoiceNumberConfigController } from '../src/modules/invoice/invoice-number-config.controller';
import { AccountingController } from '../src/modules/accounting/accounting.controller';

describe('Protected route contract (e2e)', () => {
  it.each([
    [
      CompanyController,
      [JwtAuthGuard, CompanyAccessGuard, RolesGuard],
    ],
    [
      UsersController,
      [JwtAuthGuard, SubscriptionGuard, CompanyAccessGuard, RolesGuard],
    ],
    [
      AccountController,
      [JwtAuthGuard, SubscriptionGuard, CompanyAccessGuard, RolesGuard],
    ],
    [
      BrokerController,
      [JwtAuthGuard, SubscriptionGuard, CompanyAccessGuard, RolesGuard],
    ],
    [
      ProductController,
      [JwtAuthGuard, SubscriptionGuard, CompanyAccessGuard, RolesGuard],
    ],
    [
      BrandController,
      [JwtAuthGuard, SubscriptionGuard, CompanyAccessGuard, RolesGuard],
    ],
    [
      CategoryController,
      [JwtAuthGuard, SubscriptionGuard, CompanyAccessGuard, RolesGuard],
    ],
    [ReportController, [JwtAuthGuard, SubscriptionGuard, CompanyAccessGuard]],
    [InvoiceController, [JwtAuthGuard, SubscriptionGuard, CompanyAccessGuard]],
    [
      InvoiceNumberConfigController,
      [JwtAuthGuard, SubscriptionGuard, CompanyAccessGuard],
    ],
    [
      AccountingController,
      [JwtAuthGuard, SubscriptionGuard, CompanyAccessGuard],
    ],
    [AdminController, [JwtAuthGuard, SubscriptionGuard, RolesGuard]],
    [TenantController, [JwtAuthGuard, SubscriptionGuard]],
    [AccountGroupController, [JwtAuthGuard, SubscriptionGuard]],
    [
      UomController,
      [JwtAuthGuard, SubscriptionGuard, CompanyAccessGuard, RolesGuard],
    ],
  ])('%p declares the expected protected guard chain', (controller, guards) => {
    expect(Reflect.getMetadata(GUARDS_METADATA, controller) ?? []).toEqual(
      guards,
    );
  });

  it.each(['getMe', 'changePassword', 'getSessions', 'revokeSession'] as const)(
    'AuthController.%s requires JWT auth before subscription enforcement',
    (methodName) => {
      expect(
        Reflect.getMetadata(
          GUARDS_METADATA,
          AuthController.prototype[methodName],
        ) ?? [],
      ).toEqual([JwtAuthGuard, SubscriptionGuard]);
    },
  );
});
