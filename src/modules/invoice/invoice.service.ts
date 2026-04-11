import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceStatus, InvoiceType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInvoiceDto, InvoiceTypeEnum } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { InvoiceNumberService } from './invoice-number.service';
import {
  parsePagination,
  createPaginatedResult,
} from '../../common/utils/pagination.util';

type PreparedItem = {
  productId: string;
  productName: string;
  productHsnCode: string | null;
  productUnit: string;
  quantity: number;
  rate: number;
  taxRate: number;
  taxAmount: number;
  amount: number;
};

@Injectable()
export class InvoiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invoiceNumberService: InvoiceNumberService,
  ) {}

  async create(
    companyId: string,
    financialYearId: string | null,
    _userId: string,
    dto: CreateInvoiceDto,
  ) {
    const invoiceType = this.normalizeInvoiceType(dto.invoiceType);
    const company = await this.getCompanyContext(companyId);
    const invoiceDate = new Date(dto.invoiceDate);
    await this.ensureAccountBelongsToCompany(companyId, dto.accountId);

    if (financialYearId) {
      await this.ensureFinancialYearBelongsToCompany(
        companyId,
        financialYearId,
        invoiceDate,
      );
    }

    const fyId =
      financialYearId ??
      (await this.resolveFinancialYearId(companyId, invoiceDate));

    const manualInvoiceNumber = dto.invoiceNumber?.trim() || null;

    // ── Validate & pre-check manual bill number ──────────────────────────────
    // Numeric check is already enforced by @Matches in the DTO, but we guard
    // again here for programmatic callers (e.g. convertInvoice).
    if (manualInvoiceNumber) {
      if (!/^\d+$/.test(manualInvoiceNumber)) {
        throw new BadRequestException(
          `Bill number "${manualInvoiceNumber}" is invalid. Bill numbers must be strictly numeric (e.g. 1, 2, 3).`,
        );
      }

      // Duplicate check before transaction — scoped to the same invoice type
      // so that e.g. PURCHASE #1 and SALE #1 can coexist independently.
      const existing = await this.prisma.invoice.findFirst({
        where: {
          companyId,
          financialYearId: fyId,
          invoiceNumber: manualInvoiceNumber,
          type: invoiceType,
          deletedAt: null,
        },
        select: { invoiceNumber: true, type: true },
      });
      if (existing) {
        throw new ConflictException(
          `Bill number ${manualInvoiceNumber} already exists for this invoice type and financial year. ` +
            `Please use a different number.`,
        );
      }
    } else {
      // Auto-number path: align sequence before entering transaction.
      await this.invoiceNumberService.alignSequenceWithExistingInvoices(
        companyId,
        invoiceType,
        fyId,
      );
    }

    const createdInvoiceId = await this.prisma.$transaction(async (tx) => {
      const items = await this.prepareItems(tx, companyId, dto.items);
      const totals = this.computeTotals(items);

      const invoiceNumber =
        manualInvoiceNumber ||
        (await this.invoiceNumberService.getNextNumberWithTx(
          companyId,
          invoiceType,
          tx as any,
          fyId,
        ));

      let invoice: { id: string };
      try {
        invoice = await tx.invoice.create({
          data: {
            tenantId: company.tenantId,
            companyId,
            accountId: dto.accountId,
            financialYearId: fyId,
            invoiceNumber,
            invoiceDate,
            type: invoiceType,
            status: this.normalizeInvoiceStatus(
              dto.status as string | undefined,
            ),
            version: 1,
            isLatest: true,
            notes: dto.narration ?? null,
            partyChallanNo: dto.partyChallanNo ?? null,
            subTotal: totals.subTotal,
            taxAmount: totals.taxAmount,
            discountAmount: totals.discountAmount,
            totalAmount: totals.totalAmount,
          },
        });
      } catch (err) {
        // Concurrent duplicate — catch DB unique-constraint violation (P2002)
        // and turn it into a friendly conflict message instead of a 500.
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          throw new ConflictException(
            `Bill number ${invoiceNumber} was already taken by a concurrent request. ` +
              `Please retry; the next available number will be assigned automatically.`,
          );
        }
        throw err;
      }

      if (items.length > 0) {
        await tx.invoiceItem.createMany({
          data: items.map((item) => ({
            tenantId: company.tenantId,
            companyId,
            invoiceId: invoice.id,
            productId: item.productId,
            productName: item.productName,
            productHsnCode: item.productHsnCode,
            productUnit: item.productUnit,
            quantity: item.quantity,
            rate: item.rate,
            taxRate: item.taxRate,
            taxAmount: item.taxAmount,
            amount: item.amount,
          })),
        });
      }

      return invoice.id;
    });

    return this.findById(companyId, createdInvoiceId);
  }

  async findAll(
    companyId: string,
    query: {
      page?: number;
      limit?: number;
      search?: string;
      invoiceType?: string;
      status?: string;
      accountId?: string;
      fromDate?: string;
      toDate?: string;
    },
  ) {
    const { skip, take, page, limit } = parsePagination(query);
    const where: Prisma.InvoiceWhereInput = {
      companyId,
      deletedAt: null,
    };

    if (query.search) {
      where.OR = [
        { invoiceNumber: { contains: query.search, mode: 'insensitive' } },
        {
          account: {
            party: {
              name: { contains: query.search, mode: 'insensitive' },
            },
          },
        },
      ];
    }

    if (query.invoiceType) {
      where.type = this.normalizeInvoiceType(query.invoiceType);
    }

    if (query.status) {
      where.status = this.normalizeInvoiceStatus(query.status);
    }

    if (query.accountId) {
      where.accountId = query.accountId;
    }

    if (query.fromDate || query.toDate) {
      where.invoiceDate = {};
      if (query.fromDate) where.invoiceDate.gte = new Date(query.fromDate);
      if (query.toDate) where.invoiceDate.lte = new Date(query.toDate);
    }

    const [data, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        skip,
        take,
        orderBy: { invoiceDate: 'desc' },
        include: {
          account: {
            select: {
              id: true,
              group: true,
              party: {
                select: {
                  id: true,
                  name: true,
                  gstin: true,
                  phone: true,
                  email: true,
                  address: true,
                  city: true,
                  state: true,
                  pincode: true,
                  contactPerson: true,
                  bankName: true,
                  bankAccountNo: true,
                  bankIfsc: true,
                },
              },
            },
          },
          _count: { select: { items: true } },
        },
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return createPaginatedResult(data, total, page, limit);
  }

  async getSummary(companyId: string, financialYearId?: string) {
    const where: Prisma.InvoiceWhereInput = {
      companyId,
      deletedAt: null,
      ...(financialYearId ? { financialYearId } : {}),
    };

    const [countByType, totals, groupedPayments] = await Promise.all([
      this.prisma.invoice.groupBy({
        by: ['type'],
        where,
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),
      this.prisma.invoice.aggregate({
        where,
        _sum: {
          subTotal: true,
          taxAmount: true,
          discountAmount: true,
          totalAmount: true,
        },
      }),
      this.prisma.ledgerEntry.groupBy({
        by: ['invoiceId'],
        where: {
          companyId,
          invoiceId: { not: null },
        },
        _sum: { credit: true },
      }),
    ]);

    const paidByInvoice = new Map(
      groupedPayments.map((row) => [
        row.invoiceId ?? '',
        Number(row._sum.credit ?? 0),
      ]),
    );

    const invoices = await this.prisma.invoice.findMany({
      where,
      select: { id: true, totalAmount: true },
    });

    const outstanding = invoices.reduce((sum, invoice) => {
      const paid = paidByInvoice.get(invoice.id) ?? 0;
      return sum + Math.max(0, Number(invoice.totalAmount) - paid);
    }, 0);

    return {
      byType: countByType,
      totals: {
        subTotal: Number(totals._sum.subTotal ?? 0),
        taxAmount: Number(totals._sum.taxAmount ?? 0),
        discountAmount: Number(totals._sum.discountAmount ?? 0),
        totalAmount: Number(totals._sum.totalAmount ?? 0),
        outstanding: this.round2(outstanding),
      },
    };
  }

  async findById(companyId: string, id: string, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const invoice = await db.invoice.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        account: {
          select: {
            id: true,
            group: true,
            party: {
              select: {
                id: true,
                name: true,
                gstin: true,
                phone: true,
                email: true,
                address: true,
                city: true,
                state: true,
                pincode: true,
                contactPerson: true,
                bankName: true,
                bankAccountNo: true,
                bankIfsc: true,
              },
            },
          },
        },
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                sku: true,
                hsnCode: true,
                unit: true,
              },
            },
          },
          orderBy: { id: 'asc' },
        },
      },
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    return {
      ...invoice,
      items: (invoice.items ?? []).map((item) => ({
        ...item,
        product: item.product
          ? {
              ...item.product,
              name: item.productName ?? item.product.name,
              hsnCode: item.productHsnCode ?? item.product.hsnCode,
              unit: item.productUnit ?? item.product.unit,
            }
          : item.product,
      })),
    };
  }

  async getCompany(companyId: string) {
    return this.getCompanyContext(companyId);
  }

  async update(companyId: string, id: string, dto: UpdateInvoiceDto) {
    const existing = await this.findById(companyId, id);
    const company = await this.getCompanyContext(companyId);

    const updatedInvoiceId = await this.prisma.$transaction(async (tx) => {
      let totals = {
        subTotal: Number(existing.subTotal),
        taxAmount: Number(existing.taxAmount),
        discountAmount: Number(existing.discountAmount),
        totalAmount: Number(existing.totalAmount),
      };

      if (dto.items && dto.items.length > 0) {
        const prepared = await this.prepareItems(tx, companyId, dto.items);
        totals = this.computeTotals(prepared);

        await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
        await tx.invoiceItem.createMany({
          data: prepared.map((item) => ({
            tenantId: company.tenantId,
            companyId,
            invoiceId: id,
            productId: item.productId,
            productName: item.productName,
            productHsnCode: item.productHsnCode,
            productUnit: item.productUnit,
            quantity: item.quantity,
            rate: item.rate,
            taxRate: item.taxRate,
            taxAmount: item.taxAmount,
            amount: item.amount,
          })),
        });
      }

      await tx.invoice.update({
        where: { id },
        data: {
          ...(dto.invoiceNumber
            ? { invoiceNumber: dto.invoiceNumber.trim() }
            : {}),
          ...(dto.invoiceDate
            ? { invoiceDate: new Date(dto.invoiceDate) }
            : {}),
          ...(dto.accountId ? { accountId: dto.accountId } : {}),
          ...(dto.status
            ? { status: this.normalizeInvoiceStatus(dto.status as string) }
            : {}),
          ...(dto.narration !== undefined
            ? { notes: dto.narration ?? null }
            : {}),
          ...(dto.partyChallanNo !== undefined
            ? { partyChallanNo: dto.partyChallanNo ?? null }
            : {}),
          subTotal: totals.subTotal,
          taxAmount: totals.taxAmount,
          discountAmount: totals.discountAmount,
          totalAmount: totals.totalAmount,
        },
      });

      return id;
    });

    return this.findById(companyId, updatedInvoiceId);
  }

  async remove(companyId: string, id: string) {
    await this.findById(companyId, id);
    return this.prisma.invoice.update({
      where: { id },
      data: {
        status: InvoiceStatus.CANCELLED,
        deletedAt: new Date(),
      },
    });
  }

  async recordPayment(companyId: string, id: string, dto: RecordPaymentDto) {
    const invoice = await this.findById(companyId, id);
    const company = await this.getCompanyContext(companyId);

    return this.prisma.ledgerEntry.create({
      data: {
        tenantId: company.tenantId,
        companyId,
        accountId: invoice.accountId,
        invoiceId: invoice.id,
        date: new Date(dto.paymentDate),
        debit: 0,
        credit: dto.amount,
        narration: `[INVOICE_PAYMENT] mode=${dto.paymentMode}${
          dto.bookName ? ` book=${dto.bookName}` : ''
        }${dto.chequeNumber ? ` cheque=${dto.chequeNumber}` : ''}${
          dto.narration ? ` note=${dto.narration}` : ''
        }`,
      },
    });
  }

  async getPayments(companyId: string, id: string) {
    await this.findById(companyId, id);
    return this.prisma.ledgerEntry.findMany({
      where: {
        companyId,
        invoiceId: id,
        narration: { contains: '[INVOICE_PAYMENT]' },
      },
      orderBy: { date: 'desc' },
      select: {
        id: true,
        date: true,
        credit: true,
        narration: true,
      },
    });
  }

  async deletePayment(companyId: string, id: string, paymentId: string) {
    await this.findById(companyId, id);
    const payment = await this.prisma.ledgerEntry.findFirst({
      where: {
        id: paymentId,
        companyId,
        invoiceId: id,
        narration: { contains: '[INVOICE_PAYMENT]' },
      },
      select: { id: true },
    });
    if (!payment) {
      throw new NotFoundException('Payment not found');
    }
    await this.prisma.ledgerEntry.delete({ where: { id: paymentId } });
    return { message: 'Deleted' };
  }

  async convertInvoice(
    companyId: string,
    id: string,
    targetType: InvoiceTypeEnum,
    userId: string,
  ) {
    const source = await this.findById(companyId, id);
    const convertedType = this.normalizeInvoiceType(targetType);
    if (convertedType === source.type) {
      throw new BadRequestException(
        'Target type must be different from source',
      );
    }

    const result = await this.create(
      companyId,
      source.financialYearId,
      userId,
      {
        invoiceType: convertedType as any,
        invoiceDate: source.invoiceDate.toISOString(),
        accountId: source.accountId,
        narration: `Converted from invoice ${source.invoiceNumber}`,
        items: source.items.map((item) => ({
          productId: item.productId,
          quantity: Number(item.quantity),
          rate: Number(item.rate),
          gstRate: Number(item.taxRate),
        })),
      } as CreateInvoiceDto,
    );

    return {
      sourceInvoiceId: source.id,
      convertedInvoice: result,
    };
  }

  private async getCompanyContext(companyId: string) {
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, deletedAt: null },
      select: {
        id: true,
        tenantId: true,
        name: true,
        gstin: true,
        address: true,
        city: true,
        state: true,
        pincode: true,
        phone: true,
        email: true,
      },
    });
    if (!company) {
      throw new NotFoundException('Company not found');
    }
    return company;
  }

  private async resolveFinancialYearId(companyId: string, invoiceDate: Date) {
    const financialYear = await this.prisma.financialYear.findFirst({
      where: {
        companyId,
        startDate: { lte: invoiceDate },
        endDate: { gte: invoiceDate },
      },
      orderBy: { startDate: 'desc' },
      select: { id: true },
    });
    if (!financialYear) {
      throw new BadRequestException(
        'No financial year found for invoice date. Create or select a valid financial year.',
      );
    }
    return financialYear.id;
  }

  private async ensureAccountBelongsToCompany(
    companyId: string,
    accountId: string,
  ) {
    const account = await this.prisma.account.findFirst({
      where: {
        id: accountId,
        companyId,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!account) {
      throw new BadRequestException(
        'Selected account is invalid for this company. Choose an active account and try again.',
      );
    }
  }

  private async ensureFinancialYearBelongsToCompany(
    companyId: string,
    financialYearId: string,
    invoiceDate: Date,
  ) {
    const financialYear = await this.prisma.financialYear.findFirst({
      where: {
        id: financialYearId,
        companyId,
      },
      select: { startDate: true, endDate: true },
    });

    if (!financialYear) {
      throw new BadRequestException(
        'Selected financial year is invalid for this company. Choose a valid financial year and try again.',
      );
    }

    if (
      invoiceDate < financialYear.startDate ||
      invoiceDate > financialYear.endDate
    ) {
      throw new BadRequestException(
        'Invoice date is outside the selected financial year. Choose a date within the selected financial year.',
      );
    }
  }

  private normalizeInvoiceType(value: string): InvoiceType {
    const normalized = value?.trim().toUpperCase();
    switch (normalized) {
      case 'SALE':
        return InvoiceType.SALE;
      case 'PURCHASE':
        return InvoiceType.PURCHASE;
      case 'QUOTATION':
        return InvoiceType.QUOTATION;
      case 'CHALLAN':
        return InvoiceType.CHALLAN;
      case 'PROFORMA':
        return InvoiceType.PROFORMA;
      case 'SALE_RETURN':
        return InvoiceType.SALE_RETURN;
      case 'PURCHASE_RETURN':
        return InvoiceType.PURCHASE_RETURN;
      case 'JOB_IN':
        return InvoiceType.JOB_IN;
      case 'JOB_OUT':
        return InvoiceType.JOB_OUT;
      default:
        throw new BadRequestException(`Unsupported invoice type: ${value}`);
    }
  }

  private normalizeInvoiceStatus(value?: string): InvoiceStatus {
    const normalized = value?.trim().toUpperCase();
    switch (normalized) {
      case 'DRAFT':
        return InvoiceStatus.DRAFT;
      case 'CANCELLED':
        return InvoiceStatus.CANCELLED;
      case 'ACTIVE':
      case 'PAID':
      case 'PARTIALLY_PAID':
      default:
        return InvoiceStatus.ACTIVE;
    }
  }

  private async prepareItems(
    tx: Prisma.TransactionClient,
    companyId: string,
    items: Array<{
      productId: string;
      quantity: number;
      rate: number;
      gstRate?: number;
      discountPercent?: number;
      discountAmount?: number;
    }>,
  ): Promise<PreparedItem[]> {
    if (!items?.length) {
      throw new BadRequestException('At least one invoice item is required');
    }

    const productIds = [...new Set(items.map((item) => item.productId))];
    const products = await tx.product.findMany({
      where: {
        id: { in: productIds },
        companyId,
      },
      select: {
        id: true,
        name: true,
        hsnCode: true,
        unit: true,
        taxRate: true,
      },
    });
    const productMap = new Map(
      products.map((product) => [product.id, product]),
    );

    return items.map((item) => {
      if (!productMap.has(item.productId)) {
        throw new BadRequestException(
          `Product ${item.productId} does not belong to this company`,
        );
      }

      const quantity = Number(item.quantity);
      const rate = Number(item.rate);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new BadRequestException('Item quantity must be greater than 0');
      }
      if (!Number.isFinite(rate) || rate < 0) {
        throw new BadRequestException('Item rate must be 0 or greater');
      }

      const baseAmount = quantity * rate;
      const discountByPercent =
        item.discountPercent && item.discountPercent > 0
          ? (baseAmount * Number(item.discountPercent)) / 100
          : 0;
      const discount = Math.max(
        0,
        Number(item.discountAmount ?? discountByPercent ?? 0),
      );
      const taxable = Math.max(0, baseAmount - discount);
      const resolvedTaxRate = Number(
        item.gstRate ?? productMap.get(item.productId)?.taxRate ?? 0,
      );
      const taxAmount = (taxable * resolvedTaxRate) / 100;

      return {
        productId: item.productId,
        productName: String(
          productMap.get(item.productId)?.name ?? 'Unknown product',
        ),
        productHsnCode: productMap.get(item.productId)?.hsnCode ?? null,
        productUnit: String(productMap.get(item.productId)?.unit ?? 'MTR'),
        quantity: this.round3(quantity),
        rate: this.round2(rate),
        amount: this.round2(taxable),
        taxRate: this.round2(resolvedTaxRate),
        taxAmount: this.round2(taxAmount),
      };
    });
  }

  private computeTotals(items: PreparedItem[]) {
    const subTotal = items.reduce(
      (sum, item) => sum + item.quantity * item.rate,
      0,
    );
    const taxAmount = items.reduce((sum, item) => sum + item.taxAmount, 0);
    const taxableAmount = items.reduce((sum, item) => sum + item.amount, 0);
    const discountAmount = Math.max(0, subTotal - taxableAmount);
    const totalAmount = subTotal + taxAmount - discountAmount;

    return {
      subTotal: this.round2(subTotal),
      taxAmount: this.round2(taxAmount),
      discountAmount: this.round2(discountAmount),
      totalAmount: this.round2(totalAmount),
    };
  }

  private round2(value: number) {
    return Math.round(value * 100) / 100;
  }

  private round3(value: number) {
    return Math.round(value * 1000) / 1000;
  }
}
