import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceType, VoucherType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateInvoiceNumberConfigDto,
  UpdateInvoiceNumberConfigDto,
} from './dto';

type PrismaLikeClient = Pick<
  PrismaService,
  'company' | 'financialYear' | 'voucherSequence'
>;

@Injectable()
export class InvoiceNumberService {
  constructor(private prisma: PrismaService) {}

  async getOrCreate(companyId: string, invoiceType: InvoiceType) {
    const tx = this.prisma as unknown as PrismaLikeClient;
    return this.ensureConfig(tx, companyId, invoiceType);
  }

  async getNextNumber(
    companyId: string,
    invoiceType: InvoiceType,
  ): Promise<string> {
    return this.getNextNumberWithTx(companyId, invoiceType, this.prisma);
  }

  async getNextNumberWithTx(
    companyId: string,
    invoiceType: InvoiceType,
    tx: PrismaLikeClient,
  ): Promise<string> {
    const config = await this.ensureConfig(tx, companyId, invoiceType);
    const sequence = await tx.voucherSequence.update({
      where: { id: config.id },
      data: { currentValue: { increment: 1 } },
      select: { currentValue: true },
    });

    return String(sequence.currentValue);
  }

  async findAll(companyId: string) {
    const tx = this.prisma as unknown as PrismaLikeClient;
    const fy = await this.resolveFinancialYear(tx, companyId);
    const sequences = await this.prisma.voucherSequence.findMany({
      where: { companyId, financialYearId: fy.id },
      orderBy: { type: 'asc' },
    });

    return sequences.map((row) =>
      this.toInvoiceConfig(row, this.toInvoiceType(row.type)),
    );
  }

  async create(companyId: string, dto: CreateInvoiceNumberConfigDto) {
    const invoiceType = this.normalizeInvoiceType(dto.invoiceType as string);
    const tx = this.prisma as unknown as PrismaLikeClient;
    const company = await tx.company.findUnique({
      where: { id: companyId },
      select: { id: true, tenantId: true },
    });
    if (!company) {
      throw new NotFoundException('Company not found');
    }
    const fy = await this.resolveFinancialYear(tx, companyId);

    const created = await this.prisma.voucherSequence.upsert({
      where: {
        companyId_financialYearId_type: {
          companyId,
          financialYearId: fy.id,
          type: this.toVoucherType(invoiceType),
        },
      },
      update: {
        prefix: dto.prefix ?? `${invoiceType.slice(0, 3)}-`,
        currentValue: Math.max(0, (dto.startingNumber ?? 1) - 1),
      },
      create: {
        tenantId: company.tenantId,
        companyId,
        financialYearId: fy.id,
        type: this.toVoucherType(invoiceType),
        prefix: dto.prefix ?? `${invoiceType.slice(0, 3)}-`,
        currentValue: Math.max(0, (dto.startingNumber ?? 1) - 1),
      },
    });

    return this.toInvoiceConfig(created, invoiceType);
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateInvoiceNumberConfigDto,
  ) {
    const config = await this.prisma.voucherSequence.findFirst({
      where: { id, companyId },
    });
    if (!config) throw new NotFoundException('Invoice number config not found');

    const updated = await this.prisma.voucherSequence.update({
      where: { id },
      data: {
        ...(dto.prefix !== undefined ? { prefix: dto.prefix } : {}),
        ...(dto.startingNumber !== undefined
          ? { currentValue: Math.max(0, dto.startingNumber - 1) }
          : {}),
      },
    });

    return this.toInvoiceConfig(updated, this.toInvoiceType(updated.type));
  }

  private async ensureConfig(
    tx: PrismaLikeClient,
    companyId: string,
    invoiceType: InvoiceType,
  ) {
    const company = await tx.company.findUnique({
      where: { id: companyId },
      select: { id: true, tenantId: true },
    });
    if (!company) {
      throw new NotFoundException('Company not found');
    }

    const fy = await this.resolveFinancialYear(tx, companyId);
    // Keep one shared auto-number sequence across invoice types
    // so simple numeric numbers remain unique at company+FY scope.
    const voucherType = VoucherType.SALE;
    const prefix = '';

    const sequence = await tx.voucherSequence.upsert({
      where: {
        companyId_financialYearId_type: {
          companyId,
          financialYearId: fy.id,
          type: voucherType,
        },
      },
      update: {},
      create: {
        tenantId: company.tenantId,
        companyId,
        financialYearId: fy.id,
        type: voucherType,
        prefix,
        currentValue: 0,
      },
    });

    return this.toInvoiceConfig(sequence, invoiceType);
  }

  private async resolveFinancialYear(tx: PrismaLikeClient, companyId: string) {
    const now = new Date();
    const byDate = await tx.financialYear.findFirst({
      where: {
        companyId,
        startDate: { lte: now },
        endDate: { gte: now },
      },
      orderBy: { startDate: 'desc' },
      select: { id: true },
    });

    if (byDate) return byDate;

    const latest = await tx.financialYear.findFirst({
      where: { companyId },
      orderBy: { startDate: 'desc' },
      select: { id: true },
    });
    if (!latest) {
      throw new BadRequestException(
        'No financial year exists for this company. Create a financial year first.',
      );
    }
    return latest;
  }

  private normalizeInvoiceType(value: string): InvoiceType {
    const normalized = value.trim().toUpperCase();
    if (Object.values(InvoiceType).includes(normalized as InvoiceType)) {
      return normalized as InvoiceType;
    }
    throw new BadRequestException(`Unsupported invoice type: ${value}`);
  }

  private toVoucherType(type: InvoiceType): VoucherType {
    switch (type) {
      case InvoiceType.SALE:
        return VoucherType.SALE;
      case InvoiceType.PURCHASE:
        return VoucherType.PURCHASE;
      case InvoiceType.SALE_RETURN:
        return VoucherType.SALE_RETURN;
      case InvoiceType.PURCHASE_RETURN:
        return VoucherType.PURCHASE_RETURN;
      default:
        return VoucherType.SALE;
    }
  }

  private toInvoiceType(type: VoucherType): InvoiceType {
    switch (type) {
      case VoucherType.PURCHASE:
        return InvoiceType.PURCHASE;
      case VoucherType.SALE_RETURN:
        return InvoiceType.SALE_RETURN;
      case VoucherType.PURCHASE_RETURN:
        return InvoiceType.PURCHASE_RETURN;
      case VoucherType.SALE:
      default:
        return InvoiceType.SALE;
    }
  }

  private toInvoiceConfig(
    row: {
      id: string;
      companyId: string;
      type: VoucherType;
      prefix: string;
      currentValue: number;
    },
    invoiceType: InvoiceType,
  ) {
    return {
      id: row.id,
      companyId: row.companyId,
      invoiceType,
      prefix: row.prefix,
      suffix: null,
      startingNumber: 1,
      currentNumber: row.currentValue,
      isAutoNumber: true,
      gstType: null,
      stockEffect:
        invoiceType === InvoiceType.SALE ||
        invoiceType === InvoiceType.PURCHASE ||
        invoiceType === InvoiceType.SALE_RETURN ||
        invoiceType === InvoiceType.PURCHASE_RETURN,
      ledgerEffect: true,
    };
  }
}
