import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ExpenseStatus, ExpenseSourceType, EntityStatus } from '@prisma/client';
import { join } from 'path';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { PrismaService } from '../prisma/prisma.service';
import { parsePagination, createPaginatedResult } from '../../common/utils/pagination.util';
import {
  CreateExpenseDto,
  UpdateExpenseDto,
  CreateExpensePersonDto,
  UpdateExpensePersonDto,
  CreateExpenseCategoryDto,
  ExpenseSourceTypeEnum,
  PersonTypeEnum,
} from './dto';
import {
  buildExpenseAttachmentFilename,
  computeExpenseAttachmentHash,
  detectExpenseAttachmentExtension,
  isAllowedExpenseMimeType,
  isValidExpenseAttachmentFilename,
} from './expense-attachment.util';

const DEFAULT_EXPENSE_CATEGORIES = [
  { name: 'Rent', code: 'RENT', requiresPerson: false },
  { name: 'Machine Maintenance', code: 'MAINTENANCE', requiresPerson: false },
  { name: 'Utilities', code: 'UTILITIES', requiresPerson: false },
  { name: 'Transport', code: 'TRANSPORT', requiresPerson: false },
  { name: 'Salary', code: 'SALARY', requiresPerson: true },
  { name: 'Miscellaneous', code: 'MISC', requiresPerson: false },
] as const;

const expenseUploadDir = join(process.cwd(), 'uploads', 'expenses');
if (!existsSync(expenseUploadDir)) {
  mkdirSync(expenseUploadDir, { recursive: true });
}

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

const COST_CENTER_SELECT = {
  id: true,
  name: true,
} satisfies Prisma.CostCenterSelect;

const ATTACHMENT_SELECT = {
  id: true,
  expenseEntryId: true,
  reimbursementClaimId: true,
  fileName: true,
  fileUrl: true,
  filePath: true,
  mimeType: true,
  sizeBytes: true,
  createdAt: true,
} satisfies Prisma.ExpenseAttachmentSelect;

