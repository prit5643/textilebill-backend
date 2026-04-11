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
  'company' | 'financialYear' | 'voucherSequence' | 'invoice'
> & {
  $queryRaw?: PrismaService['$queryRaw'];
};

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

  async alignSequenceWithExistingInvoices(
    companyId: string,
    invoiceType: InvoiceType,
    financialYearId: string,
  ): Promise<void> {
    const config = await this.ensureConfig(
      this.prisma as unknown as PrismaLikeClient,
      companyId,
      invoiceType,
      financialYearId,
    );
    const maxExistingNumber = await this.getMaxNumericInvoiceNumber(
      companyId,
      financialYearId,
      invoiceType,
    );

    if (maxExistingNumber <= config.currentNumber) {
      return;
    }

    await this.prisma.voucherSequence.updateMany({
      where: {
        id: config.id,
        currentValue: { lt: maxExistingNumber },
      },
      data: { currentValue: maxExistingNumber },
    });
  }

  async getNextNumberWithTx(
    companyId: string,
    invoiceType: InvoiceType,
    tx: PrismaLikeClient,
    financialYearId?: string,
  ): Promise<string> {
    const config = await this.ensureConfig(
      tx,
      companyId,
      invoiceType,
      financialYearId,
    );

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
    financialYearId?: string,
  ) {
    const company = await tx.company.findUnique({
      where: { id: companyId },
      select: { id: true, tenantId: true },
    });
    if (!company) {
      throw new NotFoundException('Company not found');
    }

    const fyId =
      financialYearId ?? (await this.resolveFinancialYear(tx, companyId)).id;
    // Each invoice type maintains its own independent numbered sequence.
    // e.g. SALE 1,2,3... and PURCHASE 1,2,3... are fully separate counters.
    const voucherType = this.toVoucherType(invoiceType);
    const prefix = '';

    const sequence = await tx.voucherSequence.upsert({
      where: {
        companyId_financialYearId_type: {
          companyId,
          financialYearId: fyId,
          type: voucherType,
        },
      },
      update: {},
      create: {
        tenantId: company.tenantId,
        companyId,
        financialYearId: fyId,
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

  /**
   * Fast O(log N) aggregation using PostgreSQL MAX on numeric invoice numbers.
   * Skips non-numeric numbers via NULLIF + REGEXP_REPLACE guard.
   * Much faster than loading all invoices into JS for large companies.
   */
  private async getMaxNumericInvoiceNumber(
    companyId: string,
    financialYearId: string,
    invoiceType?: InvoiceType,
  ): Promise<number> {
    type Row = { max_num: string | null };
    // Filter by invoice type so each type's sequence aligns only with its own invoices.
    const typeFilter = invoiceType ?? null;
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT MAX(
        CASE
          WHEN "invoiceNumber" ~ '^[0-9]+$'
          THEN CAST("invoiceNumber" AS INTEGER)
          ELSE NULL
        END
      ) AS max_num
      FROM "Invoice"
      WHERE "companyId" = ${companyId}
        AND "financialYearId" = ${financialYearId}
        AND "deletedAt" IS NULL
        AND (${typeFilter}::text IS NULL OR "type" = ${typeFilter}::"InvoiceType")
    `;

    const raw = rows?.[0]?.max_num;
    if (raw === null || raw === undefined) return 0;
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
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
      case InvoiceType.QUOTATION:
        return VoucherType.QUOTATION;
      case InvoiceType.CHALLAN:
        return VoucherType.CHALLAN;
      case InvoiceType.PROFORMA:
        return VoucherType.PROFORMA;
      case InvoiceType.SALE_RETURN:
        return VoucherType.SALE_RETURN;
      case InvoiceType.PURCHASE_RETURN:
        return VoucherType.PURCHASE_RETURN;
      case InvoiceType.JOB_IN:
        return VoucherType.JOB_IN;
      case InvoiceType.JOB_OUT:
        return VoucherType.JOB_OUT;
      default:
        return VoucherType.SALE;
    }
  }

  private toInvoiceType(type: VoucherType): InvoiceType {
    switch (type) {
      case VoucherType.SALE:
        return InvoiceType.SALE;
      case VoucherType.PURCHASE:
        return InvoiceType.PURCHASE;
      case VoucherType.QUOTATION:
        return InvoiceType.QUOTATION;
      case VoucherType.CHALLAN:
        return InvoiceType.CHALLAN;
      case VoucherType.PROFORMA:
        return InvoiceType.PROFORMA;
      case VoucherType.SALE_RETURN:
        return InvoiceType.SALE_RETURN;
      case VoucherType.PURCHASE_RETURN:
        return InvoiceType.PURCHASE_RETURN;
      case VoucherType.JOB_IN:
        return InvoiceType.JOB_IN;
      case VoucherType.JOB_OUT:
        return InvoiceType.JOB_OUT;
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
