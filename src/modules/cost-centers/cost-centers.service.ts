import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, CostCenterType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { createPaginatedResult, parsePagination } from '../../common/utils/pagination.util';
import { CreateCostAllocationDto, CreateCostCenterDto, CostCenterTypeEnum } from './dto';
import {
  getRemainingAllocatableAmount,
  isAllocationWithinSourceExpense,
} from './cost-allocation.util';

const COST_CENTER_SELECT = {
  id: true,
  companyId: true,
  name: true,
  code: true,
  scopeType: true,
  scopeReference: true,
  startDate: true,
  endDate: true,
  isActive: true,
} satisfies Prisma.CostCenterSelect;

const EXPENSE_CATEGORY_SELECT = {
  id: true,
  name: true,
  code: true,
  requiresPerson: true,
  isActive: true,
} satisfies Prisma.ExpenseCategorySelect;

const EXPENSE_PERSON_SELECT = {
  id: true,
  name: true,
  personType: true,
  status: true,
} satisfies Prisma.CompanyPersonSelect;

const ATTACHMENT_SELECT = {
  id: true,
  fileName: true,
  fileUrl: true,
  filePath: true,
  mimeType: true,
  createdAt: true,
} satisfies Prisma.ExpenseAttachmentSelect;

@Injectable()
export class CostCentersService {
  constructor(private readonly prisma: PrismaService) {}

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

  private normalizeScopeType(dto: CreateCostCenterDto): CostCenterType {
    const candidate = dto.scopeType ?? dto.costCenterType ?? CostCenterTypeEnum.MONTHLY_POOL;
    const normalized = String(candidate).toUpperCase() as CostCenterType;
    if (Object.values(CostCenterType).includes(normalized)) {
      return normalized;
    }
    return CostCenterType.MONTHLY_POOL;
  }

  async listCostCenters(
    companyId: string,
    query: {
      page?: number;
      limit?: number;
      search?: string;
      isActive?: string;
    },
  ) {
    const { skip, take, page, limit } = parsePagination(query);
    const where: Prisma.CostCenterWhereInput = {
      companyId,
      deletedAt: null,
    };

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { code: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    if (query.isActive !== undefined) {
      const isActive = ['true', '1'].includes(String(query.isActive).toLowerCase());
      where.isActive = isActive;
    }

    const [data, total] = await Promise.all([
      this.prisma.costCenter.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.costCenter.count({ where }),
    ]);

    return createPaginatedResult(data, total, page, limit);
  }

  async getCostCenter(companyId: string, id: string) {
    const costCenter = await this.prisma.costCenter.findFirst({
      where: { id, companyId, deletedAt: null },
      select: COST_CENTER_SELECT,
    });

    if (!costCenter) {
      throw new NotFoundException('Cost center not found');
    }

    return costCenter;
  }

  async createCostCenter(companyId: string, dto: CreateCostCenterDto) {
    const company = await this.getCompanyContext(companyId);
    const scopeType = this.normalizeScopeType(dto);

    return this.prisma.costCenter.create({
      data: {
        tenantId: company.tenantId,
        companyId,
        name: dto.name.trim(),
        code: dto.code?.trim() || null,
        scopeType,
        scopeReference: dto.scopeReference?.trim() || null,
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        isActive: dto.isActive ?? true,
      },
      select: COST_CENTER_SELECT,
    });
  }

  async listAllocations(
    companyId: string,
    costCenterId: string,
    query: { page?: number; limit?: number },
  ) {
    const { skip, take, page, limit } = parsePagination(query);

    const costCenter = await this.prisma.costCenter.findFirst({
      where: { id: costCenterId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!costCenter) {
      throw new NotFoundException('Cost center not found');
    }

    const where: Prisma.CostAllocationWhereInput = {
      costCenterId,
      companyId,
    };

    const [data, total] = await Promise.all([
      this.prisma.costAllocation.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          expenseEntry: {
            select: {
              id: true,
              expenseDate: true,
              amount: true,
              status: true,
              category: { select: EXPENSE_CATEGORY_SELECT },
              person: { select: EXPENSE_PERSON_SELECT },
              attachments: { select: ATTACHMENT_SELECT },
            },
          },
        },
      }),
      this.prisma.costAllocation.count({ where }),
    ]);

    return createPaginatedResult(data, total, page, limit);
  }

  async createAllocation(
    companyId: string,
    costCenterId: string,
    dto: CreateCostAllocationDto,
  ) {
    const company = await this.getCompanyContext(companyId);

    const costCenter = await this.prisma.costCenter.findFirst({
      where: { id: costCenterId, companyId, deletedAt: null },
    });
    if (!costCenter) {
      throw new NotFoundException('Cost center not found');
    }

    const expenseEntryId = dto.expenseEntryId ?? dto.expenseId;
    if (!expenseEntryId) {
      throw new BadRequestException('Expense entry is required');
    }

    const expense = await this.prisma.expenseEntry.findFirst({
      where: { id: expenseEntryId, companyId, deletedAt: null },
    });
    if (!expense) {
      throw new BadRequestException('Invalid expense entry');
    }

    const amount = dto.allocatedAmount ?? dto.amount;
    if (!amount || amount <= 0) {
      throw new BadRequestException('Allocation amount is required');
    }

    return this.prisma.$transaction(async (tx) => {
      const allocationSummary = await tx.costAllocation.aggregate({
        where: { companyId, expenseEntryId },
        _sum: { allocatedAmount: true },
      });

      const currentAllocatedAmount = Number(allocationSummary._sum.allocatedAmount ?? 0);
      const sourceExpenseAmount = Number(expense.amount ?? 0);
      const requestedAmount = Number(amount);
      if (
        !isAllocationWithinSourceExpense(
          sourceExpenseAmount,
          currentAllocatedAmount,
          requestedAmount,
        )
      ) {
        const remainingAllocatableAmount = getRemainingAllocatableAmount(
          sourceExpenseAmount,
          currentAllocatedAmount,
        );
        throw new BadRequestException(
          `Allocation exceeds source expense amount. Remaining allocatable: ${remainingAllocatableAmount.toFixed(
            2,
          )}`,
        );
      }

      return tx.costAllocation.create({
        data: {
          tenantId: company.tenantId,
          companyId,
          expenseEntryId,
          costCenterId,
          allocatedAmount: requestedAmount,
          notes: dto.notes ?? null,
        },
        include: {
          expenseEntry: {
            select: {
              id: true,
              expenseDate: true,
              amount: true,
              status: true,
              category: { select: EXPENSE_CATEGORY_SELECT },
              person: { select: EXPENSE_PERSON_SELECT },
              attachments: { select: ATTACHMENT_SELECT },
            },
          },
        },
      });
    });
  }
}