@Injectable()
export class ExpensesService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeOptionalText(value?: string | null): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }

  private normalizeBoolean(value?: string | boolean): boolean | undefined {
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string') return undefined;
    const lowered = value.toLowerCase();
    if (['true', '1', 'yes'].includes(lowered)) return true;
    if (['false', '0', 'no'].includes(lowered)) return false;
    return undefined;
  }

  private normalizeExpenseStatus(value?: string): ExpenseStatus | undefined {
    if (!value) return undefined;
    const normalized = value.toUpperCase() as ExpenseStatus;
    if (Object.values(ExpenseStatus).includes(normalized)) {
      return normalized;
    }
    return undefined;
  }

  private normalizeSourceType(value?: string | null): ExpenseSourceType | undefined {
    if (!value) return undefined;
    const normalized = value.toUpperCase() as ExpenseSourceType;
    if (Object.values(ExpenseSourceType).includes(normalized)) {
      return normalized;
    }
    if (value.toUpperCase() === ExpenseSourceTypeEnum.PERSONAL) {
      return ExpenseSourceType.PERSONAL;
    }
    return undefined;
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

  private async ensureDefaultCategories(companyId: string) {
    const company = await this.getCompanyContext(companyId);
    const existingCount = await this.prisma.expenseCategory.count({
      where: { companyId, deletedAt: null },
    });

    if (existingCount > 0) {
      return;
    }

    await this.prisma.expenseCategory.createMany({
      data: DEFAULT_EXPENSE_CATEGORIES.map((category) => ({
        tenantId: company.tenantId,
        companyId,
        name: category.name,
        code: category.code,
        requiresPerson: category.requiresPerson ?? false,
        isSystem: true,
        isActive: true,
      })),
    });
  }

  async listPeople(
    companyId: string,
    query: {
      page?: number;
      limit?: number;
      search?: string;
      isActive?: string | boolean;
      personType?: string;
    },
  ) {
    const { skip, take, page, limit } = parsePagination(query);
    const where: Prisma.CompanyPersonWhereInput = {
      companyId,
      deletedAt: null,
    };

    if (query.search) {
      where.name = { contains: query.search, mode: 'insensitive' };
    }

    if (query.personType) {
      where.personType = query.personType as any;
    }

    const isActive = this.normalizeBoolean(query.isActive);
    if (isActive !== undefined) {
      where.status = isActive ? EntityStatus.ACTIVE : EntityStatus.INACTIVE;
    }

    const [data, total] = await Promise.all([
      this.prisma.companyPerson.findMany({
        where,
        skip,
        take,
        orderBy: { name: 'asc' },
      }),
      this.prisma.companyPerson.count({ where }),
    ]);

    return createPaginatedResult(data, total, page, limit);
  }

  async createPerson(companyId: string, dto: CreateExpensePersonDto) {
    const company = await this.getCompanyContext(companyId);
    const personType = (dto.personType ?? PersonTypeEnum.WORKER) as any;
    const status = dto.isActive === false ? EntityStatus.INACTIVE : EntityStatus.ACTIVE;

    return this.prisma.companyPerson.create({
      data: {
        tenantId: company.tenantId,
        companyId,
        linkedUserId: dto.linkedUserId ?? null,
        name: dto.name.trim(),
        personType,
        phone: this.normalizeOptionalText(dto.phone),
        status,
      },
    });
  }

  async updatePerson(companyId: string, id: string, dto: UpdateExpensePersonDto) {
    await this.getCompanyContext(companyId);

    const existing = await this.prisma.companyPerson.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException('Person not found');
    }

    return this.prisma.companyPerson.update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name.trim() } : {}),
        ...(dto.personType ? { personType: dto.personType as any } : {}),
        ...(dto.phone !== undefined ? { phone: this.normalizeOptionalText(dto.phone) } : {}),
        ...(dto.isActive !== undefined
          ? { status: dto.isActive ? EntityStatus.ACTIVE : EntityStatus.INACTIVE }
          : {}),
        ...(dto.linkedUserId !== undefined ? { linkedUserId: dto.linkedUserId ?? null } : {}),
      },
    });
  }

  async listCategories(
    companyId: string,
    query: {
      page?: number;
      limit?: number;
      search?: string;
      isActive?: string | boolean;
    },
  ) {
    await this.ensureDefaultCategories(companyId);
    const { skip, take, page, limit } = parsePagination(query);
    const where: Prisma.ExpenseCategoryWhereInput = {
      companyId,
      deletedAt: null,
    };

    if (query.search) {
      where.name = { contains: query.search, mode: 'insensitive' };
    }

    const isActive = this.normalizeBoolean(query.isActive);
    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    const [data, total] = await Promise.all([
      this.prisma.expenseCategory.findMany({
        where,
        skip,
        take,
        orderBy: { name: 'asc' },
      }),
      this.prisma.expenseCategory.count({ where }),
    ]);

    return createPaginatedResult(data, total, page, limit);
  }

  async createCategory(companyId: string, dto: CreateExpenseCategoryDto) {
    const company = await this.getCompanyContext(companyId);

    return this.prisma.expenseCategory.create({
      data: {
        tenantId: company.tenantId,
        companyId,
        name: dto.name.trim(),
        code: this.normalizeOptionalText(dto.code),
        requiresPerson: dto.requiresPerson ?? false,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async listExpenses(
    companyId: string,
    query: {
      page?: number;
      limit?: number;
      search?: string;
      status?: string;
      categoryId?: string;
      personId?: string;
      sourceType?: string;
      hasAttachment?: string | boolean;
      fromDate?: string;
      toDate?: string;
    },
  ) {
    const { skip, take, page, limit } = parsePagination(query);
    const where: Prisma.ExpenseEntryWhereInput = {
      companyId,
      deletedAt: null,
    };

    if (query.search) {
      where.OR = [
        { notes: { contains: query.search, mode: 'insensitive' } },
        { referenceId: { contains: query.search, mode: 'insensitive' } },
        { category: { name: { contains: query.search, mode: 'insensitive' } } },
        { person: { name: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    const status = this.normalizeExpenseStatus(query.status);
    if (status) {
      where.status = status;
    }

    if (query.categoryId) {
      where.categoryId = query.categoryId;
    }

    if (query.personId) {
      where.personId = query.personId;
    }

    const sourceType = this.normalizeSourceType(query.sourceType ?? null);
    if (sourceType) {
      where.sourceType = sourceType;
    }

    if (query.fromDate || query.toDate) {
      where.expenseDate = {};
      if (query.fromDate) {
        where.expenseDate.gte = new Date(query.fromDate);
      }
      if (query.toDate) {
        where.expenseDate.lte = new Date(query.toDate);
      }
    }

    const hasAttachment = this.normalizeBoolean(query.hasAttachment);
    if (hasAttachment === true) {
      where.attachments = { some: {} };
    } else if (hasAttachment === false) {
      where.attachments = { none: {} };
    }

    const [data, total] = await Promise.all([
      this.prisma.expenseEntry.findMany({
        where,
        skip,
        take,
        orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }],
        include: {
          category: { select: EXPENSE_CATEGORY_SELECT },
          person: { select: EXPENSE_PERSON_SELECT },
          costCenter: { select: COST_CENTER_SELECT },
          attachments: { select: ATTACHMENT_SELECT, orderBy: { createdAt: 'desc' } },
        },
      }),
      this.prisma.expenseEntry.count({ where }),
    ]);

    return createPaginatedResult(data, total, page, limit);
  }

  async findExpenseById(companyId: string, id: string) {
    const expense = await this.prisma.expenseEntry.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        category: { select: EXPENSE_CATEGORY_SELECT },
        person: { select: EXPENSE_PERSON_SELECT },
        costCenter: { select: COST_CENTER_SELECT },
        attachments: { select: ATTACHMENT_SELECT, orderBy: { createdAt: 'desc' } },
      },
    });

    if (!expense) {
      throw new NotFoundException('Expense not found');
    }

    return expense;
  }

  async createExpense(companyId: string, userId: string, dto: CreateExpenseDto) {
    const company = await this.getCompanyContext(companyId);
    const category = await this.prisma.expenseCategory.findFirst({
      where: { id: dto.categoryId, companyId, deletedAt: null, isActive: true },
    });

    if (!category) {
      throw new BadRequestException('Invalid expense category');
    }

    if (category.requiresPerson && !dto.personId) {
      throw new BadRequestException('Person is required for this category');
    }

    let personId: string | null = null;
    if (dto.personId) {
      const person = await this.prisma.companyPerson.findFirst({
        where: {
          id: dto.personId,
          companyId,
          deletedAt: null,
          status: EntityStatus.ACTIVE,
        },
      });
      if (!person) {
        throw new BadRequestException('Invalid expense person');
      }
      personId = person.id;
    }

    if (dto.costCenterId) {
      const costCenter = await this.prisma.costCenter.findFirst({
        where: { id: dto.costCenterId, companyId, deletedAt: null },
      });
      if (!costCenter) {
        throw new BadRequestException('Invalid cost center');
      }
    }

    const expenseDate = new Date(dto.date);
    const isBackdated = expenseDate < new Date(new Date().toDateString());
    const status = this.normalizeExpenseStatus(dto.status) ?? ExpenseStatus.DRAFT;
    const sourceType =
      this.normalizeSourceType(dto.sourceType ?? ExpenseSourceTypeEnum.COMPANY_CASH) ??
      ExpenseSourceType.COMPANY_CASH;

    return this.prisma.expenseEntry.create({
      data: {
        tenantId: company.tenantId,
        companyId,
        categoryId: category.id,
        personId,
        costCenterId: dto.costCenterId ?? null,
        expenseDate,
        amount: dto.amount,
        sourceType,
        status,
        notes: this.normalizeOptionalText(dto.notes),
        isBackdated,
        createdById: userId,
      },
      include: {
        category: { select: EXPENSE_CATEGORY_SELECT },
        person: { select: EXPENSE_PERSON_SELECT },
        costCenter: { select: COST_CENTER_SELECT },
        attachments: { select: ATTACHMENT_SELECT },
      },
    });
  }

  async updateExpense(companyId: string, id: string, userId: string, dto: UpdateExpenseDto) {
    const existing = await this.prisma.expenseEntry.findFirst({
      where: { id, companyId, deletedAt: null },
      select: { id: true, categoryId: true },
    });
    if (!existing) {
      throw new NotFoundException('Expense not found');
    }

    let categoryId = existing.categoryId;
    if (dto.categoryId) {
      const category = await this.prisma.expenseCategory.findFirst({
        where: { id: dto.categoryId, companyId, deletedAt: null },
      });
      if (!category) {
        throw new BadRequestException('Invalid expense category');
      }
      categoryId = category.id;
      if (category.requiresPerson && !dto.personId) {
        throw new BadRequestException('Person is required for this category');
      }
    }

    if (dto.personId) {
      const person = await this.prisma.companyPerson.findFirst({
        where: {
          id: dto.personId,
          companyId,
          deletedAt: null,
          status: EntityStatus.ACTIVE,
        },
      });
      if (!person) {
        throw new BadRequestException('Invalid expense person');
      }
    }

    if (dto.costCenterId) {
      const costCenter = await this.prisma.costCenter.findFirst({
        where: { id: dto.costCenterId, companyId, deletedAt: null },
      });
      if (!costCenter) {
        throw new BadRequestException('Invalid cost center');
      }
    }

    const updatedExpenseDate = dto.date ? new Date(dto.date) : undefined;
    const updated = await this.prisma.expenseEntry.update({
      where: { id },
      data: {
        categoryId,
        ...(dto.personId !== undefined ? { personId: dto.personId ?? null } : {}),
        ...(dto.costCenterId !== undefined ? { costCenterId: dto.costCenterId ?? null } : {}),
        ...(updatedExpenseDate ? { expenseDate: updatedExpenseDate } : {}),
        ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
        ...(dto.sourceType
          ? { sourceType: this.normalizeSourceType(dto.sourceType) }
          : {}),
        ...(dto.status
          ? { status: this.normalizeExpenseStatus(dto.status) ?? ExpenseStatus.DRAFT }
          : {}),
        ...(dto.notes !== undefined ? { notes: this.normalizeOptionalText(dto.notes) } : {}),
        ...(updatedExpenseDate
          ? {
              isBackdated:
                updatedExpenseDate < new Date(new Date().toDateString()),
            }
          : {}),
        updatedById: userId,
      },
      include: {
        category: { select: EXPENSE_CATEGORY_SELECT },
        person: { select: EXPENSE_PERSON_SELECT },
        costCenter: { select: COST_CENTER_SELECT },
        attachments: { select: ATTACHMENT_SELECT, orderBy: { createdAt: 'desc' } },
      },
    });

    return updated;
  }

  async submitExpense(companyId: string, id: string, userId: string) {
    const existing = await this.prisma.expenseEntry.findFirst({
      where: { id, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('Expense not found');
    }

    return this.prisma.expenseEntry.update({
      where: { id },
      data: { status: ExpenseStatus.SUBMITTED, updatedById: userId },
      include: {
        category: { select: EXPENSE_CATEGORY_SELECT },
        person: { select: EXPENSE_PERSON_SELECT },
        costCenter: { select: COST_CENTER_SELECT },
        attachments: { select: ATTACHMENT_SELECT },
      },
    });
  }

  async listExpenseAttachments(companyId: string, expenseId: string) {
    await this.findExpenseById(companyId, expenseId);
    return this.prisma.expenseAttachment.findMany({
      where: { expenseEntryId: expenseId, companyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async uploadExpenseAttachment(
    companyId: string,
    expenseId: string,
    userId: string,
    file?: Express.Multer.File,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Attachment file is required');
    }

    if (!isAllowedExpenseMimeType(file.mimetype)) {
      throw new BadRequestException('Unsupported attachment type');
    }

    const expense = await this.findExpenseById(companyId, expenseId);
    const extension = detectExpenseAttachmentExtension(file.buffer);
    if (!extension) {
      throw new BadRequestException('Invalid attachment content');
    }

    const incomingFileHash = computeExpenseAttachmentHash(file.buffer);
    const duplicateCandidates = await this.prisma.expenseAttachment.findMany({
      where: {
        companyId,
        sizeBytes: file.size,
        mimeType: file.mimetype,
      },
      select: {
        id: true,
        expenseEntryId: true,
        fileUrl: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 80,
    });

    for (const candidate of duplicateCandidates) {
      const candidateFilename = candidate.fileUrl?.split('/').pop();
      if (!candidateFilename || !isValidExpenseAttachmentFilename(candidateFilename)) {
        continue;
      }

      const candidatePath = join(expenseUploadDir, candidateFilename);
      if (!existsSync(candidatePath)) {
        continue;
      }

      const candidateBuffer = await readFile(candidatePath);
      const candidateHash = computeExpenseAttachmentHash(candidateBuffer);
      if (candidateHash === incomingFileHash) {
        const duplicateScope =
          candidate.expenseEntryId === expenseId
            ? 'this expense'
            : `expense ${candidate.expenseEntryId?.slice(0, 8) || 'record'}`;
        throw new BadRequestException(
          `Duplicate proof detected. This file already exists for ${duplicateScope}.`,
        );
      }
    }

    const filename = buildExpenseAttachmentFilename(expenseId, extension);
    await writeFile(join(expenseUploadDir, filename), file.buffer);

    const fileUrl = `/uploads/expenses/${filename}`;

    return this.prisma.expenseAttachment.create({
      data: {
        tenantId: expense.tenantId,
        companyId,
        expenseEntryId: expenseId,
        fileName: file.originalname || filename,
        filePath: fileUrl,
        fileUrl,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        createdById: userId,
      },
    });
  }

  async deleteExpenseAttachment(companyId: string, attachmentId: string) {
    const attachment = await this.prisma.expenseAttachment.findFirst({
      where: { id: attachmentId, companyId },
    });
    if (!attachment) {
      throw new NotFoundException('Attachment not found');
    }

    await this.prisma.expenseAttachment.delete({ where: { id: attachment.id } });

    if (attachment.fileUrl?.startsWith('/uploads/expenses/')) {
      const filename = attachment.fileUrl.split('/').pop();
      if (filename) {
        const fullPath = join(expenseUploadDir, filename);
        if (existsSync(fullPath)) {
          try {
            unlinkSync(fullPath);
          } catch {
            // Ignore file delete errors
          }
        }
      }
    }

    return { success: true };
  }
}
