import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InvoiceStatus,
  InvoiceType,
  Prisma,
  WorkOrderAdjustmentStatus,
  WorkOrderAdjustmentType,
  WorkOrderAutoAdjustMode,
  WorkOrderInvoiceLinkType,
  WorkOrderLotStatus,
  WorkOrderLotType,
  WorkOrderLossChargeTo,
  WorkOrderLossIncidentStatus,
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
  ListWorkOrdersDto,
  SplitWorkOrderDto,
  WorkOrderReportQueryDto,
} from './dto';

type ProfitabilitySnapshot = {
  saleInvoiceAmount: number;
  customerReductions: number;
  netRevenue: number;
  purchaseInvoiceAmount: number;
  vendorReductions: number;
  netOutsourceCost: number;
  directLoss: number;
  contribution: number;
  contributionPerUnit: number;
};

type AdjustmentResolution = {
  adjustmentType: WorkOrderAdjustmentType;
  autoAdjustMode: WorkOrderAutoAdjustMode;
  referenceInvoiceId: string | null;
};

@Injectable()
export class WorkOrderService {
  constructor(private readonly prisma: PrismaService) {}

  async create(companyId: string, userId: string, dto: CreateWorkOrderDto) {
    const company = await this.getCompanyContext(companyId);
    await this.ensureAccountBelongsToCompany(companyId, dto.customerAccountId);

    let createdId: string | null = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        createdId = await this.prisma.$transaction(async (tx) => {
          const orderRef = await this.generateOrderRef(tx, companyId);
          const created = await tx.workOrder.create({
            data: {
              tenantId: company.tenantId,
              companyId: company.id,
              customerAccountId: dto.customerAccountId,
              orderRef,
              itemName: dto.itemName.trim(),
              orderedQty: dto.orderedQty,
              saleRate: dto.saleRate,
              expectedDeliveryDate: dto.expectedDeliveryDate
                ? new Date(dto.expectedDeliveryDate)
                : null,
              status: WorkOrderStatus.DRAFT,
              notes: dto.notes?.trim() || null,
              createdBy: userId,
              updatedBy: userId,
            },
            select: { id: true },
          });
          return created.id;
        });
        break;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          continue;
        }
        throw error;
      }
    }

    if (!createdId) {
      throw new ConflictException(
        'Unable to generate a unique work order reference. Please retry.',
      );
    }

    return this.findById(companyId, createdId);
  }

  async findAll(companyId: string, query: ListWorkOrdersDto) {
    const { skip, take, page, limit } = parsePagination({
      page: query.page,
      limit: query.limit,
    });

    const where: Prisma.WorkOrderWhereInput = {
      companyId,
      deletedAt: null,
    };

    if (query.status) {
      where.status = query.status as WorkOrderStatus;
    }

    if (query.search) {
      where.OR = [
        { orderRef: { contains: query.search, mode: 'insensitive' } },
        { itemName: { contains: query.search, mode: 'insensitive' } },
        {
          customerAccount: {
            party: {
              name: { contains: query.search, mode: 'insensitive' },
            },
          },
        },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.workOrder.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          customerAccount: {
            select: {
              id: true,
              party: { select: { name: true } },
            },
          },
          lots: {
            where: { deletedAt: null },
            select: {
              plannedQty: true,
              acceptedQty: true,
              rejectedQty: true,
            },
          },
          invoiceLinks: {
            include: {
              invoice: {
                select: { type: true, totalAmount: true },
              },
            },
          },
          adjustments: {
            where: {
              deletedAt: null,
              status: WorkOrderAdjustmentStatus.POSTED,
            },
            select: {
              adjustmentType: true,
              adjustedAmount: true,
            },
          },
        },
      }),
      this.prisma.workOrder.count({ where }),
    ]);

    const data = rows.map((row) => {
      const saleInvoiceAmount = row.invoiceLinks
        .filter((link) => link.invoiceType === WorkOrderInvoiceLinkType.SALE)
        .reduce(
          (sum, link) => sum + this.toNumber(link.invoice.totalAmount),
          0,
        );
      const purchaseInvoiceAmount = row.invoiceLinks
        .filter(
          (link) => link.invoiceType === WorkOrderInvoiceLinkType.PURCHASE,
        )
        .reduce(
          (sum, link) => sum + this.toNumber(link.invoice.totalAmount),
          0,
        );
      const customerReductions = row.adjustments
        .filter(
          (adjustment) =>
            adjustment.adjustmentType === WorkOrderAdjustmentType.SALE_RETURN,
        )
        .reduce(
          (sum, adjustment) => sum + this.toNumber(adjustment.adjustedAmount),
          0,
        );
      const vendorReductions = row.adjustments
        .filter(
          (adjustment) =>
            adjustment.adjustmentType ===
            WorkOrderAdjustmentType.PURCHASE_RETURN,
        )
        .reduce(
          (sum, adjustment) => sum + this.toNumber(adjustment.adjustedAmount),
          0,
        );
      const directLoss = row.adjustments
        .filter(
          (adjustment) =>
            adjustment.adjustmentType ===
            WorkOrderAdjustmentType.LOSS_EXPENSE_NOTE,
        )
        .reduce(
          (sum, adjustment) => sum + this.toNumber(adjustment.adjustedAmount),
          0,
        );

      const netRevenue = saleInvoiceAmount - customerReductions;
      const netOutsourceCost = purchaseInvoiceAmount - vendorReductions;
      const contribution = netRevenue - netOutsourceCost - directLoss;
      const acceptedQty = row.lots.reduce(
        (sum, lot) => sum + this.toNumber(lot.acceptedQty),
        0,
      );

      return {
        id: row.id,
        orderRef: row.orderRef,
        itemName: row.itemName,
        status: row.status,
        orderedQty: this.toNumber(row.orderedQty),
        saleRate: this.toNumber(row.saleRate),
        expectedDeliveryDate: row.expectedDeliveryDate,
        createdAt: row.createdAt,
        customer: row.customerAccount?.party?.name ?? null,
        profitability: {
          contribution: this.round2(contribution),
          contributionPerUnit: this.round2(
            contribution / Math.max(acceptedQty, 1),
          ),
        },
      };
    });

    return createPaginatedResult(data, total, page, limit);
  }

  async findById(companyId: string, id: string) {
    const workOrder = await this.prisma.workOrder.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        customerAccount: {
          select: {
            id: true,
            party: {
              select: {
                id: true,
                name: true,
                gstin: true,
              },
            },
          },
        },
        lots: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          include: {
            vendorAccount: {
              select: {
                id: true,
                party: {
                  select: { id: true, name: true },
                },
              },
            },
            invoiceLinks: {
              include: {
                invoice: {
                  select: {
                    id: true,
                    invoiceNumber: true,
                    type: true,
                    status: true,
                    totalAmount: true,
                    accountId: true,
                  },
                },
              },
            },
          },
        },
        invoiceLinks: {
          include: {
            invoice: {
              select: {
                id: true,
                invoiceNumber: true,
                type: true,
                status: true,
                totalAmount: true,
                accountId: true,
              },
            },
          },
        },
        lossIncidents: {
          where: { deletedAt: null },
          orderBy: { incidentDate: 'desc' },
          include: {
            autoAdjustment: true,
          },
        },
      },
    });

    if (!workOrder) {
      throw new NotFoundException('Work order not found');
    }

    const profitability = await this.getProfitabilityByWorkOrderId(
      companyId,
      workOrder.id,
    );

    return {
      ...workOrder,
      profitability,
    };
  }

  async split(
    companyId: string,
    id: string,
    userId: string,
    dto: SplitWorkOrderDto,
  ) {
    const workOrder = await this.prisma.workOrder.findFirst({
      where: { id, companyId, deletedAt: null },
      select: {
        id: true,
        tenantId: true,
        orderedQty: true,
        overrideFlagsJson: true,
      },
    });
    if (!workOrder) {
      throw new NotFoundException('Work order not found');
    }

    const existingLinksCount = await this.prisma.workOrderInvoiceLink.count({
      where: { workOrderId: workOrder.id },
    });
    if (existingLinksCount > 0) {
      throw new ConflictException(
        'Lots cannot be modified after invoices are linked to this work order.',
      );
    }

    const vendorIds = dto.lots
      .map((lot) => lot.vendorAccountId)
      .filter((value): value is string => Boolean(value));
    if (vendorIds.length > 0) {
      const vendors = await this.prisma.account.findMany({
        where: {
          companyId,
          id: { in: vendorIds },
          deletedAt: null,
        },
        select: { id: true },
      });
      const vendorSet = new Set(vendors.map((vendor) => vendor.id));
      const missing = vendorIds.find((vendorId) => !vendorSet.has(vendorId));
      if (missing) {
        throw new NotFoundException(`Vendor account not found: ${missing}`);
      }
    }

    for (const lot of dto.lots) {
      if (lot.lotType === WorkOrderLotType.OUTSOURCED) {
        if (!lot.vendorAccountId) {
          throw new BadRequestException(
            'vendorAccountId is required for OUTSOURCED lots.',
          );
        }
        if (typeof lot.agreedRate !== 'number') {
          throw new BadRequestException(
            'agreedRate is required for OUTSOURCED lots.',
          );
        }
      }
    }

    const orderedQty = this.toNumber(workOrder.orderedQty);
    const plannedQty = dto.lots.reduce((sum, lot) => sum + lot.plannedQty, 0);
    const qtyMismatch = Math.abs(orderedQty - plannedQty) > 0.0001;

    if (qtyMismatch && !dto.overrideReason) {
      throw new BadRequestException(
        `Lot quantity mismatch detected. Ordered quantity is ${orderedQty}, but lot total is ${this.round3(plannedQty)}. Provide overrideReason to continue.`,
      );
    }

    const overrideFlags = this.toOverrideFlagsArray(
      workOrder.overrideFlagsJson,
    );
    if (qtyMismatch && dto.overrideReason) {
      overrideFlags.push({
        type: 'QTY_MISMATCH',
        reason: dto.overrideReason.trim(),
        createdBy: userId,
        createdAt: new Date().toISOString(),
        meta: {
          orderedQty,
          plannedQty: this.round3(plannedQty),
        },
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.workOrderLot.deleteMany({
        where: { workOrderId: workOrder.id },
      });

      if (dto.lots.length > 0) {
        await tx.workOrderLot.createMany({
          data: dto.lots.map((lot) => ({
            tenantId: workOrder.tenantId,
            companyId,
            workOrderId: workOrder.id,
            lotType:
              lot.lotType === WorkOrderLotType.OUTSOURCED
                ? WorkOrderLotType.OUTSOURCED
                : WorkOrderLotType.IN_HOUSE,
            vendorAccountId:
              lot.lotType === WorkOrderLotType.OUTSOURCED
                ? (lot.vendorAccountId ?? null)
                : null,
            plannedQty: lot.plannedQty,
            agreedRate:
              lot.lotType === WorkOrderLotType.OUTSOURCED
                ? (lot.agreedRate ?? null)
                : null,
            status: WorkOrderLotStatus.PLANNED,
            dueDate: lot.dueDate ? new Date(lot.dueDate) : null,
            notes: lot.notes?.trim() || null,
            createdBy: userId,
            updatedBy: userId,
          })),
        });
      }

      await tx.workOrder.update({
        where: { id: workOrder.id },
        data: {
          status: WorkOrderStatus.PLANNED,
          overrideFlagsJson: overrideFlags as Prisma.InputJsonValue,
          updatedBy: userId,
        },
      });
    });

    const updated = await this.findById(companyId, workOrder.id);
    return {
      ...updated,
      warnings: qtyMismatch
        ? [
            {
              code: 'QTY_MISMATCH',
              message:
                'Planned lot quantity does not exactly match ordered quantity.',
            },
          ]
        : [],
    };
  }

  async linkSaleInvoice(
    companyId: string,
    workOrderId: string,
    invoiceId: string,
    userId: string,
  ) {
    const workOrder = await this.getWorkOrderContext(companyId, workOrderId);
    await this.ensureInvoiceBelongsToCompanyAndType(
      companyId,
      invoiceId,
      InvoiceType.SALE,
    );

    const existingSaleLink = await this.prisma.workOrderInvoiceLink.findFirst({
      where: {
        workOrderId,
        invoiceType: WorkOrderInvoiceLinkType.SALE,
      },
      select: { id: true },
    });
    if (existingSaleLink) {
      throw new ConflictException(
        'A final sale invoice is already linked to this work order.',
      );
    }

    const existingInvoiceLink =
      await this.prisma.workOrderInvoiceLink.findFirst({
        where: { invoiceId },
        select: { id: true, workOrderId: true },
      });
    if (existingInvoiceLink) {
      throw new ConflictException(
        `Invoice is already linked to work order ${existingInvoiceLink.workOrderId}.`,
      );
    }

    await this.prisma.workOrderInvoiceLink.create({
      data: {
        tenantId: workOrder.tenantId,
        companyId,
        workOrderId,
        lotId: null,
        invoiceId,
        invoiceType: WorkOrderInvoiceLinkType.SALE,
        createdBy: userId,
      },
    });

    return this.findById(companyId, workOrderId);
  }

  async linkPurchaseInvoice(
    companyId: string,
    lotId: string,
    invoiceId: string,
    userId: string,
  ) {
    const lot = await this.prisma.workOrderLot.findFirst({
      where: { id: lotId, companyId, deletedAt: null },
      select: {
        id: true,
        tenantId: true,
        workOrderId: true,
        lotType: true,
        vendorAccountId: true,
      },
    });
    if (!lot) {
      throw new NotFoundException('Work order lot not found');
    }
    if (lot.lotType !== WorkOrderLotType.OUTSOURCED) {
      throw new BadRequestException(
        'Purchase invoices can only be linked to OUTSOURCED lots.',
      );
    }

    const invoice = await this.ensureInvoiceBelongsToCompanyAndType(
      companyId,
      invoiceId,
      InvoiceType.PURCHASE,
    );

    if (lot.vendorAccountId && invoice.accountId !== lot.vendorAccountId) {
      throw new BadRequestException(
        'Purchase invoice account does not match outsourced vendor for this lot.',
      );
    }

    const existingPurchaseLink =
      await this.prisma.workOrderInvoiceLink.findFirst({
        where: {
          lotId,
          invoiceType: WorkOrderInvoiceLinkType.PURCHASE,
        },
        select: { id: true },
      });
    if (existingPurchaseLink) {
      throw new ConflictException(
        'A purchase invoice is already linked for this outsourced lot.',
      );
    }

    await this.prisma.workOrderInvoiceLink.create({
      data: {
        tenantId: lot.tenantId,
        companyId,
        workOrderId: lot.workOrderId,
        lotId,
        invoiceId,
        invoiceType: WorkOrderInvoiceLinkType.PURCHASE,
        createdBy: userId,
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
    const workOrder = await this.getWorkOrderContext(companyId, workOrderId);

    if (dto.lotId) {
      await this.ensureLotBelongsToWorkOrder(companyId, workOrderId, dto.lotId);
    }
    if (dto.vendorAccountId) {
      await this.ensureAccountBelongsToCompany(companyId, dto.vendorAccountId);
    }

    const resolution = await this.resolveAdjustment(
      companyId,
      workOrderId,
      dto,
    );

    const { incidentId, adjustmentId } = await this.prisma.$transaction(
      async (tx) => {
        const incident = await tx.workOrderLossIncident.create({
          data: {
            tenantId: workOrder.tenantId,
            companyId,
            workOrderId,
            lotId: dto.lotId ?? null,
            vendorAccountId: dto.vendorAccountId ?? null,
            incidentDate: new Date(dto.incidentDate),
            impactedQty: dto.impactedQty ?? 0,
            amount: dto.amount,
            reasonCode: dto.reasonCode,
            reasonNote: dto.reasonNote.trim(),
            chargeTo: dto.chargeTo,
            autoAdjustMode: resolution.autoAdjustMode,
            status: WorkOrderLossIncidentStatus.RECORDED,
            createdBy: userId,
            updatedBy: userId,
          },
          select: { id: true },
        });

        const adjustment = await tx.workOrderAutoAdjustment.create({
          data: {
            tenantId: workOrder.tenantId,
            companyId,
            workOrderId,
            workOrderLossIncidentId: incident.id,
            adjustmentType: resolution.adjustmentType,
            referenceInvoiceId: resolution.referenceInvoiceId,
            adjustedAmount: dto.amount,
            status: WorkOrderAdjustmentStatus.PENDING,
            createdBy: userId,
            updatedBy: userId,
          },
          select: { id: true },
        });

        return { incidentId: incident.id, adjustmentId: adjustment.id };
      },
    );

    try {
      await this.postAdjustment(companyId, adjustmentId, userId, false);
    } catch (error) {
      await this.markAdjustmentFailed(
        companyId,
        adjustmentId,
        incidentId,
        userId,
        error instanceof Error ? error.message : 'Unknown posting error',
      );
    }

    return this.getLossIncident(companyId, incidentId);
  }

  async listLossIncidents(companyId: string, workOrderId: string) {
    await this.getWorkOrderContext(companyId, workOrderId);
    return this.prisma.workOrderLossIncident.findMany({
      where: {
        companyId,
        workOrderId,
        deletedAt: null,
      },
      include: {
        autoAdjustment: true,
      },
      orderBy: { incidentDate: 'desc' },
    });
  }

  async retryLossIncidentAdjustment(
    companyId: string,
    incidentId: string,
    userId: string,
  ) {
    const incident = await this.prisma.workOrderLossIncident.findFirst({
      where: { id: incidentId, companyId, deletedAt: null },
      include: { autoAdjustment: true },
    });
    if (!incident || !incident.autoAdjustment) {
      throw new NotFoundException('Loss incident not found');
    }
    if (incident.autoAdjustment.status !== WorkOrderAdjustmentStatus.FAILED) {
      throw new BadRequestException('Only failed adjustments can be retried.');
    }

    try {
      await this.postAdjustment(
        companyId,
        incident.autoAdjustment.id,
        userId,
        true,
      );
    } catch (error) {
      await this.markAdjustmentFailed(
        companyId,
        incident.autoAdjustment.id,
        incident.id,
        userId,
        error instanceof Error ? error.message : 'Unknown retry error',
      );
      throw new ConflictException(
        'Adjustment retry failed. Please retry later.',
      );
    }

    return this.getLossIncident(companyId, incidentId);
  }

  async reverseLossIncident(
    companyId: string,
    incidentId: string,
    userId: string,
    reason: string,
  ) {
    const incident = await this.prisma.workOrderLossIncident.findFirst({
      where: { id: incidentId, companyId, deletedAt: null },
      include: { autoAdjustment: true },
    });
    if (!incident || !incident.autoAdjustment) {
      throw new NotFoundException('Loss incident not found');
    }
    if (incident.autoAdjustment.status !== WorkOrderAdjustmentStatus.POSTED) {
      throw new BadRequestException('Only posted adjustments can be reversed.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.workOrderAutoAdjustment.update({
        where: { id: incident.autoAdjustment!.id },
        data: {
          status: WorkOrderAdjustmentStatus.REVERSED,
          updatedBy: userId,
          errorMessage: `Reversed: ${reason.trim()}`,
        },
      });

      await tx.workOrderLossIncident.update({
        where: { id: incident.id },
        data: {
          status: WorkOrderLossIncidentStatus.REVERSED,
          updatedBy: userId,
          reasonNote: `${incident.reasonNote}\n[REVERSAL] ${reason.trim()}`,
        },
      });
    });

    return this.getLossIncident(companyId, incidentId);
  }

  async close(
    companyId: string,
    workOrderId: string,
    userId: string,
    dto: CloseWorkOrderDto,
  ) {
    const workOrder = await this.prisma.workOrder.findFirst({
      where: { id: workOrderId, companyId, deletedAt: null },
      include: {
        lots: {
          where: { deletedAt: null },
          select: { id: true, status: true },
        },
      },
    });
    if (!workOrder) {
      throw new NotFoundException('Work order not found');
    }

    const openLots = workOrder.lots.filter(
      (lot) => lot.status !== WorkOrderLotStatus.CLOSED,
    );
    if (openLots.length > 0 && !dto.overrideReason) {
      throw new BadRequestException(
        'All lots must be closed before closing this work order, or provide overrideReason.',
      );
    }

    const overrideFlags = this.toOverrideFlagsArray(
      workOrder.overrideFlagsJson,
    );
    if (openLots.length > 0 && dto.overrideReason) {
      overrideFlags.push({
        type: 'FORCE_CLOSE_WITH_OPEN_LOTS',
        reason: dto.overrideReason.trim(),
        createdBy: userId,
        createdAt: new Date().toISOString(),
        meta: { openLotCount: openLots.length },
      });
    }

    await this.prisma.workOrder.update({
      where: { id: workOrder.id },
      data: {
        status: WorkOrderStatus.CLOSED,
        overrideFlagsJson: overrideFlags as Prisma.InputJsonValue,
        updatedBy: userId,
      },
    });

    return this.findById(companyId, workOrderId);
  }

  async getProfitability(companyId: string, workOrderId: string) {
    await this.getWorkOrderContext(companyId, workOrderId);
    return this.getProfitabilityByWorkOrderId(companyId, workOrderId);
  }

  async getMonthlyProfitSummary(
    companyId: string,
    query: WorkOrderReportQueryDto,
  ) {
    const { start, end } = this.resolveMonthRange(query);
    const orders = await this.prisma.workOrder.findMany({
      where: {
        companyId,
        deletedAt: null,
        createdAt: { gte: start, lt: end },
      },
      select: {
        id: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const buckets = new Map<
      string,
      {
        month: string;
        orders: number;
        netRevenue: number;
        netOutsourceCost: number;
        directLoss: number;
        contribution: number;
      }
    >();

    for (const order of orders) {
      const key = this.monthKey(order.createdAt);
      const snapshot = await this.getProfitabilityByWorkOrderId(
        companyId,
        order.id,
      );
      const bucket = buckets.get(key) ?? {
        month: key,
        orders: 0,
        netRevenue: 0,
        netOutsourceCost: 0,
        directLoss: 0,
        contribution: 0,
      };

      bucket.orders += 1;
      bucket.netRevenue += snapshot.netRevenue;
      bucket.netOutsourceCost += snapshot.netOutsourceCost;
      bucket.directLoss += snapshot.directLoss;
      bucket.contribution += snapshot.contribution;

      buckets.set(key, bucket);
    }

    return Array.from(buckets.values()).map((bucket) => ({
      month: bucket.month,
      orders: bucket.orders,
      netRevenue: this.round2(bucket.netRevenue),
      netOutsourceCost: this.round2(bucket.netOutsourceCost),
      directLoss: this.round2(bucket.directLoss),
      contribution: this.round2(bucket.contribution),
    }));
  }

  async getVendorMarginRisk(companyId: string, query: WorkOrderReportQueryDto) {
    const { start, end } = this.resolveMonthRange(query);
    const lots = await this.prisma.workOrderLot.findMany({
      where: {
        companyId,
        deletedAt: null,
        lotType: WorkOrderLotType.OUTSOURCED,
        createdAt: { gte: start, lt: end },
      },
      include: {
        workOrder: {
          select: { id: true, saleRate: true },
        },
        vendorAccount: {
          select: {
            id: true,
            party: {
              select: { name: true },
            },
          },
        },
        invoiceLinks: {
          include: {
            invoice: {
              select: {
                id: true,
                totalAmount: true,
              },
            },
          },
        },
        lossIncidents: {
          where: { deletedAt: null },
          include: { autoAdjustment: true },
        },
      },
    });

    const vendorMap = new Map<
      string,
      {
        vendorAccountId: string;
        vendorName: string;
        assignedQty: number;
        producedQty: number;
        acceptedQty: number;
        rejectedQty: number;
        purchaseCost: number;
        vendorReductions: number;
        vendorLossAmount: number;
        directLoss: number;
        incidentCount: number;
        impliedRevenue: number;
      }
    >();

    for (const lot of lots) {
      if (!lot.vendorAccountId || !lot.vendorAccount) {
        continue;
      }

      const key = lot.vendorAccountId;
      const row = vendorMap.get(key) ?? {
        vendorAccountId: key,
        vendorName: lot.vendorAccount.party?.name ?? 'Unknown Vendor',
        assignedQty: 0,
        producedQty: 0,
        acceptedQty: 0,
        rejectedQty: 0,
        purchaseCost: 0,
        vendorReductions: 0,
        vendorLossAmount: 0,
        directLoss: 0,
        incidentCount: 0,
        impliedRevenue: 0,
      };

      row.assignedQty += this.toNumber(lot.plannedQty);
      row.producedQty += this.toNumber(lot.producedQty);
      row.acceptedQty += this.toNumber(lot.acceptedQty);
      row.rejectedQty += this.toNumber(lot.rejectedQty);
      row.impliedRevenue +=
        this.toNumber(lot.acceptedQty) * this.toNumber(lot.workOrder.saleRate);

      const lotPurchaseCost = lot.invoiceLinks.reduce(
        (sum, link) => sum + this.toNumber(link.invoice.totalAmount),
        0,
      );
      row.purchaseCost += lotPurchaseCost;

      for (const incident of lot.lossIncidents) {
        row.incidentCount += 1;
        row.vendorLossAmount += this.toNumber(incident.amount);
        if (incident.chargeTo === WorkOrderLossChargeTo.OUR_COMPANY) {
          row.directLoss += this.toNumber(incident.amount);
        }
        if (
          incident.autoAdjustment?.status ===
            WorkOrderAdjustmentStatus.POSTED &&
          incident.autoAdjustment.adjustmentType ===
            WorkOrderAdjustmentType.PURCHASE_RETURN
        ) {
          row.vendorReductions += this.toNumber(
            incident.autoAdjustment.adjustedAmount,
          );
        }
      }

      vendorMap.set(key, row);
    }

    return Array.from(vendorMap.values())
      .map((row) => {
        const netCost = row.purchaseCost - row.vendorReductions;
        const contribution = row.impliedRevenue - netCost - row.directLoss;
        const rejectionRate =
          row.producedQty > 0 ? (row.rejectedQty / row.producedQty) * 100 : 0;

        let riskBucket: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
        if (rejectionRate >= 10 || row.vendorLossAmount >= 10000) {
          riskBucket = 'HIGH';
        } else if (rejectionRate >= 5 || row.vendorLossAmount >= 3000) {
          riskBucket = 'MEDIUM';
        }

        return {
          vendorAccountId: row.vendorAccountId,
          vendorName: row.vendorName,
          assignedQty: this.round3(row.assignedQty),
          producedQty: this.round3(row.producedQty),
          acceptedQty: this.round3(row.acceptedQty),
          rejectedQty: this.round3(row.rejectedQty),
          rejectionRate: this.round2(rejectionRate),
          vendorNetCost: this.round2(netCost),
          vendorReductions: this.round2(row.vendorReductions),
          vendorLossAmount: this.round2(row.vendorLossAmount),
          impliedMarginContribution: this.round2(contribution),
          incidentCount: row.incidentCount,
          riskBucket,
        };
      })
      .sort((a, b) => {
        const weight = { HIGH: 3, MEDIUM: 2, LOW: 1 };
        if (weight[b.riskBucket] !== weight[a.riskBucket]) {
          return weight[b.riskBucket] - weight[a.riskBucket];
        }
        return b.vendorLossAmount - a.vendorLossAmount;
      });
  }

  private async getProfitabilityByWorkOrderId(
    companyId: string,
    workOrderId: string,
  ): Promise<ProfitabilitySnapshot> {
    const [links, adjustments, lots] = await Promise.all([
      this.prisma.workOrderInvoiceLink.findMany({
        where: { companyId, workOrderId },
        include: {
          invoice: {
            select: {
              id: true,
              totalAmount: true,
            },
          },
        },
      }),
      this.prisma.workOrderAutoAdjustment.findMany({
        where: {
          companyId,
          workOrderId,
          deletedAt: null,
          status: WorkOrderAdjustmentStatus.POSTED,
        },
        select: {
          adjustmentType: true,
          adjustedAmount: true,
        },
      }),
      this.prisma.workOrderLot.findMany({
        where: { companyId, workOrderId, deletedAt: null },
        select: { acceptedQty: true },
      }),
    ]);

    const saleInvoiceAmount = links
      .filter((link) => link.invoiceType === WorkOrderInvoiceLinkType.SALE)
      .reduce((sum, link) => sum + this.toNumber(link.invoice.totalAmount), 0);
    const purchaseInvoiceAmount = links
      .filter((link) => link.invoiceType === WorkOrderInvoiceLinkType.PURCHASE)
      .reduce((sum, link) => sum + this.toNumber(link.invoice.totalAmount), 0);
    const customerReductions = adjustments
      .filter(
        (adjustment) =>
          adjustment.adjustmentType === WorkOrderAdjustmentType.SALE_RETURN,
      )
      .reduce(
        (sum, adjustment) => sum + this.toNumber(adjustment.adjustedAmount),
        0,
      );
    const vendorReductions = adjustments
      .filter(
        (adjustment) =>
          adjustment.adjustmentType === WorkOrderAdjustmentType.PURCHASE_RETURN,
      )
      .reduce(
        (sum, adjustment) => sum + this.toNumber(adjustment.adjustedAmount),
        0,
      );
    const directLoss = adjustments
      .filter(
        (adjustment) =>
          adjustment.adjustmentType ===
          WorkOrderAdjustmentType.LOSS_EXPENSE_NOTE,
      )
      .reduce(
        (sum, adjustment) => sum + this.toNumber(adjustment.adjustedAmount),
        0,
      );

    const netRevenue = saleInvoiceAmount - customerReductions;
    const netOutsourceCost = purchaseInvoiceAmount - vendorReductions;
    const contribution = netRevenue - netOutsourceCost - directLoss;
    const acceptedQty = lots.reduce(
      (sum, lot) => sum + this.toNumber(lot.acceptedQty),
      0,
    );

    return {
      saleInvoiceAmount: this.round2(saleInvoiceAmount),
      customerReductions: this.round2(customerReductions),
      netRevenue: this.round2(netRevenue),
      purchaseInvoiceAmount: this.round2(purchaseInvoiceAmount),
      vendorReductions: this.round2(vendorReductions),
      netOutsourceCost: this.round2(netOutsourceCost),
      directLoss: this.round2(directLoss),
      contribution: this.round2(contribution),
      contributionPerUnit: this.round2(contribution / Math.max(acceptedQty, 1)),
    };
  }

  private async getLossIncident(companyId: string, incidentId: string) {
    const incident = await this.prisma.workOrderLossIncident.findFirst({
      where: { id: incidentId, companyId, deletedAt: null },
      include: { autoAdjustment: true },
    });
    if (!incident) {
      throw new NotFoundException('Loss incident not found');
    }
    return incident;
  }

  private async resolveAdjustment(
    companyId: string,
    workOrderId: string,
    dto: CreateLossIncidentDto,
  ): Promise<AdjustmentResolution> {
    if (dto.chargeTo === WorkOrderLossChargeTo.OUR_COMPANY) {
      return {
        adjustmentType: WorkOrderAdjustmentType.LOSS_EXPENSE_NOTE,
        autoAdjustMode: WorkOrderAutoAdjustMode.DIRECT_LOSS,
        referenceInvoiceId: null,
      };
    }

    if (dto.chargeTo === WorkOrderLossChargeTo.CUSTOMER) {
      const saleLink = await this.prisma.workOrderInvoiceLink.findFirst({
        where: {
          companyId,
          workOrderId,
          invoiceType: WorkOrderInvoiceLinkType.SALE,
        },
        select: { invoiceId: true },
      });

      if (!saleLink) {
        return {
          adjustmentType: WorkOrderAdjustmentType.LOSS_EXPENSE_NOTE,
          autoAdjustMode: WorkOrderAutoAdjustMode.DIRECT_LOSS,
          referenceInvoiceId: null,
        };
      }

      return {
        adjustmentType: WorkOrderAdjustmentType.SALE_RETURN,
        autoAdjustMode: WorkOrderAutoAdjustMode.RECEIVABLE_REDUCTION,
        referenceInvoiceId: saleLink.invoiceId,
      };
    }

    const purchaseLink = dto.lotId
      ? await this.prisma.workOrderInvoiceLink.findFirst({
          where: {
            companyId,
            workOrderId,
            lotId: dto.lotId,
            invoiceType: WorkOrderInvoiceLinkType.PURCHASE,
          },
          select: { invoiceId: true },
        })
      : await this.prisma.workOrderInvoiceLink.findFirst({
          where: {
            companyId,
            workOrderId,
            invoiceType: WorkOrderInvoiceLinkType.PURCHASE,
          },
          orderBy: { createdAt: 'desc' },
          select: { invoiceId: true },
        });

    if (!purchaseLink) {
      return {
        adjustmentType: WorkOrderAdjustmentType.LOSS_EXPENSE_NOTE,
        autoAdjustMode: WorkOrderAutoAdjustMode.DIRECT_LOSS,
        referenceInvoiceId: null,
      };
    }

    return {
      adjustmentType: WorkOrderAdjustmentType.PURCHASE_RETURN,
      autoAdjustMode: WorkOrderAutoAdjustMode.PAYABLE_REDUCTION,
      referenceInvoiceId: purchaseLink.invoiceId,
    };
  }

  private async postAdjustment(
    companyId: string,
    adjustmentId: string,
    userId: string,
    isRetry: boolean,
  ) {
    const adjustment = await this.prisma.workOrderAutoAdjustment.findFirst({
      where: { id: adjustmentId, companyId, deletedAt: null },
      select: {
        id: true,
        workOrderLossIncidentId: true,
        status: true,
      },
    });
    if (!adjustment) {
      throw new NotFoundException('Adjustment not found');
    }
    if (adjustment.status === WorkOrderAdjustmentStatus.POSTED) {
      return;
    }

    const adjustmentUpdate: Prisma.WorkOrderAutoAdjustmentUpdateInput = {
      status: WorkOrderAdjustmentStatus.POSTED,
      adjustmentDocumentId: `WO-ADJ-${adjustment.id.slice(0, 8).toUpperCase()}`,
      errorMessage: null,
      updatedBy: userId,
    };

    if (isRetry) {
      adjustmentUpdate.retryCount = { increment: 1 };
      adjustmentUpdate.lastRetryAt = new Date();
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.workOrderAutoAdjustment.update({
        where: { id: adjustment.id },
        data: adjustmentUpdate,
      });
      await tx.workOrderLossIncident.update({
        where: { id: adjustment.workOrderLossIncidentId },
        data: {
          status: WorkOrderLossIncidentStatus.ADJUSTED,
          updatedBy: userId,
        },
      });
    });
  }

  private async markAdjustmentFailed(
    companyId: string,
    adjustmentId: string,
    incidentId: string,
    userId: string,
    errorMessage: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.workOrderAutoAdjustment.updateMany({
        where: { id: adjustmentId, companyId },
        data: {
          status: WorkOrderAdjustmentStatus.FAILED,
          errorMessage,
          retryCount: { increment: 1 },
          lastRetryAt: new Date(),
          updatedBy: userId,
        },
      });
      await tx.workOrderLossIncident.updateMany({
        where: { id: incidentId, companyId },
        data: {
          status: WorkOrderLossIncidentStatus.FAILED_ADJUSTMENT,
          updatedBy: userId,
        },
      });
    });
  }

  private async getWorkOrderContext(companyId: string, workOrderId: string) {
    const workOrder = await this.prisma.workOrder.findFirst({
      where: { id: workOrderId, companyId, deletedAt: null },
      select: { id: true, tenantId: true },
    });
    if (!workOrder) {
      throw new NotFoundException('Work order not found');
    }
    return workOrder;
  }

  private async ensureLotBelongsToWorkOrder(
    companyId: string,
    workOrderId: string,
    lotId: string,
  ) {
    const lot = await this.prisma.workOrderLot.findFirst({
      where: { id: lotId, companyId, workOrderId, deletedAt: null },
      select: { id: true },
    });
    if (!lot) {
      throw new NotFoundException('Lot not found for this work order');
    }
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
      throw new NotFoundException('Account not found for this company');
    }
  }

  private async ensureInvoiceBelongsToCompanyAndType(
    companyId: string,
    invoiceId: string,
    expectedType: InvoiceType,
  ) {
    const invoice = await this.prisma.invoice.findFirst({
      where: {
        id: invoiceId,
        companyId,
        deletedAt: null,
        status: { not: InvoiceStatus.CANCELLED },
      },
      select: {
        id: true,
        type: true,
        accountId: true,
      },
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    if (invoice.type !== expectedType) {
      throw new BadRequestException(
        `Expected ${expectedType} invoice but received ${invoice.type}.`,
      );
    }
    return invoice;
  }

  private async generateOrderRef(
    tx: Prisma.TransactionClient,
    companyId: string,
  ) {
    const year = new Date().getFullYear();
    const prefix = `WO-${year}-`;
    const latest = await tx.workOrder.findFirst({
      where: {
        companyId,
        orderRef: { startsWith: prefix },
      },
      orderBy: { createdAt: 'desc' },
      select: { orderRef: true },
    });

    const latestCounter =
      latest?.orderRef.match(/(\d+)$/)?.[1] &&
      Number(latest.orderRef.match(/(\d+)$/)?.[1]);
    const next = Number.isFinite(latestCounter) ? Number(latestCounter) + 1 : 1;
    return `${prefix}${String(next).padStart(4, '0')}`;
  }

  private resolveMonthRange(query: WorkOrderReportQueryDto) {
    const now = new Date();
    const fromMonth = query.from ?? this.monthKey(now);
    const toMonth = query.to ?? fromMonth;

    const start = this.parseMonth(fromMonth);
    const end = this.nextMonth(this.parseMonth(toMonth));
    return { start, end };
  }

  private parseMonth(value: string) {
    const [yearStr, monthStr] = value.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr);
    if (
      !Number.isInteger(year) ||
      !Number.isInteger(month) ||
      month < 1 ||
      month > 12
    ) {
      throw new BadRequestException(`Invalid month value: ${value}`);
    }
    return new Date(Date.UTC(year, month - 1, 1));
  }

  private nextMonth(value: Date) {
    return new Date(
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 1),
    );
  }

  private monthKey(value: Date) {
    return value.toISOString().slice(0, 7);
  }

  private toOverrideFlagsArray(
    value: Prisma.JsonValue | null,
  ): Prisma.JsonArray {
    if (!Array.isArray(value)) {
      return [];
    }
    return [...value] as Prisma.JsonArray;
  }

  private toNumber(value: Prisma.Decimal | number | string | null | undefined) {
    if (value == null) {
      return 0;
    }
    return Number(value);
  }

  private round2(value: number) {
    return Number(value.toFixed(2));
  }

  private round3(value: number) {
    return Number(value.toFixed(3));
  }
}
