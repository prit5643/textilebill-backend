import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, VoucherType } from '@prisma/client';

@Injectable()
export class VoucherNumberService {
  async getNextNumber(
    tx: Prisma.TransactionClient,
    params: {
      companyId: string;
      series: string;
      voucherDate: Date;
    },
  ): Promise<string> {
    const company = await tx.company.findUnique({
      where: { id: params.companyId },
      select: { id: true, tenantId: true },
    });
    if (!company) {
      throw new BadRequestException('Company not found');
    }

    const financialYear = await this.resolveFinancialYear(
      tx,
      company.id,
      params.voucherDate,
    );
    const voucherType = this.resolveVoucherType(params.series);
    const defaultPrefix = `${params.series}-`;

    const sequence = await tx.voucherSequence.upsert({
      where: {
        companyId_financialYearId_type: {
          companyId: company.id,
          financialYearId: financialYear.id,
          type: voucherType,
        },
      },
      update: {
        currentValue: { increment: 1 },
      },
      create: {
        tenantId: company.tenantId,
        companyId: company.id,
        financialYearId: financialYear.id,
        type: voucherType,
        prefix: defaultPrefix,
        currentValue: 1,
      },
      select: {
        prefix: true,
        currentValue: true,
      },
    });

    return `${sequence.prefix}${String(sequence.currentValue).padStart(4, '0')}`;
  }

  private resolveVoucherType(series: string): VoucherType {
    const normalized = series.trim().toUpperCase();

    if (Object.values(VoucherType).includes(normalized as VoucherType)) {
      return normalized as VoucherType;
    }

    switch (normalized) {
      case 'CB':
        return VoucherType.RECEIPT;
      case 'BB':
        return VoucherType.PAYMENT;
      case 'JV':
      case 'OB':
      default:
        return VoucherType.JOURNAL;
    }
  }

  private async resolveFinancialYear(
    tx: Prisma.TransactionClient,
    companyId: string,
    voucherDate: Date,
  ) {
    const financialYear = await tx.financialYear.findFirst({
      where: {
        companyId,
        startDate: { lte: voucherDate },
        endDate: { gte: voucherDate },
      },
      orderBy: { startDate: 'desc' },
      select: { id: true },
    });

    if (!financialYear) {
      throw new BadRequestException(
        `No financial year found for voucher date ${voucherDate.toISOString().slice(0, 10)}.`,
      );
    }

    return financialYear;
  }
}
