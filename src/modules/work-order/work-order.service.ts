import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InvoiceType,
  Prisma,
  WorkOrderAdjustmentStatus,
  WorkOrderAdjustmentType,
  WorkOrderAutoAdjustMode,
  WorkOrderInvoiceLinkType,
  WorkOrderLossChargeTo,
  WorkOrderLossIncidentStatus,
  WorkOrderLotStatus,
  WorkOrderLotType,
  WorkOrderStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  createPaginatedResult,
  parsePagination,
} from '../../common/utils/pagination.util';
import {
  CloseWorkOrderDto,
  CreateLossIncidentDto,
  CreateWorkOrderDto,
  LinkInvoiceDto,
  SplitWorkOrderDto,
  WorkOrderLotStatusEnum,
  WorkOrderLotTypeEnum,
} from './dto';

const WORK_ORDER_ACCOUNT_SELECT = {
  id: true,
  party: { select: { name: true } },
} satisfies Prisma.AccountSelect;

const WORK_ORDER_LOT_SELECT = {
  id: true,
  lotType: true,
  status: true,
  quantity: true,
  acceptedQuantity: true,
  rejectedQuantity: true,
  agreedRate: true,
  notes: true,
  vendorAccount: { select: WORK_ORDER_ACCOUNT_SELECT },
} satisfies Prisma.WorkOrderLotSelect;

const WORK_ORDER_INVOICE_LINK_SELECT = {
  id: true,
  linkType: true,
  workOrderLotId: true,
  invoice: {
    select: {
      id: true,
      invoiceNumber: true,
      type: true,
      totalAmount: true,
      status: true,
      account: { select: WORK_ORDER_ACCOUNT_SELECT },
    },
  },
} satisfies Prisma.WorkOrderInvoiceLinkSelect;

const WORK_ORDER_LOSS_INCIDENT_SELECT = {
  id: true,
  workOrderLotId: true,
  amount: true,
  reasonCode: true,
  reasonNote: true,
  chargeTo: true,
  status: true,
  occurredAt: true,
  createdAt: true,
  adjustment: {
    select: {
      id: true,
      mode: true,
      adjustmentType: true,
      status: true,
      postedAt: true,
      reversedAt: true,
      failureReason: true,
    },
  },
} satisfies Prisma.WorkOrderLossIncidentSelect;

@Injectable()
export class WorkOrderService {
  constructor(private readonly prisma: PrismaService) {}

  private round2(value: number) {
    return Math.round(value * 100) / 100;
  }

  private round3(value: number) {
    return Math.round(value * 1000) / 1000;
  }

