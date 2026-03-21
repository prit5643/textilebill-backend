import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { AccountController } from '../src/modules/account/account.controller';
import { CompanyController } from '../src/modules/company/company.controller';
import { ProductController } from '../src/modules/product/product.controller';

function getRouteParamMetadata(
  target: any,
  methodName: string,
): Record<string, { data?: unknown }> {
  return (
    Reflect.getMetadata(ROUTE_ARGS_METADATA, target[methodName]) ??
    Reflect.getMetadata(ROUTE_ARGS_METADATA, target.constructor, methodName) ??
    Reflect.getMetadata(ROUTE_ARGS_METADATA, target, methodName) ??
    {}
  );
}

describe('Payload reduction smoke (e2e)', () => {
  it('binds account list view from query string', () => {
    const metadata = getRouteParamMetadata(
      AccountController.prototype,
      'findAll',
    );

    expect(
      Object.values(metadata).some((entry) => entry?.data === 'view'),
    ).toBe(true);
  });

  it('binds product list view from query string', () => {
    const metadata = getRouteParamMetadata(
      ProductController.prototype,
      'findAll',
    );

    expect(
      Object.values(metadata).some((entry) => entry?.data === 'view'),
    ).toBe(true);
  });

  it('binds company list view from query string', () => {
    const metadata = getRouteParamMetadata(
      CompanyController.prototype,
      'findAll',
    );

    expect(
      Object.values(metadata).some((entry) => entry?.data === 'view'),
    ).toBe(true);
  });
});
