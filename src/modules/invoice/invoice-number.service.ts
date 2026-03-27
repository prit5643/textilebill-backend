import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceType } from '@prisma/client';
import {
  CreateInvoiceNumberConfigDto,
  UpdateInvoiceNumberConfigDto,
} from './dto';

@Injectable()
export class InvoiceNumberService {
  constructor(private prisma: PrismaService) {}

  /**
   * Get or create the InvoiceNumberConfig for a given company + type.
   * Returns current config (creates default if missing).
   */
  async getOrCreate(companyId: string, invoiceType: InvoiceType) {
    let config = await this.prisma.invoiceNumberConfig.findUnique({
      where: {
        companyId_invoiceType: { companyId, invoiceType },
      },
    });

    if (!config) {
      const prefixMap: Record<string, string> = {
        SALE: 'INV',
        PURCHASE: 'PUR',
        QUOTATION: 'QTN',
        CHALLAN: 'CH',
        PROFORMA: 'PI',
        SALE_RETURN: 'SR',
        PURCHASE_RETURN: 'PR',
        JOB_IN: 'JI',
        JOB_OUT: 'JO',
      };

      config = await this.prisma.invoiceNumberConfig.create({
        data: {
          companyId,
          invoiceType,
          prefix: prefixMap[invoiceType] || invoiceType.substring(0, 3),
          startingNumber: 1,
          currentNumber: 0,
          isAutoNumber: true,
          stockEffect: [
            'SALE',
            'PURCHASE',
            'SALE_RETURN',
            'PURCHASE_RETURN',
          ].includes(invoiceType),
          ledgerEffect: !['QUOTATION', 'PROFORMA', 'CHALLAN'].includes(
            invoiceType,
          ),
        },
      });
    }

    return config;
  }

  /**
   * Generate and return the next invoice number, atomically incrementing the counter.
   * Uses default prisma client.
   */
  async getNextNumber(
    companyId: string,
    invoiceType: InvoiceType,
  ): Promise<string> {
    return this.getNextNumberWithTx(companyId, invoiceType, this.prisma);
  }

  /**
   * Generate and return the next invoice number within a transaction.
   * Accepts either a Prisma transaction client or the default prisma instance.
   * Must be called within a transaction context for atomicity.
   */
  async getNextNumberWithTx(
    companyId: string,
    invoiceType: InvoiceType,
    tx: any, // PrismaClient or Prisma.TransactionClient
  ): Promise<string> {
    // First, check if config exists using the tx client
    let config = await tx.invoiceNumberConfig.findUnique({
      where: {
        companyId_invoiceType: { companyId, invoiceType },
      },
    });

    if (!config) {
      const prefixMap: Record<string, string> = {
        SALE: 'INV',
        PURCHASE: 'PUR',
        QUOTATION: 'QTN',
        CHALLAN: 'CH',
        PROFORMA: 'PI',
        SALE_RETURN: 'SR',
        PURCHASE_RETURN: 'PR',
        JOB_IN: 'JI',
        JOB_OUT: 'JO',
      };

      config = await tx.invoiceNumberConfig.create({
        data: {
          companyId,
          invoiceType,
          prefix: prefixMap[invoiceType] || invoiceType.substring(0, 3),
          startingNumber: 1,
          currentNumber: 0,
          isAutoNumber: true,
          stockEffect: [
            'SALE',
            'PURCHASE',
            'SALE_RETURN',
            'PURCHASE_RETURN',
          ].includes(invoiceType),
          ledgerEffect: !['QUOTATION', 'PROFORMA', 'CHALLAN'].includes(
            invoiceType,
          ),
        },
      });
    }

    if (!config.isAutoNumber) {
      return ''; // manual numbering — caller must supply number
    }

    const updated = await tx.invoiceNumberConfig.update({
      where: { id: config.id },
      data: { currentNumber: { increment: 1 } },
    });

    const nextNum = updated.currentNumber || config.startingNumber;
    const parts: string[] = [];
    if (config.prefix) parts.push(config.prefix);
    parts.push(String(nextNum));
    if (config.suffix) parts.push(config.suffix);

    return parts.join('-');
  }

  /**
   * List all configs for a company.
   */
  async findAll(companyId: string) {
    return this.prisma.invoiceNumberConfig.findMany({
      where: { companyId },
      orderBy: { invoiceType: 'asc' },
    });
  }

  /**
   * Create a new config.
   */
  async create(companyId: string, dto: CreateInvoiceNumberConfigDto) {
    return this.prisma.invoiceNumberConfig.create({
      data: {
        companyId,
        invoiceType: dto.invoiceType as InvoiceType,
        prefix: dto.prefix,
        suffix: dto.suffix,
        startingNumber: dto.startingNumber ?? 1,
        currentNumber: 0,
        isAutoNumber: dto.isAutoNumber ?? true,
        gstType: dto.gstType,
        stockEffect: dto.stockEffect ?? true,
        ledgerEffect: dto.ledgerEffect ?? true,
      },
    });
  }

  /**
   * Update an existing config by id.
   */
  async update(
    companyId: string,
    id: string,
    dto: UpdateInvoiceNumberConfigDto,
  ) {
    const config = await this.prisma.invoiceNumberConfig.findFirst({
      where: { id, companyId },
    });
    if (!config) throw new NotFoundException('Invoice number config not found');

    return this.prisma.invoiceNumberConfig.update({
      where: { id },
      data: {
        prefix: dto.prefix,
        suffix: dto.suffix,
        startingNumber: dto.startingNumber,
        isAutoNumber: dto.isAutoNumber,
        gstType: dto.gstType,
        stockEffect: dto.stockEffect,
        ledgerEffect: dto.ledgerEffect,
      },
    });
  }
}