  private toNumber(value: unknown) {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private async getCompanyContext(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, tenantId: true, deletedAt: true },
    });
    if (!company || company.deletedAt) {
      throw new NotFoundException('Company not found');
    }
    return company;
  }

  private async ensureAccountBelongsToCompany(
    companyId: string,
    accountId: string,
  ) {
    const account = await this.prisma.account.findFirst({
      where: { id: accountId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!account) {
      throw new BadRequestException('Account not found for this company');
    }
  }

  private async ensureInvoiceBelongsToCompany(
    companyId: string,
    invoiceId: string,
  ) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, companyId, deletedAt: null },
      select: { id: true, type: true },
    });
    if (!invoice) {
      throw new BadRequestException('Invoice not found for this company');
    }
    return invoice;
  }

  private async getWorkOrderOrThrow(companyId: string, id: string) {
    const workOrder = await this.prisma.workOrder.findFirst({
      where: { id, companyId, deletedAt: null },
      select: { id: true, orderedQuantity: true, status: true, tenantId: true },
    });
    if (!workOrder) {
      throw new NotFoundException('Work order not found');
    }
    return workOrder;
  }

  private normalizeLotType(value: WorkOrderLotTypeEnum) {
    return value === WorkOrderLotTypeEnum.OUTSOURCED
      ? WorkOrderLotType.OUTSOURCED
      : WorkOrderLotType.IN_HOUSE;
  }

  private normalizeLotStatus(value?: WorkOrderLotStatusEnum) {
    if (!value) return WorkOrderLotStatus.OPEN;
    return value === WorkOrderLotStatusEnum.CLOSED
      ? WorkOrderLotStatus.CLOSED
      : WorkOrderLotStatus.OPEN;
  }

  private buildProfitabilitySummary(
    saleTotal: number,
    purchaseTotal: number,
    customerReductions: number,
    vendorReductions: number,
    directLoss: number,
  ) {
    const netRevenue = saleTotal - customerReductions;
    const netOutsourceCost = purchaseTotal - vendorReductions;
    const contribution = netRevenue - netOutsourceCost - directLoss;
    const marginPercent =
      netRevenue > 0 ? (contribution / netRevenue) * 100 : 0;

    return {
      netRevenue: this.round2(netRevenue),
      netOutsourceCost: this.round2(netOutsourceCost),
      directLoss: this.round2(directLoss),
      contribution: this.round2(contribution),
      marginPercent: this.round2(marginPercent),
    };
  }

  private async buildProfitabilityMap(
    companyId: string,
    workOrderIds: string[],
  ) {
    if (workOrderIds.length === 0) {
      return new Map<
        string,
        ReturnType<typeof this.buildProfitabilitySummary>
      >();
    }

    const [links, lossRows] = await Promise.all([
      this.prisma.workOrderInvoiceLink.findMany({
        where: { companyId, workOrderId: { in: workOrderIds } },
        select: {
          workOrderId: true,
          linkType: true,
          invoice: { select: { totalAmount: true } },
        },
      }),
      this.prisma.workOrderLossIncident.findMany({
        where: {
          companyId,
          workOrderId: { in: workOrderIds },
          status: WorkOrderLossIncidentStatus.POSTED,
        },
        select: { workOrderId: true, chargeTo: true, amount: true },
      }),
    ]);

    const saleTotals = new Map<string, number>();
    const purchaseTotals = new Map<string, number>();
    for (const link of links) {
      const total = this.toNumber(link.invoice.totalAmount);
      if (link.linkType === WorkOrderInvoiceLinkType.SALE) {
        saleTotals.set(
          link.workOrderId,
          (saleTotals.get(link.workOrderId) ?? 0) + total,
        );
      } else if (link.linkType === WorkOrderInvoiceLinkType.PURCHASE) {
        purchaseTotals.set(
          link.workOrderId,
          (purchaseTotals.get(link.workOrderId) ?? 0) + total,
        );
      }
    }

    const customerReductions = new Map<string, number>();
    const vendorReductions = new Map<string, number>();
    const directLosses = new Map<string, number>();
    for (const loss of lossRows) {
      const amount = this.toNumber(loss.amount);
      if (loss.chargeTo === WorkOrderLossChargeTo.CUSTOMER) {
        customerReductions.set(
          loss.workOrderId,
          (customerReductions.get(loss.workOrderId) ?? 0) + amount,
        );
      } else if (loss.chargeTo === WorkOrderLossChargeTo.VENDOR) {
        vendorReductions.set(
          loss.workOrderId,
          (vendorReductions.get(loss.workOrderId) ?? 0) + amount,
        );
      } else {
        directLosses.set(
          loss.workOrderId,
          (directLosses.get(loss.workOrderId) ?? 0) + amount,
        );
      }
    }

    const result = new Map<
      string,
      ReturnType<typeof this.buildProfitabilitySummary>
    >();
    for (const workOrderId of workOrderIds) {
      result.set(
        workOrderId,
        this.buildProfitabilitySummary(
          saleTotals.get(workOrderId) ?? 0,
          purchaseTotals.get(workOrderId) ?? 0,
          customerReductions.get(workOrderId) ?? 0,
          vendorReductions.get(workOrderId) ?? 0,
          directLosses.get(workOrderId) ?? 0,
        ),
      );
    }

    return result;
  }

  async create(companyId: string, userId: string, dto: CreateWorkOrderDto) {
    const company = await this.getCompanyContext(companyId);
    const orderRef = dto.orderRef.trim();

    const existing = await this.prisma.workOrder.findFirst({
      where: { companyId, orderRef, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        'Order reference already exists for this company',
      );
    }

    await this.ensureAccountBelongsToCompany(companyId, dto.customerAccountId);

    const created = await this.prisma.workOrder.create({
      data: {
        tenantId: company.tenantId,
        companyId,
        orderRef,
        customerAccountId: dto.customerAccountId,
        itemName: dto.itemName.trim(),
        orderedQuantity: dto.orderedQuantity,
        saleRate: dto.saleRate,
        expectedDeliveryDate: dto.expectedDeliveryDate
          ? new Date(dto.expectedDeliveryDate)
          : null,
        notes: dto.notes?.trim() || null,
        createdById: userId,
        updatedById: userId,
      },
    });

    return this.findById(companyId, created.id);
  }

  async list(
    companyId: string,
    query: {
      page?: number;
      limit?: number;
      search?: string;
      status?: string;
      fromDate?: string;
      toDate?: string;
    },
  ) {
    const { skip, take, page, limit } = parsePagination(query);
    const where: Prisma.WorkOrderWhereInput = {
      companyId,
      deletedAt: null,
    };

    if (query.status) {
      const normalized = query.status.toUpperCase() as WorkOrderStatus;
      if (Object.values(WorkOrderStatus).includes(normalized)) {
        where.status = normalized;
      }
    }

    if (query.search) {
      where.OR = [
        { orderRef: { contains: query.search, mode: 'insensitive' } },
        { itemName: { contains: query.search, mode: 'insensitive' } },
        {
          customerAccount: {
            party: { name: { contains: query.search, mode: 'insensitive' } },
          },
        },
      ];
    }

    if (query.fromDate || query.toDate) {
      where.createdAt = {
        ...(query.fromDate ? { gte: new Date(query.fromDate) } : {}),
        ...(query.toDate ? { lte: new Date(query.toDate) } : {}),
      };
    }

    const [rows, total] = await Promise.all([
      this.prisma.workOrder.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          customerAccount: { select: WORK_ORDER_ACCOUNT_SELECT },
          lots: { select: { lotType: true } },
        },
      }),
      this.prisma.workOrder.count({ where }),
    ]);

    const profitabilityMap = await this.buildProfitabilityMap(
      companyId,
      rows.map((row) => row.id),
    );

    const data = rows.map((row) => {
      const profitability =
        profitabilityMap.get(row.id) ??
        this.buildProfitabilitySummary(0, 0, 0, 0, 0);
      const lotCounts = row.lots.reduce(
        (acc, lot) => {
          acc.total += 1;
          if (lot.lotType === WorkOrderLotType.OUTSOURCED) {
            acc.outsourced += 1;
          } else {
            acc.inHouse += 1;
          }
          return acc;
        },
        { total: 0, outsourced: 0, inHouse: 0 },
      );

      return {
        id: row.id,
        orderRef: row.orderRef,
        itemName: row.itemName,
        orderedQuantity: this.round3(this.toNumber(row.orderedQuantity)),
        saleRate: this.round2(this.toNumber(row.saleRate)),
        expectedDeliveryDate: row.expectedDeliveryDate
          ? row.expectedDeliveryDate.toISOString().slice(0, 10)
          : null,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        customerAccount: {
          id: row.customerAccount.id,
          name: row.customerAccount.party.name,
        },
        lotsSummary: lotCounts,
        profitability,
      };
    });

    return createPaginatedResult(data, total, page, limit);
  }

  async findById(companyId: string, id: string) {
    const workOrder = await this.prisma.workOrder.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        customerAccount: { select: WORK_ORDER_ACCOUNT_SELECT },
        lots: { select: WORK_ORDER_LOT_SELECT, orderBy: { createdAt: 'asc' } },
        invoiceLinks: {
          select: WORK_ORDER_INVOICE_LINK_SELECT,
          orderBy: { createdAt: 'asc' },
        },
        lossIncidents: {
          select: WORK_ORDER_LOSS_INCIDENT_SELECT,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!workOrder) {
      throw new NotFoundException('Work order not found');
    }

    const profitabilityMap = await this.buildProfitabilityMap(companyId, [
      workOrder.id,
    ]);
    const profitability =
      profitabilityMap.get(workOrder.id) ??
      this.buildProfitabilitySummary(0, 0, 0, 0, 0);

    return {
      id: workOrder.id,
      orderRef: workOrder.orderRef,
      itemName: workOrder.itemName,
      orderedQuantity: this.round3(this.toNumber(workOrder.orderedQuantity)),
      saleRate: this.round2(this.toNumber(workOrder.saleRate)),
      expectedDeliveryDate: workOrder.expectedDeliveryDate
        ? workOrder.expectedDeliveryDate.toISOString().slice(0, 10)
        : null,
      status: workOrder.status,
      notes: workOrder.notes ?? null,
      splitOverrideReason: workOrder.splitOverrideReason ?? null,
      closeOverrideReason: workOrder.closeOverrideReason ?? null,
      createdAt: workOrder.createdAt.toISOString(),
      updatedAt: workOrder.updatedAt.toISOString(),
      customerAccount: {
        id: workOrder.customerAccount.id,
        name: workOrder.customerAccount.party.name,
      },
      lots: workOrder.lots.map((lot) => ({
        id: lot.id,
        lotType: lot.lotType,
        status: lot.status,
        quantity: this.round3(this.toNumber(lot.quantity)),
        acceptedQuantity: this.round3(this.toNumber(lot.acceptedQuantity)),
        rejectedQuantity: this.round3(this.toNumber(lot.rejectedQuantity)),
        agreedRate:
          lot.agreedRate == null
            ? null
            : this.round2(this.toNumber(lot.agreedRate)),
        notes: lot.notes ?? null,
        vendorAccount: lot.vendorAccount
          ? { id: lot.vendorAccount.id, name: lot.vendorAccount.party.name }
          : null,
      })),
      invoiceLinks: workOrder.invoiceLinks.map((link) => ({
        id: link.id,
        linkType: link.linkType,
        workOrderLotId: link.workOrderLotId ?? null,
        invoice: {
          id: link.invoice.id,
          invoiceNumber: link.invoice.invoiceNumber,
          type: link.invoice.type,
          status: link.invoice.status,
          totalAmount: this.round2(this.toNumber(link.invoice.totalAmount)),
          account: link.invoice.account
            ? {
                id: link.invoice.account.id,
                name: link.invoice.account.party.name,
              }
            : null,
        },
      })),
      lossIncidents: workOrder.lossIncidents.map((incident) => ({
        id: incident.id,
        workOrderLotId: incident.workOrderLotId ?? null,
        amount: this.round2(this.toNumber(incident.amount)),
        reasonCode: incident.reasonCode,
        reasonNote: incident.reasonNote,
        chargeTo: incident.chargeTo,
        status: incident.status,
        occurredAt: incident.occurredAt
          ? incident.occurredAt.toISOString().slice(0, 10)
          : null,
        createdAt: incident.createdAt.toISOString(),
        adjustment: incident.adjustment
          ? {
              id: incident.adjustment.id,
              mode: incident.adjustment.mode,
              adjustmentType: incident.adjustment.adjustmentType,
              status: incident.adjustment.status,
              postedAt: incident.adjustment.postedAt
                ? incident.adjustment.postedAt.toISOString()
                : null,
              reversedAt: incident.adjustment.reversedAt
                ? incident.adjustment.reversedAt.toISOString()
                : null,
              failureReason: incident.adjustment.failureReason ?? null,
            }
          : null,
      })),
      profitability,
    };
  }

  async splitWorkOrder(
    companyId: string,
    id: string,
    userId: string,
    dto: SplitWorkOrderDto,
  ) {
    const workOrder = await this.getWorkOrderOrThrow(companyId, id);

    if (!dto.lots || dto.lots.length === 0) {
      throw new BadRequestException('At least one lot is required');
    }

    const totalQty = dto.lots.reduce(
      (sum, lot) => sum + Number(lot.quantity || 0),
      0,
    );
    const orderedQty = this.toNumber(workOrder.orderedQuantity);
    const mismatch = Math.abs(totalQty - orderedQty) > 0.0005;

    if (mismatch && !dto.overrideReason) {
      throw new BadRequestException(
        'Override reason is required for quantity mismatch',
      );
    }

    const existingPurchaseLinks = await this.prisma.workOrderInvoiceLink.count({
      where: {
        companyId,
        workOrderId: id,
        linkType: WorkOrderInvoiceLinkType.PURCHASE,
      },
    });
    if (existingPurchaseLinks > 0) {
      throw new ConflictException(
        'Cannot split work order after purchase invoices are linked',
      );
    }

    for (const lot of dto.lots) {
      const lotType = this.normalizeLotType(lot.lotType);
      const accepted = lot.acceptedQuantity ?? 0;
      const rejected = lot.rejectedQuantity ?? 0;
      if (accepted + rejected > lot.quantity) {
        throw new BadRequestException(
          'Accepted and rejected quantities cannot exceed lot quantity',
        );
      }
      if (lotType === WorkOrderLotType.OUTSOURCED) {
        if (!lot.vendorAccountId) {
          throw new BadRequestException(
            'Outsourced lot requires a vendor account',
          );
        }
        if (lot.agreedRate === undefined || lot.agreedRate === null) {
          throw new BadRequestException(
            'Outsourced lot requires an agreed rate',
          );
        }
        await this.ensureAccountBelongsToCompany(
          companyId,
          lot.vendorAccountId,
        );
      }
    }

    const company = await this.getCompanyContext(companyId);

    await this.prisma.$transaction(async (tx) => {
      await tx.workOrderLot.deleteMany({ where: { workOrderId: id } });

      await tx.workOrderLot.createMany({
        data: dto.lots.map((lot) => ({
          tenantId: company.tenantId,
          companyId,
          workOrderId: id,
          lotType: this.normalizeLotType(lot.lotType),
          status: this.normalizeLotStatus(lot.status),
          quantity: lot.quantity,
          acceptedQuantity: lot.acceptedQuantity ?? 0,
          rejectedQuantity: lot.rejectedQuantity ?? 0,
          vendorAccountId: lot.vendorAccountId ?? null,
          agreedRate: lot.agreedRate ?? null,
          notes: lot.notes?.trim() || null,
        })),
      });

      await tx.workOrder.update({
        where: { id },
        data: {
          splitOverrideReason: mismatch
            ? dto.overrideReason?.trim() || null
            : null,
          splitOverrideAt: mismatch ? new Date() : null,
          splitOverrideById: mismatch ? userId : null,
          updatedById: userId,
        },
      });
    });

    return this.findById(companyId, id);
  }

  async linkSaleInvoice(
    companyId: string,
    id: string,
    userId: string,
    dto: LinkInvoiceDto,
  ) {
    await this.getWorkOrderOrThrow(companyId, id);
    const invoice = await this.ensureInvoiceBelongsToCompany(
      companyId,
      dto.invoiceId,
    );

    if (invoice.type !== InvoiceType.SALE) {
      throw new BadRequestException(
        'Sale invoice link requires a SALE invoice',
      );
    }

    const existingSaleLink = await this.prisma.workOrderInvoiceLink.findFirst({
      where: {
        companyId,
        workOrderId: id,
        linkType: WorkOrderInvoiceLinkType.SALE,
      },
      select: { id: true },
    });
    if (existingSaleLink) {
      throw new ConflictException(
        'Sale invoice already linked to this work order',
      );
    }

    const existingInvoiceLink =
      await this.prisma.workOrderInvoiceLink.findFirst({
        where: { companyId, invoiceId: dto.invoiceId },
        select: { id: true },
      });
    if (existingInvoiceLink) {
      throw new ConflictException(
        'Invoice is already linked to another work order',
      );
    }

    await this.prisma.workOrderInvoiceLink.create({
      data: {
        tenantId: (await this.getCompanyContext(companyId)).tenantId,
        companyId,
        workOrderId: id,
        invoiceId: dto.invoiceId,
        linkType: WorkOrderInvoiceLinkType.SALE,
        createdById: userId,
      },
    });

    return this.findById(companyId, id);
  }

  async linkPurchaseInvoice(
    companyId: string,
    lotId: string,
    userId: string,
    dto: LinkInvoiceDto,
  ) {
    const lot = await this.prisma.workOrderLot.findFirst({
      where: { id: lotId, companyId },
      select: { id: true, workOrderId: true, lotType: true },
    });
    if (!lot) {
      throw new NotFoundException('Work order lot not found');
    }
    if (lot.lotType !== WorkOrderLotType.OUTSOURCED) {
      throw new BadRequestException(
        'Purchase invoice link is only allowed for outsourced lots',
      );
    }

    const invoice = await this.ensureInvoiceBelongsToCompany(
      companyId,
      dto.invoiceId,
    );
    if (invoice.type !== InvoiceType.PURCHASE) {
      throw new BadRequestException(
        'Purchase invoice link requires a PURCHASE invoice',
      );
    }

    const existingLotLink = await this.prisma.workOrderInvoiceLink.findFirst({
      where: { companyId, workOrderLotId: lotId },
      select: { id: true },
    });
    if (existingLotLink) {
      throw new ConflictException(
        'Purchase invoice already linked to this lot',
      );
    }

    const existingInvoiceLink =
      await this.prisma.workOrderInvoiceLink.findFirst({
        where: { companyId, invoiceId: dto.invoiceId },
        select: { id: true },
      });
    if (existingInvoiceLink) {
      throw new ConflictException(
        'Invoice is already linked to another work order',
      );
    }

    await this.prisma.workOrderInvoiceLink.create({
      data: {
        tenantId: (await this.getCompanyContext(companyId)).tenantId,
        companyId,
        workOrderId: lot.workOrderId,
        workOrderLotId: lotId,
        invoiceId: dto.invoiceId,
        linkType: WorkOrderInvoiceLinkType.PURCHASE,
        createdById: userId,
      },
    });

    return this.findById(companyId, lot.workOrderId);
  }

  async createLossIncident(
    companyId: string,
    workOrderId: string,
    userId: string,
    dto: CreateLossIncidentDto,
  ) {
    await this.getWorkOrderOrThrow(companyId, workOrderId);

    if (dto.workOrderLotId) {
      const lot = await this.prisma.workOrderLot.findFirst({
        where: { id: dto.workOrderLotId, workOrderId, companyId },
        select: { id: true },
      });
      if (!lot) {
        throw new BadRequestException('Invalid lot for this work order');
      }
    }

    const company = await this.getCompanyContext(companyId);

    const incident = await this.prisma.workOrderLossIncident.create({
      data: {
        tenantId: company.tenantId,
        companyId,
        workOrderId,
        workOrderLotId: dto.workOrderLotId ?? null,
        amount: dto.amount,
        reasonCode: dto.reasonCode as any,
        reasonNote: dto.reasonNote.trim(),
        chargeTo: dto.chargeTo as any,
        status: WorkOrderLossIncidentStatus.POSTED,
        occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : null,
        createdById: userId,
      },
    });

    await this.prisma.workOrderAutoAdjustment.create({
      data: {
        tenantId: company.tenantId,
        companyId,
        workOrderId,
        lossIncidentId: incident.id,
        mode: WorkOrderAutoAdjustMode.LOSS_EXPENSE_NOTE,
        adjustmentType: WorkOrderAdjustmentType.LOSS_EXPENSE_NOTE,
        status: WorkOrderAdjustmentStatus.POSTED,
        amount: dto.amount,
        postedAt: new Date(),
        createdById: userId,
      },
    });

    return this.listLossIncidents(companyId, workOrderId);
  }

  async listLossIncidents(companyId: string, workOrderId: string) {
    await this.getWorkOrderOrThrow(companyId, workOrderId);
    const incidents = await this.prisma.workOrderLossIncident.findMany({
      where: { companyId, workOrderId },
      select: WORK_ORDER_LOSS_INCIDENT_SELECT,
      orderBy: { createdAt: 'desc' },
    });

    return incidents.map((incident) => ({
      id: incident.id,
      workOrderLotId: incident.workOrderLotId ?? null,
      amount: this.round2(this.toNumber(incident.amount)),
      reasonCode: incident.reasonCode,
      reasonNote: incident.reasonNote,
      chargeTo: incident.chargeTo,
      status: incident.status,
      occurredAt: incident.occurredAt
        ? incident.occurredAt.toISOString().slice(0, 10)
        : null,
      createdAt: incident.createdAt.toISOString(),
      adjustment: incident.adjustment
        ? {
            id: incident.adjustment.id,
            mode: incident.adjustment.mode,
            adjustmentType: incident.adjustment.adjustmentType,
            status: incident.adjustment.status,
            postedAt: incident.adjustment.postedAt
              ? incident.adjustment.postedAt.toISOString()
              : null,
            reversedAt: incident.adjustment.reversedAt
              ? incident.adjustment.reversedAt.toISOString()
              : null,
            failureReason: incident.adjustment.failureReason ?? null,
          }
        : null,
    }));
  }

  async retryLossAdjustment(
    companyId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    userId: string,
  ) {
    const incident = await this.prisma.workOrderLossIncident.findFirst({
      where: { id: incidentId, companyId },
      include: { adjustment: true },
    });
    if (!incident) {
      throw new NotFoundException('Loss incident not found');
    }

    if (incident.status !== WorkOrderLossIncidentStatus.FAILED) {
      throw new BadRequestException('Only failed adjustments can be retried');
    }

    if (!incident.adjustment) {
      throw new NotFoundException('Adjustment record not found');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.workOrderAutoAdjustment.update({
        where: { id: incident.adjustment!.id },
        data: {
          status: WorkOrderAdjustmentStatus.POSTED,
          attempts: { increment: 1 },
          lastAttemptAt: new Date(),
          postedAt: new Date(),
          failureReason: null,
        },
      });

      await tx.workOrderLossIncident.update({
        where: { id: incident.id },
        data: { status: WorkOrderLossIncidentStatus.POSTED },
      });
    });

    return this.listLossIncidents(companyId, incident.workOrderId);
  }

  async reverseLossIncident(
    companyId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    userId: string,
  ) {
    const incident = await this.prisma.workOrderLossIncident.findFirst({
      where: { id: incidentId, companyId },
      include: { adjustment: true },
    });
    if (!incident) {
      throw new NotFoundException('Loss incident not found');
    }

    if (incident.status !== WorkOrderLossIncidentStatus.POSTED) {
      throw new BadRequestException('Only posted adjustments can be reversed');
    }

    if (!incident.adjustment) {
      throw new NotFoundException('Adjustment record not found');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.workOrderAutoAdjustment.update({
        where: { id: incident.adjustment!.id },
        data: {
          status: WorkOrderAdjustmentStatus.REVERSED,
          reversedAt: new Date(),
        },
      });

      await tx.workOrderLossIncident.update({
        where: { id: incident.id },
        data: { status: WorkOrderLossIncidentStatus.REVERSED },
      });
    });

    return this.listLossIncidents(companyId, incident.workOrderId);
  }

  async closeWorkOrder(
    companyId: string,
    id: string,
    userId: string,
    dto: CloseWorkOrderDto,
  ) {
    const workOrder = await this.getWorkOrderOrThrow(companyId, id);
    if (workOrder.status === WorkOrderStatus.CLOSED) {
      throw new BadRequestException('Work order is already closed');
    }

    const openLots = await this.prisma.workOrderLot.count({
      where: { workOrderId: id, status: { not: WorkOrderLotStatus.CLOSED } },
    });

    if (openLots > 0 && !dto.overrideReason) {
      throw new BadRequestException(
        'Override reason is required to close with open lots',
      );
    }

    await this.prisma.workOrder.update({
      where: { id },
      data: {
        status: WorkOrderStatus.CLOSED,
        closedAt: new Date(),
        closedById: userId,
        closeOverrideReason: dto.overrideReason?.trim() || null,
        updatedById: userId,
      },
    });

    return this.findById(companyId, id);
  }

  async getWorkOrderProfitability(companyId: string, id: string) {
    await this.getWorkOrderOrThrow(companyId, id);
    const map = await this.buildProfitabilityMap(companyId, [id]);
    return map.get(id) ?? this.buildProfitabilitySummary(0, 0, 0, 0, 0);
  }
}
