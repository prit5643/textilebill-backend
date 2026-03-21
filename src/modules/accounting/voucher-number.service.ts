import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, VoucherSeries } from '@prisma/client';

@Injectable()
export class VoucherNumberService {
  async getNextNumber(
    tx: Prisma.TransactionClient,
    params: {
      companyId: string;
      series: VoucherSeries;
      voucherDate: Date;
    },
  ): Promise<string> {
    const financialYear = await this.resolveFinancialYear(
      tx,
      params.companyId,
      params.voucherDate,
    );

    const sequence = await tx.voucherSequence.upsert({
      where: {
        companyId_financialYearId_series: {
          companyId: params.companyId,
          financialYearId: financialYear.id,
          series: params.series,
        },
      },
      update: {
        currentNumber: {
          increment: 1,
        },
      },
      create: {
        companyId: params.companyId,
        financialYearId: financialYear.id,
        series: params.series,
        currentNumber: 1,
      },
      select: {
        currentNumber: true,
      },
    });

    const fyLabel = this.formatFinancialYearLabel(
      financialYear.startDate,
      financialYear.endDate,
    );

    return `${params.series}-${fyLabel}-${String(sequence.currentNumber).padStart(4, '0')}`;
  }

  private async resolveFinancialYear(
    tx: Prisma.TransactionClient,
    companyId: string,
    voucherDate: Date,
  ) {
    const financialYearByRange = await tx.financialYear.findFirst({
      where: {
        companyId,
        startDate: { lte: voucherDate },
        endDate: { gte: voucherDate },
      },
      orderBy: { startDate: 'desc' },
      select: {
        id: true,
        startDate: true,
        endDate: true,
      },
    });

    if (financialYearByRange) {
      return financialYearByRange;
    }

    const financialYearName = this.buildFinancialYearNameForDate(voucherDate);
    const financialYearByName = await tx.financialYear.findFirst({
      where: {
        companyId,
        name: financialYearName,
      },
      select: {
        id: true,
        startDate: true,
        endDate: true,
      },
    });

    if (financialYearByName) {
      return financialYearByName;
    }

    throw new BadRequestException(
      `No financial year found for voucher date ${voucherDate.toISOString().slice(0, 10)}.`,
    );
  }

  private formatFinancialYearLabel(startDate: Date, endDate: Date): string {
    const startYear = startDate.getUTCFullYear();
    const endYear = endDate.getUTCFullYear();
    return `${startYear}-${String(endYear).slice(-2)}`;
  }

  private buildFinancialYearNameForDate(voucherDate: Date): string {
    const year = voucherDate.getUTCFullYear();
    const month = voucherDate.getUTCMonth();
    const startYear = month >= 3 ? year : year - 1;
    const endYear = startYear + 1;
    return `${startYear}-${String(endYear).slice(-2)}`;
  }
}
