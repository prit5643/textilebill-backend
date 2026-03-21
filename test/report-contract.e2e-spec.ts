import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { ReportController } from '../src/modules/report/report.controller';

function getRouteParamMetadata(
  target: any,
  methodName: keyof ReportController,
): Record<string, { data?: unknown }> {
  return (
    Reflect.getMetadata(ROUTE_ARGS_METADATA, target[methodName]) ??
    Reflect.getMetadata(ROUTE_ARGS_METADATA, target.constructor, methodName) ??
    Reflect.getMetadata(ROUTE_ARGS_METADATA, target, methodName) ??
    {}
  );
}

describe('Report route contract (e2e)', () => {
  it('binds the monthly-chart year filter from the query string', () => {
    const metadata = getRouteParamMetadata(
      ReportController.prototype,
      'getMonthlySalesChart',
    );

    expect(
      Object.values(metadata).filter((entry) => String(entry?.data) === 'year'),
    ).toHaveLength(1);
  });

  it('binds outstanding report date filters from the query string', () => {
    const debtorsMetadata = getRouteParamMetadata(
      ReportController.prototype,
      'getOutstandingDebtors',
    );
    const creditorsMetadata = getRouteParamMetadata(
      ReportController.prototype,
      'getOutstandingCreditors',
    );

    expect(
      Object.values(debtorsMetadata).filter((entry) =>
        ['dateFrom', 'dateTo'].includes(String(entry?.data)),
      ),
    ).toHaveLength(2);
    expect(
      Object.values(creditorsMetadata).filter((entry) =>
        ['dateFrom', 'dateTo'].includes(String(entry?.data)),
      ),
    ).toHaveLength(2);
  });

  it('binds stock-report filters from the query string', () => {
    const metadata = getRouteParamMetadata(
      ReportController.prototype,
      'getStockReport',
    );

    expect(
      Object.values(metadata).filter((entry) =>
        ['productId', 'dateFrom', 'dateTo'].includes(String(entry?.data)),
      ),
    ).toHaveLength(3);
  });

  it('binds profit-report date filters from the query string', () => {
    const metadata = getRouteParamMetadata(
      ReportController.prototype,
      'getProfitByProductFifo',
    );

    expect(
      Object.values(metadata).filter((entry) =>
        ['dateFrom', 'dateTo'].includes(String(entry?.data)),
      ),
    ).toHaveLength(2);
  });

  it('binds GST slab report date filters from the query string', () => {
    const metadata = getRouteParamMetadata(
      ReportController.prototype,
      'getGstSlabWise',
    );

    expect(
      Object.values(metadata).filter((entry) =>
        ['dateFrom', 'dateTo'].includes(String(entry?.data)),
      ),
    ).toHaveLength(2);
  });

  it('binds product-details-by-customer filters from the query string', () => {
    const metadata = getRouteParamMetadata(
      ReportController.prototype,
      'getProductDetailsByCustomer',
    );

    expect(
      Object.values(metadata).filter((entry) =>
        ['productId', 'dateFrom', 'dateTo'].includes(String(entry?.data)),
      ),
    ).toHaveLength(3);
  });
});
