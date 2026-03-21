import { InvoiceController } from './invoice.controller';
import { InvoiceService } from './invoice.service';
import { PdfService } from './pdf.service';

describe('InvoiceController', () => {
  let controller: InvoiceController;
  let invoiceService: jest.Mocked<Pick<InvoiceService, 'recordPayment'>>;

  beforeEach(() => {
    invoiceService = {
      recordPayment: jest.fn(),
    };

    controller = new InvoiceController(
      invoiceService as unknown as InvoiceService,
      {} as PdfService,
    );
  });

  it('forwards validated payment payloads to the service', async () => {
    await controller.recordPayment('company-1', 'invoice-1', {
      paymentDate: '2026-03-13',
      amount: 250,
      paymentMode: 'UPI',
      narration: 'Advance payment',
    });

    expect(invoiceService.recordPayment).toHaveBeenCalledWith(
      'company-1',
      'invoice-1',
      {
        paymentDate: '2026-03-13',
        amount: 250,
        paymentMode: 'UPI',
        narration: 'Advance payment',
      },
    );
  });
});
