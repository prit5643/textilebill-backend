import { BadRequestException } from '@nestjs/common';
import { VoucherNumberService } from './voucher-number.service';

describe('VoucherNumberService', () => {
  let service: VoucherNumberService;

  beforeEach(() => {
    service = new VoucherNumberService();
  });

  it('allocates sequence using voucherSequence unique key and returns prefixed number', async () => {
    const tx = {
      company: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'company-1',
          tenantId: 'tenant-1',
        }),
      },
      financialYear: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'fy-1',
        }),
      },
      voucherSequence: {
        upsert: jest.fn().mockResolvedValue({
          prefix: 'CB-',
          currentValue: 7,
        }),
      },
    } as any;

    await expect(
      service.getNextNumber(tx, {
        companyId: 'company-1',
        series: 'CB',
        voucherDate: new Date('2025-07-14T00:00:00.000Z'),
      }),
    ).resolves.toBe('CB-0007');

    expect(tx.voucherSequence.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId_financialYearId_type: {
            companyId: 'company-1',
            financialYearId: 'fy-1',
            type: 'RECEIPT',
          },
        },
      }),
    );
  });

  it('throws when no financial year covers voucher date', async () => {
    const tx = {
      company: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'company-1',
          tenantId: 'tenant-1',
        }),
      },
      financialYear: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      voucherSequence: {
        upsert: jest.fn(),
      },
    } as any;

    await expect(
      service.getNextNumber(tx, {
        companyId: 'company-1',
        series: 'JV',
        voucherDate: new Date('2025-07-14T00:00:00.000Z'),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws when company does not exist', async () => {
    const tx = {
      company: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    } as any;

    await expect(
      service.getNextNumber(tx, {
        companyId: 'missing-company',
        series: 'JV',
        voucherDate: new Date('2025-07-14T00:00:00.000Z'),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
