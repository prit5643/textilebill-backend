import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceNumberService } from './invoice-number.service';
import { createPaginatedResult } from '../../common/utils/pagination.util';
import {
  CreateInvoiceDto,
  CreateInvoiceItemDto,
} from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { InvoiceStatus, InvoiceType, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class InvoiceService {
  constructor(
    private prisma: PrismaService,
    private invoiceNumberService: InvoiceNumberService,
  ) {}

  // ─── helpers ────────────────────────────────────
  private d(v: number): Decimal {
    return new Decimal(v);
  }

  private round2(v: number): number {
    return Math.round(v * 100) / 100;
  }

  private isPostedStatus(status: InvoiceStatus | null | undefined): boolean {
    return (
      status === 'ACTIVE' || status === 'PARTIALLY_PAID' || status === 'PAID'
    );
  }

  private getPaymentVoucherType(
    invoiceType: InvoiceType,
  ): 'RECEIPT' | 'PAYMENT' {
    return ['SALE', 'PURCHASE_RETURN'].includes(invoiceType)
      ? 'RECEIPT'
      : 'PAYMENT';
  }

  private buildPaymentState(
    grandTotal: number,
    paidAmount: number,
    currentStatus: InvoiceStatus = 'ACTIVE',
  ) {
    const normalizedPaid = this.round2(Math.max(0, paidAmount));

    if (normalizedPaid > grandTotal + 0.01) {
      throw new BadRequestException(
        'Paid amount cannot exceed the invoice total.',
      );
    }

    const remainingAmount = this.round2(
      Math.max(0, grandTotal - normalizedPaid),
    );
    const status: InvoiceStatus =
      currentStatus === 'DRAFT' || currentStatus === 'CANCELLED'
        ? currentStatus
        : normalizedPaid <= 0.01
          ? 'ACTIVE'
          : remainingAmount <= 0.01
            ? 'PAID'
            : 'PARTIALLY_PAID';

    return {
      paidAmount: this.d(normalizedPaid),
      receivedAmount: this.d(normalizedPaid),
      remainingAmount: this.d(remainingAmount),
      status,
    };
  }

  private getPaymentLedgerData(invoiceType: InvoiceType, amount: number) {
    const voucherType = this.getPaymentVoucherType(invoiceType);

    return {
      voucherType,
      debit: voucherType === 'PAYMENT' ? this.d(amount) : this.d(0),
      credit: voucherType === 'RECEIPT' ? this.d(amount) : this.d(0),
    };
  }

  private normalizeInvoiceNumber(invoiceNumber?: string | null): string | undefined {
    if (invoiceNumber === undefined || invoiceNumber === null) {
      return undefined;
    }

    const normalized = invoiceNumber.trim();
    if (normalized.length === 0) {
      return undefined;
    }

    // Normalize purely numeric invoice numbers (e.g. 0004 -> 4).
    if (/^\d+$/.test(normalized)) {
      return normalized.replace(/^0+(?=\d)/, '');
    }

    // Normalize numeric segments for common prefixed formats
    // (e.g. INV-0004 -> INV-4, FY-2026-0007 -> FY-2026-7).
    const segments = normalized.split('-');
    const normalizedSegments = segments.map((segment) =>
      /^\d+$/.test(segment) ? segment.replace(/^0+(?=\d)/, '') : segment,
    );

    return normalizedSegments.join('-');
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    );
  }

  /**
   * Determine if GST is intra-state (CGST+SGST) or inter-state (IGST).
   * Uses company state vs. placeOfSupply.
   */
  private isIntraState(
    companyState: string | null,
    placeOfSupply: string | null,
  ): boolean {
    if (!companyState || !placeOfSupply) return true; // default intra-state
    return (
      companyState.toLowerCase().trim() === placeOfSupply.toLowerCase().trim()
    );
  }

  /**
   * Calculate line-item totals + tax split for a single item.
   */
  private calcItem(
    item: CreateInvoiceItemDto,
    intraState: boolean,
    taxInclusive: boolean,
  ) {
    const qty = item.quantity;
    const rate = item.rate;
    const grossAmount = this.round2(qty * rate);
    const discPercent = item.discountPercent ?? 0;
    const discAmount =
      item.discountAmount ?? this.round2((grossAmount * discPercent) / 100);
    const gstRate = item.gstRate ?? 0;

    let taxableAmount: number;
    let taxAmount: number;
    if (taxInclusive) {
      // rate is inclusive of GST
      taxableAmount = this.round2(
        ((grossAmount - discAmount) * 100) / (100 + gstRate),
      );
      taxAmount = this.round2(grossAmount - discAmount - taxableAmount);
    } else {
      taxableAmount = this.round2(grossAmount - discAmount);
      taxAmount = this.round2((taxableAmount * gstRate) / 100);
    }

    let cgst = 0,
      sgst = 0,
      igst = 0;
    if (intraState) {
      cgst = this.round2(taxAmount / 2);
      sgst = this.round2(taxAmount - cgst); // handle 1-paise rounding
    } else {
      igst = taxAmount;
    }

    const totalAmount = this.round2(taxableAmount + taxAmount);

    return {
      amount: this.d(grossAmount),
      discountPercent: this.d(discPercent),
      discountAmount: this.d(discAmount),
      taxableAmount: this.d(taxableAmount),
      gstRate: this.d(gstRate),
      cgstAmount: this.d(cgst),
      sgstAmount: this.d(sgst),
      igstAmount: this.d(igst),
      totalAmount: this.d(totalAmount),
    };
  }

  // ─── CRUD ──────────────────────────────────────

  async create(
    companyId: string,
    financialYearId: string | null,
    userId: string,
    dto: CreateInvoiceDto,
  ) {
    // 1. Get company state and check for GSTIN
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { state: true, gstin: true },
    });

    if (!company?.gstin || company.gstin.trim() === '') {
      throw new BadRequestException(
        'Cannot create invoices without a GST Number. Please add a GST Number in Company Settings first.',
      );
    }

    const intraState = this.isIntraState(
      company?.state ?? null,
      dto.placeOfSupply ?? null,
    );
    const taxInclusive = dto.taxInclusiveRate ?? false;

    // 2. Calculate each item
    let subtotal = 0;
    let totalDiscount = 0;
    let taxableAmount = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let totalIgst = 0;
    let totalTax = 0;

    const itemsData = dto.items.map((item, idx) => {
      const calc = this.calcItem(item, intraState, taxInclusive);
      subtotal += Number(calc.amount);
      totalDiscount += Number(calc.discountAmount);
      taxableAmount += Number(calc.taxableAmount);
      totalCgst += Number(calc.cgstAmount);
      totalSgst += Number(calc.sgstAmount);
      totalIgst += Number(calc.igstAmount);
      totalTax +=
        Number(calc.cgstAmount) +
        Number(calc.sgstAmount) +
        Number(calc.igstAmount);

      return {
        productId: item.productId,
        description: item.description,
        quantity: this.d(item.quantity),
        rate: this.d(item.rate),
        amount: calc.amount,
        discountPercent: calc.discountPercent,
        discountAmount: calc.discountAmount,
        taxableAmount: calc.taxableAmount,
        gstRate: calc.gstRate,
        cgstAmount: calc.cgstAmount,
        sgstAmount: calc.sgstAmount,
        igstAmount: calc.igstAmount,
        totalAmount: calc.totalAmount,
        sortOrder: item.sortOrder ?? idx,
      };
    });

    const grandTotalRaw = this.round2(taxableAmount + totalTax);
    const grandTotal = Math.round(grandTotalRaw);
    const roundOff = this.round2(grandTotal - grandTotalRaw);
    const initialPaidAmount = this.round2(dto.receivedAmount ?? 0);

    if (dto.status === 'DRAFT' && initialPaidAmount > 0) {
      throw new BadRequestException(
        'Draft invoices cannot include a received amount.',
      );
    }

    if (initialPaidAmount > 0 && !dto.paymentMode) {
      throw new BadRequestException(
        'Payment mode is required when a received amount is provided.',
      );
    }

    const paymentState = this.buildPaymentState(
      grandTotal,
      initialPaidAmount,
      dto.status ?? 'ACTIVE',
    );

    // 3. Insert in a transaction (INCLUDING number generation for atomicity)
    const invoice = await this.prisma
      .$transaction(async (tx) => {
        // CRITICAL: Resolve invoice number INSIDE transaction for atomicity
        let invoiceNumber = this.normalizeInvoiceNumber(dto.invoiceNumber);
        if (!invoiceNumber) {
          invoiceNumber = await this.invoiceNumberService.getNextNumberWithTx(
            companyId,
            dto.invoiceType as InvoiceType,
            tx,
          );
          if (!invoiceNumber) {
            throw new BadRequestException(
              'Auto-numbering is disabled. Please provide an invoice number.',
            );
          }
        } else {
          const duplicateInvoice = await tx.invoice.findFirst({
            where: {
              companyId,
              invoiceType: dto.invoiceType as InvoiceType,
              invoiceNumber,
            },
            select: { id: true },
          });

          if (duplicateInvoice) {
            throw new ConflictException(
              'Invoice number already exists for this invoice type.',
            );
          }
        }

        const inv = await tx.invoice.create({
          data: {
            companyId,
            financialYearId,
            invoiceType: dto.invoiceType as InvoiceType,
            invoiceNumber,
            invoiceDate: new Date(dto.invoiceDate),
            accountId: dto.accountId,
            brokerId: dto.brokerId,
            coChallanNo: dto.coChallanNo,
            partyChallanNo: dto.partyChallanNo,
            hsnCodeHeader: dto.hsnCodeHeader,
            taxInclusiveRate: taxInclusive,
            narration: dto.narration,
            termsAndConditions: dto.termsAndConditions,
            placeOfSupply: dto.placeOfSupply,
            subtotal: this.d(subtotal),
            totalDiscount: this.d(totalDiscount),
            taxableAmount: this.d(taxableAmount),
            totalCgst: this.d(this.round2(totalCgst)),
            totalSgst: this.d(this.round2(totalSgst)),
            totalIgst: this.d(this.round2(totalIgst)),
            totalTax: this.d(this.round2(totalTax)),
            roundOff: this.d(roundOff),
            grandTotal: this.d(grandTotal),
            paidAmount: paymentState.paidAmount,
            remainingAmount: paymentState.remainingAmount,
            receivedAmount: paymentState.receivedAmount,
            paymentMode: dto.paymentMode,
            paymentBookName: dto.paymentBookName,
            paymentNarration: dto.paymentNarration,
            status: paymentState.status,
            convertedFromId: dto.convertedFromId,
            createdById: userId,
            items: { create: itemsData },
          },
          include: {
            items: { include: { product: true }, orderBy: { sortOrder: 'asc' } },
            account: true,
            broker: true,
          },
        });

        let initialPayment:
          | {
              id: string;
            }
          | undefined;

        if (initialPaidAmount > 0 && this.isPostedStatus(inv.status)) {
          initialPayment = await tx.invoicePayment.create({
            data: {
              invoiceId: inv.id,
              paymentDate: new Date(dto.invoiceDate),
              amount: this.d(initialPaidAmount),
              paymentMode: dto.paymentMode!,
              bookName: dto.paymentBookName,
              narration: dto.paymentNarration,
            },
            select: { id: true },
          });
        }

        // 5. If config says stock effect and invoice is sale/purchase, create stock movements
        const config = await this.invoiceNumberService.getOrCreate(
          companyId,
          dto.invoiceType as InvoiceType,
        );

        if (config.stockEffect && this.isPostedStatus(inv.status)) {
          const productIds = itemsData.map((i) => i.productId);
          const products = await tx.product.findMany({
            where: { id: { in: productIds } },
          });

          // OCC: Verify version and increment to prevent inventory race conditions
          for (const p of products) {
            const updated = await tx.product.updateMany({
              where: { id: p.id, version: p.version },
              data: { version: { increment: 1 } },
            });
            if (updated.count === 0) {
              throw new ConflictException(
                `Concurrency error updating stock for ${p.name}. Please try again.`,
              );
            }
          }

          const movements = itemsData.map((it) => {
            const type = ['SALE', 'SALE_RETURN', 'JOB_OUT'].includes(
              dto.invoiceType,
            )
              ? 'OUT'
              : 'IN';
            return {
              companyId,
              productId: it.productId,
              invoiceId: inv.id,
              type,
              quantity: it.quantity,
              rate: it.rate,
              date: new Date(dto.invoiceDate),
            };
          });
          await tx.stockMovement.createMany({ data: movements as any });
        }

        // 6. If config says ledger effect, create ledger entries
        if (config.ledgerEffect && this.isPostedStatus(inv.status)) {
          const isSaleType = ['SALE', 'PURCHASE_RETURN'].includes(
            dto.invoiceType,
          );
          await tx.ledgerEntry.create({
            data: {
              companyId,
              accountId: dto.accountId,
              invoiceId: inv.id,
              voucherType: dto.invoiceType,
              voucherNumber: invoiceNumber,
              date: new Date(dto.invoiceDate),
              debit: isSaleType ? this.d(grandTotal) : this.d(0),
              credit: isSaleType ? this.d(0) : this.d(grandTotal),
              narration: `${dto.invoiceType} ${invoiceNumber}`,
            },
          });

          if (initialPayment && inv.accountId) {
            const paymentLedger = this.getPaymentLedgerData(
              dto.invoiceType as InvoiceType,
              initialPaidAmount,
            );

            await tx.ledgerEntry.create({
              data: {
                companyId,
                accountId: inv.accountId,
                invoiceId: inv.id,
                voucherType: paymentLedger.voucherType,
                voucherNumber: initialPayment.id,
                date: new Date(dto.invoiceDate),
                debit: paymentLedger.debit,
                credit: paymentLedger.credit,
                narration:
                  dto.paymentNarration || `Payment for ${inv.invoiceNumber}`,
              },
            });
          }
        }

        return inv;
      })
      .catch((error: unknown) => {
        if (this.isUniqueConstraintError(error)) {
          throw new ConflictException(
            'Invoice number already exists for this invoice type.',
          );
        }
        throw error;
      });

    return invoice;
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
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const where: Prisma.InvoiceWhereInput = { companyId };

    if (query.invoiceType) {
      where.invoiceType = query.invoiceType as InvoiceType;
    }
    if (query.status) {
      where.status = query.status as any;
    }
    if (query.accountId) {
      where.accountId = query.accountId;
    }
    if (query.search) {
      where.OR = [
        { invoiceNumber: { contains: query.search, mode: 'insensitive' } },
        { account: { name: { contains: query.search, mode: 'insensitive' } } },
      ];
    }
    if (query.fromDate || query.toDate) {
      where.invoiceDate = {};
      if (query.fromDate)
        (where.invoiceDate as any).gte = new Date(query.fromDate);
      if (query.toDate) (where.invoiceDate as any).lte = new Date(query.toDate);
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({
        where,
        skip,
        take: limit,
        orderBy: { invoiceDate: 'desc' },
        include: {
          account: { select: { id: true, name: true, city: true } },
          broker: { select: { id: true, name: true } },
          _count: { select: { items: true } },
        },
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return createPaginatedResult(data, total, page, limit);
  }

  async findById(companyId: string, id: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, companyId },
      include: {
        account: true,
        broker: true,
        items: { include: { product: true }, orderBy: { sortOrder: 'asc' } },
        payments: { orderBy: { paymentDate: 'desc' } },
        financialYear: true,
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  async update(companyId: string, id: string, dto: UpdateInvoiceDto) {
    const existing = await this.prisma.invoice.findFirst({
      where: { id, companyId },
    });
    if (!existing) throw new NotFoundException('Invoice not found');
    if (existing.status === 'CANCELLED') {
      throw new BadRequestException('Cannot update a cancelled invoice');
    }
    if (existing.status === 'PARTIALLY_PAID' || existing.status === 'PAID') {
      throw new BadRequestException(
        'Paid or partially paid invoices cannot be edited.',
      );
    }
    if (
      dto.receivedAmount !== undefined &&
      this.round2(dto.receivedAmount) !== Number(existing.paidAmount ?? 0)
    ) {
      throw new BadRequestException(
        'Use payment endpoints to change invoice payments.',
      );
    }

    const normalizedInvoiceNumber =
      dto.invoiceNumber !== undefined
        ? this.normalizeInvoiceNumber(dto.invoiceNumber)
        : undefined;

    if (dto.invoiceNumber !== undefined && !normalizedInvoiceNumber) {
      throw new BadRequestException('Invoice number cannot be blank.');
    }

    const effectiveInvoiceNumber = normalizedInvoiceNumber ?? existing.invoiceNumber;

    // Get company state for GST split
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { state: true },
    });
    const intraState = this.isIntraState(
      company?.state ?? null,
      dto.placeOfSupply ?? existing.placeOfSupply ?? null,
    );
    const taxInclusive = dto.taxInclusiveRate ?? existing.taxInclusiveRate;

    return this.prisma
      .$transaction(async (tx) => {
      if (
        normalizedInvoiceNumber &&
        normalizedInvoiceNumber !== existing.invoiceNumber
      ) {
        const duplicateInvoice = await tx.invoice.findFirst({
          where: {
            companyId,
            invoiceType: existing.invoiceType,
            invoiceNumber: normalizedInvoiceNumber,
            NOT: { id },
          },
          select: { id: true },
        });

        if (duplicateInvoice) {
          throw new ConflictException(
            'Invoice number already exists for this invoice type.',
          );
        }
      }

      // If items are provided, recalculate
      if (dto.items && dto.items.length > 0) {
        // Delete old items + stock + ledger
        await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
        await tx.stockMovement.deleteMany({ where: { invoiceId: id } });
        await tx.ledgerEntry.deleteMany({ where: { invoiceId: id } });

        let subtotal = 0,
          totalDiscount = 0,
          taxableAmount = 0;
        let totalCgst = 0,
          totalSgst = 0,
          totalIgst = 0,
          totalTax = 0;

        const itemsData = dto.items.map((item, idx) => {
          const calc = this.calcItem(item, intraState, taxInclusive);
          subtotal += Number(calc.amount);
          totalDiscount += Number(calc.discountAmount);
          taxableAmount += Number(calc.taxableAmount);
          totalCgst += Number(calc.cgstAmount);
          totalSgst += Number(calc.sgstAmount);
          totalIgst += Number(calc.igstAmount);
          totalTax +=
            Number(calc.cgstAmount) +
            Number(calc.sgstAmount) +
            Number(calc.igstAmount);

          return {
            invoiceId: id,
            productId: item.productId,
            description: item.description,
            quantity: this.d(item.quantity),
            rate: this.d(item.rate),
            amount: calc.amount,
            discountPercent: calc.discountPercent,
            discountAmount: calc.discountAmount,
            taxableAmount: calc.taxableAmount,
            gstRate: calc.gstRate,
            cgstAmount: calc.cgstAmount,
            sgstAmount: calc.sgstAmount,
            igstAmount: calc.igstAmount,
            totalAmount: calc.totalAmount,
            sortOrder: item.sortOrder ?? idx,
          };
        });

        await tx.invoiceItem.createMany({ data: itemsData });

        const grandTotalRaw = this.round2(taxableAmount + totalTax);
        const grandTotal = Math.round(grandTotalRaw);
        const roundOff = this.round2(grandTotal - grandTotalRaw);
        const currentPaidAmount = this.round2(Number(existing.paidAmount ?? 0));
        const paymentState = this.buildPaymentState(
          grandTotal,
          currentPaidAmount,
          existing.status,
        );

        await tx.invoice.update({
          where: { id },
          data: {
            invoiceNumber: normalizedInvoiceNumber,
            accountId: dto.accountId,
            brokerId: dto.brokerId,
            invoiceDate: dto.invoiceDate
              ? new Date(dto.invoiceDate)
              : undefined,
            coChallanNo: dto.coChallanNo,
            partyChallanNo: dto.partyChallanNo,
            hsnCodeHeader: dto.hsnCodeHeader,
            taxInclusiveRate: dto.taxInclusiveRate,
            narration: dto.narration,
            termsAndConditions: dto.termsAndConditions,
            placeOfSupply: dto.placeOfSupply,
            subtotal: this.d(subtotal),
            totalDiscount: this.d(totalDiscount),
            taxableAmount: this.d(taxableAmount),
            totalCgst: this.d(this.round2(totalCgst)),
            totalSgst: this.d(this.round2(totalSgst)),
            totalIgst: this.d(this.round2(totalIgst)),
            totalTax: this.d(this.round2(totalTax)),
            roundOff: this.d(roundOff),
            grandTotal: this.d(grandTotal),
            paidAmount: paymentState.paidAmount,
            receivedAmount: paymentState.receivedAmount,
            remainingAmount: paymentState.remainingAmount,
            paymentMode: dto.paymentMode,
            paymentBookName: dto.paymentBookName,
            paymentNarration: dto.paymentNarration,
            status: paymentState.status,
          },
        });

        // Recreate stock & ledger
        const config = await this.invoiceNumberService.getOrCreate(
          companyId,
          existing.invoiceType,
        );
        if (config.stockEffect && this.isPostedStatus(paymentState.status)) {
          const productIds = itemsData.map((i) => i.productId);
          const products = await tx.product.findMany({
            where: { id: { in: productIds } },
          });

          for (const p of products) {
            const updated = await tx.product.updateMany({
              where: { id: p.id, version: p.version },
              data: { version: { increment: 1 } },
            });
            if (updated.count === 0) {
              throw new ConflictException(
                `Concurrency error updating stock for ${p.name}. Please try again.`,
              );
            }
          }

          const movements = itemsData.map((it) => {
            const type = ['SALE', 'SALE_RETURN', 'JOB_OUT'].includes(
              existing.invoiceType,
            )
              ? 'OUT'
              : 'IN';
            return {
              companyId,
              productId: it.productId,
              invoiceId: id,
              type,
              quantity: it.quantity,
              rate: it.rate,
              date: dto.invoiceDate
                ? new Date(dto.invoiceDate)
                : existing.invoiceDate,
            };
          });
          await tx.stockMovement.createMany({ data: movements as any });
        }

        if (config.ledgerEffect && this.isPostedStatus(paymentState.status)) {
          const invType = existing.invoiceType;
          const isSaleType = ['SALE', 'PURCHASE_RETURN'].includes(invType);
          await tx.ledgerEntry.create({
            data: {
              companyId,
              accountId: dto.accountId ?? existing.accountId,
              invoiceId: id,
              voucherType: invType,
              voucherNumber: effectiveInvoiceNumber,
              date: dto.invoiceDate
                ? new Date(dto.invoiceDate)
                : existing.invoiceDate,
              debit: isSaleType ? this.d(grandTotal) : this.d(0),
              credit: isSaleType ? this.d(0) : this.d(grandTotal),
              narration: `${invType} ${effectiveInvoiceNumber}`,
            },
          });
        }
      } else {
        // No items change — just update header fields
        await tx.invoice.update({
          where: { id },
          data: {
            invoiceNumber: normalizedInvoiceNumber,
            accountId: dto.accountId,
            brokerId: dto.brokerId,
            invoiceDate: dto.invoiceDate
              ? new Date(dto.invoiceDate)
              : undefined,
            coChallanNo: dto.coChallanNo,
            partyChallanNo: dto.partyChallanNo,
            narration: dto.narration,
            termsAndConditions: dto.termsAndConditions,
            placeOfSupply: dto.placeOfSupply,
            paymentMode: dto.paymentMode,
          },
        });

        if (
          normalizedInvoiceNumber &&
          normalizedInvoiceNumber !== existing.invoiceNumber
        ) {
          await tx.ledgerEntry.updateMany({
            where: {
              invoiceId: id,
              voucherType: existing.invoiceType,
              voucherNumber: existing.invoiceNumber,
            },
            data: {
              voucherNumber: normalizedInvoiceNumber,
              narration: `${existing.invoiceType} ${normalizedInvoiceNumber}`,
            },
          });
        }
      }

        return id;
      }, {
        maxWait: 10000,
        timeout: 20000,
      })
      .then((updatedInvoiceId) => this.findById(companyId, updatedInvoiceId))
      .catch((error: unknown) => {
        if (this.isUniqueConstraintError(error)) {
          throw new ConflictException(
            'Invoice number already exists for this invoice type.',
          );
        }
        throw error;
      });
  }

  async remove(companyId: string, id: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, companyId },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    await this.prisma.$transaction(async (tx) => {
      const items = await tx.invoiceItem.findMany({ where: { invoiceId: id } });
      if (items.length > 0) {
        const productIds = items.map((i) => i.productId);
        const products = await tx.product.findMany({
          where: { id: { in: productIds } },
        });

        for (const p of products) {
          const updated = await tx.product.updateMany({
            where: { id: p.id, version: p.version },
            data: { version: { increment: 1 } },
          });
          if (updated.count === 0) {
            throw new ConflictException(
              `Concurrency error updating stock for ${p.name}. Please try again.`,
            );
          }
        }
      }

      await tx.stockMovement.deleteMany({ where: { invoiceId: id } });
      await tx.ledgerEntry.deleteMany({ where: { invoiceId: id } });
      await tx.invoicePayment.deleteMany({ where: { invoiceId: id } });
      await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
      await tx.invoice.delete({ where: { id } });
    });

    return { deleted: true };
  }

  // ─── DASHBOARD SUMMARY ─────────────────────────

  async getSummary(companyId: string, financialYearId?: string) {
    const baseWhere: Prisma.InvoiceWhereInput = {
      companyId,
      status: { in: ['ACTIVE', 'PARTIALLY_PAID', 'PAID'] },
    };
    if (financialYearId) baseWhere.financialYearId = financialYearId;

    const [sales, purchases, saleReturns, purchaseReturns] = await Promise.all([
      this.prisma.invoice.aggregate({
        where: { ...baseWhere, invoiceType: 'SALE' },
        _sum: { grandTotal: true },
        _count: true,
      }),
      this.prisma.invoice.aggregate({
        where: { ...baseWhere, invoiceType: 'PURCHASE' },
        _sum: { grandTotal: true },
        _count: true,
      }),
      this.prisma.invoice.aggregate({
        where: { ...baseWhere, invoiceType: 'SALE_RETURN' },
        _sum: { grandTotal: true },
        _count: true,
      }),
      this.prisma.invoice.aggregate({
        where: { ...baseWhere, invoiceType: 'PURCHASE_RETURN' },
        _sum: { grandTotal: true },
        _count: true,
      }),
    ]);

    return {
      totalSales: Number(sales._sum.grandTotal ?? 0),
      salesCount: sales._count,
      totalPurchases: Number(purchases._sum.grandTotal ?? 0),
      purchasesCount: purchases._count,
      totalSaleReturns: Number(saleReturns._sum.grandTotal ?? 0),
      saleReturnsCount: saleReturns._count,
      totalPurchaseReturns: Number(purchaseReturns._sum.grandTotal ?? 0),
      purchaseReturnsCount: purchaseReturns._count,
      netSales:
        Number(sales._sum.grandTotal ?? 0) -
        Number(saleReturns._sum.grandTotal ?? 0),
      netPurchases:
        Number(purchases._sum.grandTotal ?? 0) -
        Number(purchaseReturns._sum.grandTotal ?? 0),
    };
  }

  async getCompany(companyId: string) {
    return this.prisma.company.findUnique({ where: { id: companyId } });
  }

  // ─── PAYMENT RECORDING ─────────────────────────

  async recordPayment(
    companyId: string,
    invoiceId: string,
    dto: {
      paymentDate: string;
      amount: number;
      paymentMode: string;
      bookName?: string;
      chequeNumber?: string;
      narration?: string;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Lock invoice row to serialize concurrent payment writers on the same invoice.
      const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM "Invoice"
        WHERE id = ${invoiceId} AND "companyId" = ${companyId}
        FOR UPDATE
      `;

      if (!lockedRows.length) {
        throw new NotFoundException('Invoice not found');
      }

      const invoice = await tx.invoice.findFirst({
        where: { id: invoiceId, companyId },
        select: {
          id: true,
          accountId: true,
          invoiceType: true,
          invoiceNumber: true,
          grandTotal: true,
          status: true,
        },
      });

      if (!invoice) throw new NotFoundException('Invoice not found');
      if (invoice.status === 'CANCELLED')
        throw new BadRequestException('Cannot pay cancelled invoice');
      if (invoice.status === 'DRAFT')
        throw new BadRequestException('Cannot pay a draft invoice');

      const paidAggregate = await tx.invoicePayment.aggregate({
        where: { invoiceId },
        _sum: { amount: true },
      });
      const totalPaid = this.round2(Number(paidAggregate._sum.amount ?? 0));
      const remaining = this.round2(Number(invoice.grandTotal) - totalPaid);
      if (dto.amount > remaining + 0.01) {
        throw new BadRequestException(
          `Payment exceeds balance. Remaining: ${remaining.toFixed(2)}`,
        );
      }

      const payment = await tx.invoicePayment.create({
        data: {
          invoiceId,
          paymentDate: new Date(dto.paymentDate),
          amount: this.d(dto.amount),
          paymentMode: dto.paymentMode,
          bookName: dto.bookName,
          chequeNumber: dto.chequeNumber,
          narration: dto.narration,
        },
      });

      // Update paid amount on invoice
      const newPaid = this.round2(totalPaid + dto.amount);
      const paymentState = this.buildPaymentState(
        Number(invoice.grandTotal),
        newPaid,
      );
      await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          paidAmount: paymentState.paidAmount,
          receivedAmount: paymentState.receivedAmount,
          remainingAmount: paymentState.remainingAmount,
          paymentMode: dto.paymentMode,
          paymentBookName: dto.bookName,
          paymentNarration: dto.narration,
          status: paymentState.status,
        },
      });

      // Create ledger entry for payment
      if (invoice.accountId) {
        const paymentLedger = this.getPaymentLedgerData(
          invoice.invoiceType,
          dto.amount,
        );
        await tx.ledgerEntry.create({
          data: {
            companyId,
            accountId: invoice.accountId,
            invoiceId,
            voucherType: paymentLedger.voucherType,
            voucherNumber: payment.id,
            date: new Date(dto.paymentDate),
            debit: paymentLedger.debit,
            credit: paymentLedger.credit,
            narration: dto.narration || `Payment for ${invoice.invoiceNumber}`,
          },
        });
      }

      return payment;
    });
  }

  async getPayments(companyId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, companyId },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return this.prisma.invoicePayment.findMany({
      where: { invoiceId },
      orderBy: { paymentDate: 'desc' },
    });
  }

  async deletePayment(companyId: string, invoiceId: string, paymentId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, companyId },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === 'CANCELLED') {
      throw new BadRequestException(
        'Cannot delete payments from a cancelled invoice',
      );
    }
    if (invoice.status === 'DRAFT') {
      throw new BadRequestException(
        'Draft invoices do not have posted payments',
      );
    }

    const payment = await this.prisma.invoicePayment.findFirst({
      where: { id: paymentId, invoiceId },
    });
    if (!payment) throw new NotFoundException('Payment not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.invoicePayment.delete({ where: { id: paymentId } });
      const remaining = await tx.invoicePayment.aggregate({
        where: { invoiceId },
        _sum: { amount: true },
      });
      const latestPayment = await tx.invoicePayment.findFirst({
        where: { invoiceId },
        orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }],
      });
      const paymentState = this.buildPaymentState(
        Number(invoice.grandTotal),
        Number(remaining._sum.amount ?? 0),
      );

      await tx.ledgerEntry.deleteMany({
        where: {
          invoiceId,
          voucherNumber: paymentId,
          voucherType: { in: ['RECEIPT', 'PAYMENT'] },
        },
      });

      await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          paidAmount: paymentState.paidAmount,
          receivedAmount: paymentState.receivedAmount,
          remainingAmount: paymentState.remainingAmount,
          paymentMode: latestPayment?.paymentMode ?? null,
          paymentBookName: latestPayment?.bookName ?? null,
          paymentNarration: latestPayment?.narration ?? null,
          status: paymentState.status,
        },
      });
    });

    return { deleted: true };
  }

  // ─── INVOICE CONVERSION ────────────────────────

  async convertInvoice(
    companyId: string,
    id: string,
    targetType: InvoiceType,
    userId: string,
  ) {
    const source = await this.prisma.invoice.findFirst({
      where: { id, companyId },
      include: { items: true },
    });
    if (!source) throw new NotFoundException('Invoice not found');

    // Validate conversion paths
    const validConversions: Record<string, string[]> = {
      QUOTATION: ['SALE'],
      SALE: ['SALE_RETURN'],
      PURCHASE: ['PURCHASE_RETURN'],
      DELIVERY_NOTE: ['SALE'],
    };
    const allowed = validConversions[source.invoiceType] || [];
    if (!allowed.includes(targetType)) {
      throw new BadRequestException(
        `Cannot convert ${source.invoiceType} to ${targetType}`,
      );
    }

    // Create a new invoice DTO from source
    const dto: CreateInvoiceDto = {
      invoiceType: targetType as unknown as any,
      accountId: source.accountId ?? undefined,
      invoiceDate: source.invoiceDate.toISOString().split('T')[0],
      placeOfSupply: source.placeOfSupply ?? undefined,
      taxInclusiveRate: source.taxInclusiveRate,
      narration: `Converted from ${source.invoiceNumber}`,
      convertedFromId: source.id,
      items: source.items.map((item) => ({
        productId: item.productId,
        quantity: Number(item.quantity),
        rate: Number(item.rate),
        gstRate: Number(item.gstRate),
        discountPercent: Number(item.discountPercent),
      })),
    };

    const fyId = source.financialYearId;
    return this.create(companyId, fyId, userId, dto);
  }
}
