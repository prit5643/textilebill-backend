import { ValidationPipe } from '@nestjs/common';
import { CreateInvoiceDto } from '../src/modules/invoice/dto';
import { RecordPaymentDto } from '../src/modules/invoice/dto';

describe('Invoice payment contract (e2e)', () => {
  const validationPipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  it('accepts derived payment statuses on invoice DTOs', async () => {
    await expect(
      validationPipe.transform(
        {
          invoiceType: 'SALE',
          invoiceDate: '2026-03-12',
          accountId: '8ec1a3ef-c336-4ab6-ae87-f316e9ada9e1',
          status: 'PARTIALLY_PAID',
          items: [],
        },
        {
          type: 'body',
          metatype: CreateInvoiceDto,
          data: '',
        },
      ),
    ).resolves.toMatchObject({
      status: 'PARTIALLY_PAID',
    });
  });

  it('validates payment payloads', async () => {
    await expect(
      validationPipe.transform(
        {
          amount: 100,
          paymentMode: 'CASH',
        },
        {
          type: 'body',
          metatype: RecordPaymentDto,
          data: '',
        },
      ),
    ).rejects.toBeDefined();

    await expect(
      validationPipe.transform(
        {
          paymentDate: '2026-03-13',
          amount: 100,
          paymentMode: 'CASH',
          narration: 'Advance payment',
        },
        {
          type: 'body',
          metatype: RecordPaymentDto,
          data: '',
        },
      ),
    ).resolves.toMatchObject({
      paymentMode: 'CASH',
      narration: 'Advance payment',
    });
  });
});
