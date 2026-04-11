import { ReportController } from './report.controller';
import { ReportService } from './report.service';
import { WorkOrderService } from '../work-order/work-order.service';

describe('ReportController', () => {
  let controller: ReportController;
  let reportService: jest.Mocked<
    Pick<
      ReportService,
      | 'getDashboardKpis'
      | 'getMonthlySalesChart'
      | 'getOutstandingDebtors'
      | 'getOutstandingCreditors'
      | 'getStockReport'
      | 'getGstSlabWise'
      | 'getProductDetailsByCustomer'
    >
  >;
  let workOrderService: jest.Mocked<
    Pick<
      WorkOrderService,
      'getMonthlyProfitSummary' | 'getVendorMarginRisk' | 'getProfitability'
    >
  >;

  beforeEach(() => {
    reportService = {
      getDashboardKpis: jest.fn(),
      getMonthlySalesChart: jest.fn(),
      getOutstandingDebtors: jest.fn(),
      getOutstandingCreditors: jest.fn(),
      getStockReport: jest.fn(),
      getGstSlabWise: jest.fn(),
      getProductDetailsByCustomer: jest.fn(),
    };
    workOrderService = {
      getMonthlyProfitSummary: jest.fn(),
      getVendorMarginRisk: jest.fn(),
      getProfitability: jest.fn(),
    };

    controller = new ReportController(
      reportService as unknown as ReportService,
      workOrderService as unknown as WorkOrderService,
    );
  });

  it('forwards dashboard KPI requests to the service with company scope', async () => {
    await controller.getDashboardKpis('company-1');

    expect(reportService.getDashboardKpis).toHaveBeenCalledWith('company-1');
  });

  it('forwards monthly-chart year filters to the service', async () => {
    await controller.getMonthlySalesChart('company-1', 2026);

    expect(reportService.getMonthlySalesChart).toHaveBeenCalledWith(
      'company-1',
      2026,
    );
  });

  it('forwards debtor date filters to the service', async () => {
    await controller.getOutstandingDebtors(
      'company-1',
      '2026-01-01',
      '2026-01-31',
    );

    expect(reportService.getOutstandingDebtors).toHaveBeenCalledWith(
      'company-1',
      {
        dateFrom: '2026-01-01',
        dateTo: '2026-01-31',
      },
    );
  });

  it('forwards creditor date filters to the service', async () => {
    await controller.getOutstandingCreditors(
      'company-1',
      '2026-02-01',
      '2026-02-28',
    );

    expect(reportService.getOutstandingCreditors).toHaveBeenCalledWith(
      'company-1',
      {
        dateFrom: '2026-02-01',
        dateTo: '2026-02-28',
      },
    );
  });

  it('forwards stock filters to the service', async () => {
    await controller.getStockReport(
      'company-1',
      'product-1',
      '2026-01-01',
      '2026-01-31',
    );

    expect(reportService.getStockReport).toHaveBeenCalledWith('company-1', {
      productId: 'product-1',
      dateFrom: '2026-01-01',
      dateTo: '2026-01-31',
    });
  });

  it('forwards profit-report date filters to the service', async () => {
    (reportService as any).getProfitByProductFifo = jest.fn();

    await controller.getProfitByProductFifo(
      'company-1',
      '2026-03-01',
      '2026-03-31',
    );

    expect((reportService as any).getProfitByProductFifo).toHaveBeenCalledWith(
      'company-1',
      {
        dateFrom: '2026-03-01',
        dateTo: '2026-03-31',
      },
    );
  });

  it('forwards GST slab report date filters to the service', async () => {
    await controller.getGstSlabWise('company-1', '2026-04-01', '2026-04-30');

    expect(reportService.getGstSlabWise).toHaveBeenCalledWith('company-1', {
      dateFrom: '2026-04-01',
      dateTo: '2026-04-30',
    });
  });

  it('forwards product-details-by-customer filters to the service', async () => {
    await controller.getProductDetailsByCustomer(
      'company-1',
      'product-1',
      '2026-08-01',
      '2026-08-31',
    );

    expect(reportService.getProductDetailsByCustomer).toHaveBeenCalledWith(
      'company-1',
      {
        productId: 'product-1',
        dateFrom: '2026-08-01',
        dateTo: '2026-08-31',
      },
    );
  });
});
