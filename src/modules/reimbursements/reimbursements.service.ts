import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountGroupType,
  EntityStatus,
  Prisma,
  ReimbursementSettlementMode,
  ReimbursementStatus,
} from '@prisma/client';
import { join } from 'path';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { PrismaService } from '../prisma/prisma.service';
import {
  parsePagination,
  createPaginatedResult,
} from '../../common/utils/pagination.util';
import {
  CreateReimbursementClaimDto,
  SettleReimbursementClaimDto,
} from './dto';
import {
  buildExpenseAttachmentFilename,
  computeExpenseAttachmentHash,
  detectExpenseAttachmentExtension,
  isAllowedExpenseMimeType,
  isValidExpenseAttachmentFilename,
} from '../expenses/expense-attachment.util';

const PERSON_SELECT = {
  id: true,
  name: true,
  personType: true,
  status: true,
} satisfies Prisma.CompanyPersonSelect;

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

const expenseUploadDir = join(process.cwd(), 'uploads', 'expenses');
if (!existsSync(expenseUploadDir)) {
  mkdirSync(expenseUploadDir, { recursive: true });
}

@Injectable()
export class ReimbursementsService {
  constructor(private readonly prisma: PrismaService) {}

  private async getOrCreateCompanyAccountByName(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      companyId: string;
      group: AccountGroupType;
      accountName: string;
    },
  ): Promise<string> {
    const existing = await tx.account.findFirst({
      where: {
        companyId: params.companyId,
        group: params.group,
        deletedAt: null,
        party: {
          deletedAt: null,
          name: { equals: params.accountName, mode: 'insensitive' },
        },
      },
      select: { id: true },
    });

    if (existing) {
      return existing.id;
    }

    const party = await tx.party.create({
      data: {
        tenantId: params.tenantId,
        name: params.accountName,
      },
      select: { id: true },
    });

    const account = await tx.account.create({
      data: {
        tenantId: params.tenantId,
        companyId: params.companyId,
        partyId: party.id,
        group: params.group,
        openingBalance: 0,
      },
      select: { id: true },
    });

    return account.id;
  }

  private async getOrCreateCashOrBankAccountId(
    tx: Prisma.TransactionClient,
    params: { tenantId: string; companyId: string },
  ): Promise<string> {
    const preferred = await tx.account.findFirst({
      where: {
        companyId: params.companyId,
        deletedAt: null,
        group: { in: [AccountGroupType.CASH, AccountGroupType.BANK] },
      },
      orderBy: [{ group: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
    });

    if (preferred) {
      return preferred.id;
    }

    return this.getOrCreateCompanyAccountByName(tx, {
      tenantId: params.tenantId,
      companyId: params.companyId,
      group: AccountGroupType.CASH,
      accountName: 'Cash',
    });
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

  private async findClaimById(companyId: string, claimId: string) {
    const claim = await this.prisma.reimbursementClaim.findFirst({
      where: { id: claimId, companyId, deletedAt: null },
      include: {
        person: { select: PERSON_SELECT },
        attachments: {
          select: ATTACHMENT_SELECT,
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!claim) {
      throw new NotFoundException('Reimbursement claim not found');
    }
    return claim;
  }

  async listClaims(
    companyId: string,
    query: {
      page?: number;
      limit?: number;
      status?: string;
      personId?: string;
      fromDate?: string;
      toDate?: string;
    },
  ) {
    const { skip, take, page, limit } = parsePagination(query);
    const where: Prisma.ReimbursementClaimWhereInput = {
      companyId,
      deletedAt: null,
    };

    if (query.status) {
      const normalized = query.status.toUpperCase() as ReimbursementStatus;
      if (Object.values(ReimbursementStatus).includes(normalized)) {
        where.status = normalized;
      }
    }

    if (query.personId) {
      where.personId = query.personId;
    }

    if (query.fromDate || query.toDate) {
      where.claimDate = {};
      if (query.fromDate) {
        where.claimDate.gte = new Date(query.fromDate);
      }
      if (query.toDate) {
        where.claimDate.lte = new Date(query.toDate);
      }
    }

    const [data, total] = await Promise.all([
      this.prisma.reimbursementClaim.findMany({
        where,
        skip,
        take,
        orderBy: { claimDate: 'desc' },
        include: {
          person: { select: PERSON_SELECT },
          attachments: {
            select: ATTACHMENT_SELECT,
            orderBy: { createdAt: 'desc' },
          },
        },
      }),
      this.prisma.reimbursementClaim.count({ where }),
    ]);

    return createPaginatedResult(data, total, page, limit);
  }

  async createClaim(companyId: string, dto: CreateReimbursementClaimDto) {
    const company = await this.getCompanyContext(companyId);

    const person = await this.prisma.companyPerson.findFirst({
      where: {
        id: dto.personId,
        companyId,
        deletedAt: null,
        status: EntityStatus.ACTIVE,
      },
    });

    if (!person) {
      throw new BadRequestException('Invalid person');
    }

    return this.prisma.reimbursementClaim.create({
      data: {
        tenantId: company.tenantId,
        companyId,
        personId: dto.personId,
        claimDate: new Date(dto.claimDate),
        amount: dto.amount,
        status: ReimbursementStatus.SUBMITTED,
        notes: dto.notes ?? null,
      },
      include: {
        person: { select: PERSON_SELECT },
        attachments: { select: ATTACHMENT_SELECT },
      },
    });
  }

  async settleClaim(
    companyId: string,
    claimId: string,
    dto: SettleReimbursementClaimDto,
  ) {
    const company = await this.getCompanyContext(companyId);
    const claim = await this.prisma.reimbursementClaim.findFirst({
      where: { id: claimId, companyId, deletedAt: null },
    });

    if (!claim) {
      throw new NotFoundException('Reimbursement claim not found');
    }

    const settlementMode = dto.settlementMode as ReimbursementSettlementMode;
    if (!Object.values(ReimbursementSettlementMode).includes(settlementMode)) {
      throw new BadRequestException('Invalid settlement mode');
    }

    return this.prisma.$transaction(async (tx) => {
      const paymentTag = `[REIMBURSEMENT_DIRECT_PAYMENT][RCL:${claim.id}]`;
      await tx.ledgerEntry.deleteMany({
        where: {
          companyId,
          narration: { contains: paymentTag },
        },
      });

      if (settlementMode === ReimbursementSettlementMode.DIRECT_PAYMENT) {
        const reimbursementExpenseAccountId =
          await this.getOrCreateCompanyAccountByName(tx, {
            tenantId: company.tenantId,
            companyId,
            group: AccountGroupType.EXPENSE,
            accountName: 'Reimbursement Expense',
          });
        const cashOrBankAccountId = await this.getOrCreateCashOrBankAccountId(
          tx,
          {
            tenantId: company.tenantId,
            companyId,
          },
        );
        const settledAt = new Date();

        await tx.ledgerEntry.create({
          data: {
            tenantId: company.tenantId,
            companyId,
            accountId: reimbursementExpenseAccountId,
            date: settledAt,
            debit: Number(claim.amount),
            credit: 0,
            narration: `${paymentTag}[SIDE:DR] claim direct payment`,
          },
        });
        await tx.ledgerEntry.create({
          data: {
            tenantId: company.tenantId,
            companyId,
            accountId: cashOrBankAccountId,
            date: settledAt,
            debit: 0,
            credit: Number(claim.amount),
            narration: `${paymentTag}[SIDE:CR] claim direct payment`,
          },
        });

        return tx.reimbursementClaim.update({
          where: { id: claim.id },
          data: {
            settlementMode,
            status: ReimbursementStatus.SETTLED,
            settledAt,
          },
          include: {
            person: { select: PERSON_SELECT },
            attachments: { select: ATTACHMENT_SELECT },
          },
        });
      }

      if (settlementMode === ReimbursementSettlementMode.CARRY_FORWARD) {
        // Flag the claim for inclusion in the next payroll salary settlement run.
        // The payroll service reads SUBMITTED claims with settlementMode = CARRY_FORWARD
        // and includes them in the next salary settlement.
        return tx.reimbursementClaim.update({
          where: { id: claim.id },
          data: {
            settlementMode,
            // Keep status as SUBMITTED so payroll runner picks it up,
            // but store the mode so it knows to include it via salary
            status: ReimbursementStatus.SUBMITTED,
            settledAt: null,
            settledInSalarySettlementId: null,
          },
          include: {
            person: { select: PERSON_SELECT },
            attachments: { select: ATTACHMENT_SELECT },
          },
        });
      }

      // Fallback: reset to SUBMITTED with no settlement
      return tx.reimbursementClaim.update({
        where: { id: claim.id },
        data: {
          settlementMode,
          status: ReimbursementStatus.SUBMITTED,
          settledAt: null,
          settledInSalarySettlementId: null,
        },
        include: {
          person: { select: PERSON_SELECT },
          attachments: { select: ATTACHMENT_SELECT },
        },
      });
    });
  }

  async listClaimAttachments(companyId: string, claimId: string) {
    await this.findClaimById(companyId, claimId);
    return this.prisma.expenseAttachment.findMany({
      where: { companyId, reimbursementClaimId: claimId },
      orderBy: { createdAt: 'desc' },
      select: ATTACHMENT_SELECT,
    });
  }

  async uploadClaimAttachment(
    companyId: string,
    claimId: string,
    userId: string,
    file?: Express.Multer.File,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Attachment file is required');
    }

    if (!isAllowedExpenseMimeType(file.mimetype)) {
      throw new BadRequestException('Unsupported attachment type');
    }

    const claim = await this.findClaimById(companyId, claimId);
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
        reimbursementClaimId: true,
        fileUrl: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 80,
    });

    for (const candidate of duplicateCandidates) {
      const candidateFilename = candidate.fileUrl?.split('/').pop();
      if (
        !candidateFilename ||
        !isValidExpenseAttachmentFilename(candidateFilename)
      ) {
        continue;
      }

      const candidatePath = join(expenseUploadDir, candidateFilename);
      if (!existsSync(candidatePath)) {
        continue;
      }

      const candidateBuffer = await readFile(candidatePath);
      const candidateHash = computeExpenseAttachmentHash(candidateBuffer);
      if (candidateHash === incomingFileHash) {
        const duplicateScope = candidate.reimbursementClaimId
          ? candidate.reimbursementClaimId === claimId
            ? 'this reimbursement claim'
            : `claim ${candidate.reimbursementClaimId.slice(0, 8)}`
          : candidate.expenseEntryId
            ? `expense ${candidate.expenseEntryId.slice(0, 8)}`
            : 'another record';

        throw new BadRequestException(
          `Duplicate proof detected. This file already exists for ${duplicateScope}.`,
        );
      }
    }

    const filename = buildExpenseAttachmentFilename(claimId, extension);
    await writeFile(join(expenseUploadDir, filename), file.buffer);
    const fileUrl = `/uploads/expenses/${filename}`;

    return this.prisma.expenseAttachment.create({
      data: {
        tenantId: claim.tenantId,
        companyId,
        reimbursementClaimId: claimId,
        fileName: file.originalname || filename,
        filePath: fileUrl,
        fileUrl,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        createdById: userId,
      },
      select: ATTACHMENT_SELECT,
    });
  }

  async deleteClaimAttachment(companyId: string, attachmentId: string) {
    const attachment = await this.prisma.expenseAttachment.findFirst({
      where: {
        id: attachmentId,
        companyId,
        reimbursementClaimId: { not: null },
      },
      select: ATTACHMENT_SELECT,
    });
    if (!attachment) {
      throw new NotFoundException('Attachment not found');
    }

    await this.prisma.expenseAttachment.delete({
      where: { id: attachment.id },
    });

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
