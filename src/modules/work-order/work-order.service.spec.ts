import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  InvoiceType,
  WorkOrderAdjustmentStatus,
  WorkOrderAdjustmentType,
  WorkOrderAutoAdjustMode,
  WorkOrderStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WorkOrderService } from './work-order.service';
import {
  WorkOrderLossChargeToDto,
  WorkOrderLossReasonCodeDto,
} from './dto/create-loss-incident.dto';

describe('WorkOrderService', () => {
  let service: WorkOrderService;
  let prisma: jest.Mocked<Partial<PrismaService>>;

  beforeEach(async () => {
    prisma = {
      company: { findUnique: jest.fn() } as any,
      account: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
      } as any,
      invoice: { findFirst: jest.fn() } as any,
      workOrder: {
        create: jest.fn(),
        update: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      } as any,
      workOrderLot: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      } as any,
      workOrderInvoiceLink: {
        count: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
      } as any,
      workOrderLossIncident: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      } as any,
      workOrderAutoAdjustment: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      } as any,
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkOrderService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<WorkOrderService>(WorkOrderService);
  });

  afterEach(() => jest.clearAllMocks());

  it('blocks split when lot qty mismatches and override reason is missing', async () => {
    (prisma.workOrder!.findFirst as jest.Mock).mockResolvedValue({
      id: 'wo-1',
      tenantId: 'tenant-1',
      orderedQty: 100,
      overrideFlagsJson: null,
    });
    (prisma.workOrderInvoiceLink!.count as jest.Mock).mockResolvedValue(0);

    await expect(
      service.split('company-1', 'wo-1', 'user-1', {
        lots: [{ lotType: 'IN_HOUSE', plannedQty: 90 }],
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('blocks second sale invoice link for a work order', async () => {
    (prisma.workOrder!.findFirst as jest.Mock).mockResolvedValue({
      id: 'wo-1',
      tenantId: 'tenant-1',
    });
    (prisma.invoice!.findFirst as jest.Mock).mockResolvedValue({
      id: 'inv-sale-1',
      type: InvoiceType.SALE,
      accountId: 'acc-customer',
    });
    (prisma.workOrderInvoiceLink!.findFirst as jest.Mock).mockResolvedValueOnce(
      {
        id: 'sale-link-1',
      },
    );

    await expect(
      service.linkSaleInvoice('company-1', 'wo-1', 'inv-sale-1', 'user-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('falls back to DIRECT_LOSS when vendor charge has no purchase invoice link', async () => {
    const tx = {
      workOrderLossIncident: {
        create: jest.fn().mockResolvedValue({ id: 'inc-1' }),
        update: jest.fn().mockResolvedValue({ id: 'inc-1' }),
      },
      workOrderAutoAdjustment: {
        create: jest.fn().mockResolvedValue({ id: 'adj-1' }),
        update: jest.fn().mockResolvedValue({ id: 'adj-1' }),
      },
    };

    (prisma.workOrder!.findFirst as jest.Mock).mockResolvedValue({
      id: 'wo-1',
      tenantId: 'tenant-1',
      status: WorkOrderStatus.DRAFT,
    });
    (prisma.workOrderInvoiceLink!.findFirst as jest.Mock).mockResolvedValue(
      null,
    );
    (prisma.workOrderAutoAdjustment!.findFirst as jest.Mock).mockResolvedValue({
      id: 'adj-1',
      workOrderLossIncidentId: 'inc-1',
      status: WorkOrderAdjustmentStatus.PENDING,
    });
    (prisma.workOrderLossIncident!.findFirst as jest.Mock).mockResolvedValue({
      id: 'inc-1',
      status: 'ADJUSTED',
      autoAdjustment: {
        id: 'adj-1',
        status: WorkOrderAdjustmentStatus.POSTED,
      },
    });

    (prisma.$transaction as jest.Mock).mockImplementation(async (cb) => cb(tx));

    await service.createLossIncident('company-1', 'wo-1', 'user-1', {
      incidentDate: '2026-04-11',
      amount: 2500,
      impactedQty: 15,
      reasonCode: WorkOrderLossReasonCodeDto.QUALITY_DEFECT,
      reasonNote: 'Vendor finish mismatch',
      chargeTo: WorkOrderLossChargeToDto.VENDOR,
    });

    expect(tx.workOrderLossIncident.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          autoAdjustMode: WorkOrderAutoAdjustMode.DIRECT_LOSS,
        }),
      }),
    );
    expect(tx.workOrderAutoAdjustment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          adjustmentType: WorkOrderAdjustmentType.LOSS_EXPENSE_NOTE,
          referenceInvoiceId: null,
        }),
      }),
    );
  });
});
