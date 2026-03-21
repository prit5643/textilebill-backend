import { BadRequestException } from '@nestjs/common';
import { VoucherNumberService } from './voucher-number.service';

describe('VoucherNumberService', () => {
  let service: VoucherNumberService;

  beforeEach(() => {
    service = new VoucherNumberService();
  });

  it('formats voucher numbers with series + financial-year label + zero-padded sequence', async () => {
    const tx = {
      financialYear: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'fy-1',
          startDate: new Date('2025-04-01T00:00:00.000Z'),
          endDate: new Date('2026-03-31T00:00:00.000Z'),
        }),
      },
      voucherSequence: {
        upsert: jest.fn().mockResolvedValue({ currentNumber: 7 }),
      },
    } as any;

    await expect(
      service.getNextNumber(tx, {
        companyId: 'company-1',
        series: 'CB',
        voucherDate: new Date('2025-07-14T00:00:00.000Z'),
      }),
    ).resolves.toBe('CB-2025-26-0007');

    expect(tx.voucherSequence.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId_financialYearId_series: {
            companyId: 'company-1',
            financialYearId: 'fy-1',
            series: 'CB',
          },
        },
      }),
    );
  });

  it('throws when voucher date is outside configured financial years', async () => {
    const tx = {
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

    expect(tx.voucherSequence.upsert).not.toHaveBeenCalled();
  });

  it('falls back to financial-year name when date-range timestamps do not match', async () => {
    const tx = {
      financialYear: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: 'fy-1',
            startDate: new Date('2025-03-31T18:30:00.000Z'),
            endDate: new Date('2026-03-30T18:30:00.000Z'),
          }),
      },
      voucherSequence: {
        upsert: jest.fn().mockResolvedValue({ currentNumber: 1 }),
      },
    } as any;

    await expect(
      service.getNextNumber(tx, {
        companyId: 'company-1',
        series: 'OB',
        voucherDate: new Date('2026-03-31T00:00:00.000Z'),
      }),
    ).resolves.toBe('OB-2025-26-0001');

    expect(tx.financialYear.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: 'company-1',
          name: '2025-26',
        }),
      }),
    );
  });

  it('produces unique numbers under concurrent allocations', async () => {
    let counter = 0;
    const tx = {
      financialYear: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'fy-1',
          startDate: new Date('2025-04-01T00:00:00.000Z'),
          endDate: new Date('2026-03-31T00:00:00.000Z'),
        }),
      },
      voucherSequence: {
        upsert: jest.fn().mockImplementation(async () => {
          counter += 1;
          return { currentNumber: counter };
        }),
      },
    } as any;

    const allocations = await Promise.all(
      Array.from({ length: 20 }, () =>
        service.getNextNumber(tx, {
          companyId: 'company-1',
          series: 'BB',
          voucherDate: new Date('2025-07-14T00:00:00.000Z'),
        }),
      ),
    );

    expect(new Set(allocations).size).toBe(20);
    expect(allocations).toContain('BB-2025-26-0001');
    expect(allocations).toContain('BB-2025-26-0020');
  });
});
