import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountGroupType,
  EntityStatus,
  Prisma,
  SalaryAdvanceStatus,
  ReimbursementSettlementMode,
  ReimbursementStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  parsePagination,
  createPaginatedResult,
} from '../../common/utils/pagination.util';
import {
  CreateSalaryAdvanceDto,
  CreateSalaryProfileDto,
  MarkSalarySettlementPaidDto,
  RunSalarySettlementDto,
  SalarySettlementAdjustmentDto,
} from './dto';

const PERSON_SELECT = {
  id: true,
  name: true,
  personType: true,
  status: true,
} satisfies Prisma.CompanyPersonSelect;

@Injectable()
export class PayrollService {
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

  private formatMoney(value: number) {
    return Number(value || 0).toFixed(2);
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

  private getMonthRange(year: number, month: number) {
    const start = new Date(year, month - 1, 1);
    const endExclusive = new Date(year, month, 1);
    return { start, endExclusive };
  }

  private buildAdjustmentMap(adjustments?: SalarySettlementAdjustmentDto[]) {
    const map = new Map<string, { amount: number; note?: string }>();
    for (const entry of adjustments ?? []) {
      map.set(entry.personId, {
        amount: Number(entry.adjustments || 0),
        note: entry.adjustmentNote,
      });
    }
    return map;
  }

  async listSalaryProfiles(
    companyId: string,
    query: {
      page?: number;
      limit?: number;
      search?: string;
      isActive?: string;
    },
  ) {
    const { skip, take, page, limit } = parsePagination(query);
    const where: Prisma.SalaryProfileWhereInput = {
      companyId,
      deletedAt: null,
    };

    if (query.search) {
      where.person = { name: { contains: query.search, mode: 'insensitive' } };
    }

    if (query.isActive !== undefined) {
      const isActive = ['true', '1'].includes(
        String(query.isActive).toLowerCase(),
      );
      where.isActive = isActive;
    }

    const [data, total] = await Promise.all([
      this.prisma.salaryProfile.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: { person: { select: PERSON_SELECT } },
      }),
      this.prisma.salaryProfile.count({ where }),
    ]);

    return createPaginatedResult(data, total, page, limit);
  }

  async createSalaryProfile(companyId: string, dto: CreateSalaryProfileDto) {
    const company = await this.getCompanyContext(companyId);

    const monthlyGross = dto.monthlyGross ?? dto.monthlySalary;
    if (!monthlyGross || monthlyGross <= 0) {
      throw new BadRequestException('Monthly salary is required');
    }

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

    const isActive = dto.isActive ?? true;

    if (isActive) {
      await this.prisma.salaryProfile.updateMany({
        where: { companyId, personId: dto.personId, isActive: true },
        data: { isActive: false },
      });
    }

    return this.prisma.salaryProfile.create({
      data: {
        tenantId: company.tenantId,
        companyId,
        personId: dto.personId,
        monthlyGross,
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : null,
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
        isActive,
      },
      include: { person: { select: PERSON_SELECT } },
    });
  }

  async listSalaryAdvances(
    companyId: string,
    query: { page?: number; limit?: number; search?: string },
  ) {
    const { skip, take, page, limit } = parsePagination(query);
    const where: Prisma.SalaryAdvanceWhereInput = {
      companyId,
      deletedAt: null,
    };

    if (query.search) {
      where.OR = [
        { reason: { contains: query.search, mode: 'insensitive' } },
        { person: { name: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.salaryAdvance.findMany({
        where,
        skip,
        take,
        orderBy: { advanceDate: 'desc' },
        include: { person: { select: PERSON_SELECT } },
      }),
      this.prisma.salaryAdvance.count({ where }),
    ]);

    return createPaginatedResult(data, total, page, limit);
  }

  async createSalaryAdvance(companyId: string, dto: CreateSalaryAdvanceDto) {
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

    return this.prisma.salaryAdvance.create({
      data: {
        tenantId: company.tenantId,
        companyId,
        personId: dto.personId,
        amount: dto.amount,
        advanceDate: new Date(dto.advanceDate),
        reason: dto.reason ?? null,
        status: SalaryAdvanceStatus.ACTIVE,
        remainingAmount: dto.amount,
      },
      include: { person: { select: PERSON_SELECT } },
    });
  }

  async runSettlement(companyId: string, dto: RunSalarySettlementDto) {
    const company = await this.getCompanyContext(companyId);
    const { endExclusive } = this.getMonthRange(dto.year, dto.month);
    const adjustmentMap = this.buildAdjustmentMap(dto.adjustments);

    const [profiles, advances, claims, existingSettlementCount] =
      await Promise.all([
        this.prisma.salaryProfile.findMany({
          where: { companyId, deletedAt: null, isActive: true },
          include: { person: { select: PERSON_SELECT } },
        }),
        this.prisma.salaryAdvance.findMany({
          where: {
            companyId,
            deletedAt: null,
            remainingAmount: { gt: 0 },
            status: {
              in: [
                SalaryAdvanceStatus.ACTIVE,
                SalaryAdvanceStatus.PARTIALLY_ADJUSTED,
              ],
            },
            advanceDate: { lt: endExclusive },
          },
          include: { person: { select: PERSON_SELECT } },
          orderBy: { advanceDate: 'asc' },
        }),
        this.prisma.reimbursementClaim.findMany({
          where: {
            companyId,
            deletedAt: null,
            // Pick up both SALARY_ADDITION and CARRY_FORWARD claims for this payroll run
            settlementMode: {
              in: [
                ReimbursementSettlementMode.SALARY_ADDITION,
                ReimbursementSettlementMode.CARRY_FORWARD,
              ],
            },
            settledInSalarySettlementId: null,
            claimDate: { lt: endExclusive },
          },
          include: { person: { select: PERSON_SELECT } },
        }),
        this.prisma.salarySettlement.count({
          where: {
            companyId,
            year: dto.year,
            month: dto.month,
          },
        }),
      ]);

    const profileMap = new Map(
      profiles.map((profile) => [profile.personId, profile]),
    );
    const advancesByPerson = new Map<string, typeof advances>();
    for (const advance of advances) {
      const existing = advancesByPerson.get(advance.personId) ?? [];
      existing.push(advance);
      advancesByPerson.set(advance.personId, existing);
    }

    const claimsByPerson = new Map<string, typeof claims>();
    for (const claim of claims) {
      const existing = claimsByPerson.get(claim.personId) ?? [];
      existing.push(claim);
      claimsByPerson.set(claim.personId, existing);
    }

    const personIds = new Set<string>([
      ...profileMap.keys(),
      ...advancesByPerson.keys(),
      ...claimsByPerson.keys(),
      ...adjustmentMap.keys(),
    ]);
    const warningSet = new Set<string>();
    if (existingSettlementCount > 0) {
      warningSet.add(
        `Settlement records already exist for ${dto.year}-${String(
          dto.month,
        ).padStart(2, '0')}. Finalize will update existing rows.`,
      );
    }

    const lines = Array.from(personIds).map((personId) => {
      const profile = profileMap.get(personId);
      const person =
        profile?.person ?? advancesByPerson.get(personId)?.[0]?.person;
      const personName = person?.name ?? personId;
      const gross = Number(profile?.monthlyGross ?? 0);
      const advancesTotal = (advancesByPerson.get(personId) ?? []).reduce(
        (sum, advance) => sum + Number(advance.remainingAmount),
        0,
      );
      const reimbursementsTotal = (claimsByPerson.get(personId) ?? []).reduce(
        (sum, claim) => sum + Number(claim.amount),
        0,
      );
      const adjustment = adjustmentMap.get(personId)?.amount ?? 0;
      const adjustmentNote = adjustmentMap.get(personId)?.note ?? null;

      const available = gross + reimbursementsTotal + adjustment;
      const advanceDeduction = Math.max(0, Math.min(advancesTotal, available));
      const netPayable = Math.max(
        0,
        gross - advanceDeduction + reimbursementsTotal + adjustment,
      );
      const carryForwardAmount = Math.max(0, advancesTotal - advanceDeduction);

      if (
        !profile &&
        (advancesTotal > 0 || reimbursementsTotal > 0 || adjustment !== 0)
      ) {
        warningSet.add(
          `Missing active salary profile for ${personName}. Gross salary assumed as 0.00.`,
        );
      }
      if (carryForwardAmount > 0) {
        warningSet.add(
          `Carry-forward required for ${personName}: ${this.formatMoney(
            carryForwardAmount,
          )} (advances exceed this cycle deduction).`,
        );
      }
      if (advancesTotal > gross && gross > 0) {
        warningSet.add(
          `Outstanding advances for ${personName} (${this.formatMoney(
            advancesTotal,
          )}) exceed monthly gross (${this.formatMoney(gross)}).`,
        );
      }

      return {
        personId,
        personName: person?.name ?? '-',
        gross,
        advances: advanceDeduction,
        reimbursements: reimbursementsTotal,
        adjustments: adjustment,
        netPayable,
        adjustmentNote,
        carryForwardAmount,
      };
    });

    const totals = lines.reduce(
      (acc, line) => {
        acc.totalNetPayable += line.netPayable;
        acc.totalGross += line.gross;
        acc.totalAdvances += line.advances;
        acc.totalReimbursements += line.reimbursements;
        acc.totalAdjustments += line.adjustments;
        return acc;
      },
      {
        totalNetPayable: 0,
        totalGross: 0,
        totalAdvances: 0,
        totalReimbursements: 0,
        totalAdjustments: 0,
      },
    );

    const preview = {
      monthKey: `${dto.year}-${String(dto.month).padStart(2, '0')}`,
      year: dto.year,
      month: dto.month,
      lines,
      totalNetPayable: totals.totalNetPayable,
      totalGross: totals.totalGross,
      totalAdvances: totals.totalAdvances,
      totalReimbursements: totals.totalReimbursements,
      totalAdjustments: totals.totalAdjustments,
      warnings: Array.from(warningSet),
    };

    if (dto.previewOnly || !dto.finalize) {
      return preview;
    }

    await this.prisma.$transaction(async (tx) => {
      const salaryExpenseAccountId = await this.getOrCreateCompanyAccountByName(
        tx,
        {
          tenantId: company.tenantId,
          companyId,
          group: AccountGroupType.EXPENSE,
          accountName: 'Salary Expense',
        },
      );
      const salaryPayableAccountId = await this.getOrCreateCompanyAccountByName(
        tx,
        {
          tenantId: company.tenantId,
          companyId,
          group: AccountGroupType.SUNDRY_CREDITORS,
          accountName: 'Salary Payable',
        },
      );
      const settlementDate = new Date(dto.year, dto.month, 0);
      const monthKey = `${dto.year}-${String(dto.month).padStart(2, '0')}`;

      for (const line of lines) {
        const settlement = await tx.salarySettlement.upsert({
          where: {
            companyId_personId_year_month: {
              companyId,
              personId: line.personId,
              year: dto.year,
              month: dto.month,
            },
          },
          create: {
            tenantId: company.tenantId,
            companyId,
            personId: line.personId,
            year: dto.year,
            month: dto.month,
            grossSalary: line.gross,
            advanceDeduction: line.advances,
            reimbursementAddition: line.reimbursements,
            otherAdjustments: line.adjustments,
            netPayable: line.netPayable,
            carryForwardAmount: line.carryForwardAmount,
          },
          update: {
            grossSalary: line.gross,
            advanceDeduction: line.advances,
            reimbursementAddition: line.reimbursements,
            otherAdjustments: line.adjustments,
            netPayable: line.netPayable,
            carryForwardAmount: line.carryForwardAmount,
          },
        });

        const accrualTag = `[PAYROLL_SETTLEMENT][SSET:${settlement.id}]`;
        await tx.ledgerEntry.deleteMany({
          where: {
            companyId,
            narration: { contains: accrualTag },
          },
        });

        if (line.netPayable > 0) {
          await tx.ledgerEntry.create({
            data: {
              tenantId: company.tenantId,
              companyId,
              accountId: salaryExpenseAccountId,
              date: settlementDate,
              debit: line.netPayable,
              credit: 0,
              narration: `${accrualTag}[SIDE:DR][MONTH:${monthKey}] person=${line.personName}`,
            },
          });
          await tx.ledgerEntry.create({
            data: {
              tenantId: company.tenantId,
              companyId,
              accountId: salaryPayableAccountId,
              date: settlementDate,
              debit: 0,
              credit: line.netPayable,
              narration: `${accrualTag}[SIDE:CR][MONTH:${monthKey}] person=${line.personName}`,
            },
          });
        }

        let remainingAdvanceToApply = line.advances;
        for (const advance of advancesByPerson.get(line.personId) ?? []) {
          if (remainingAdvanceToApply <= 0) break;
          const availableAmount = Number(advance.remainingAmount);
          const applied = Math.min(availableAmount, remainingAdvanceToApply);
          const newRemaining = availableAmount - applied;
          const newSettledAmount = Number(advance.settledAmount) + applied;

          const nextStatus =
            newRemaining <= 0
              ? SalaryAdvanceStatus.SETTLED
              : newSettledAmount > 0
                ? SalaryAdvanceStatus.PARTIALLY_ADJUSTED
                : SalaryAdvanceStatus.ACTIVE;

          await tx.salaryAdvance.update({
            where: { id: advance.id },
            data: {
              remainingAmount: newRemaining,
              settledAmount: newSettledAmount,
              status: nextStatus,
            },
          });

          remainingAdvanceToApply -= applied;
        }

        for (const claim of claimsByPerson.get(line.personId) ?? []) {
          await tx.reimbursementClaim.update({
            where: { id: claim.id },
            data: {
              settlementMode:
                claim.settlementMode ??
                ReimbursementSettlementMode.SALARY_ADDITION,
              settledInSalarySettlementId: settlement.id,
              settledAt: new Date(),
              status: ReimbursementStatus.SETTLED,
            },
          });
        }
      }
    });

    return preview;
  }

  async listSettlements(
    companyId: string,
    query: { year?: number; month?: number },
  ) {
    const where: Prisma.SalarySettlementWhereInput = {
      companyId,
    };

    if (query.year) {
      where.year = query.year;
    }

    if (query.month) {
      where.month = query.month;
    }

    return this.prisma.salarySettlement.findMany({
      where,
      orderBy: [{ year: 'desc' }, { month: 'desc' }, { createdAt: 'desc' }],
      include: { person: { select: PERSON_SELECT } },
    });
  }

  async markSettlementPaid(
    companyId: string,
    settlementId: string,
    dto: MarkSalarySettlementPaidDto,
  ) {
    const company = await this.getCompanyContext(companyId);
    const settlement = await this.prisma.salarySettlement.findFirst({
      where: { id: settlementId, companyId },
    });
    if (!settlement) {
      throw new NotFoundException('Salary settlement not found');
    }

    const paidAmount = dto.paidAmount ?? Number(settlement.netPayable);
    if (paidAmount < 0) {
      throw new BadRequestException('Paid amount cannot be negative');
    }
    if (paidAmount > Number(settlement.netPayable)) {
      throw new BadRequestException('Paid amount cannot exceed net payable');
    }
    const paidDate = dto.paidDate ? new Date(dto.paidDate) : new Date();
    const monthKey = `${settlement.year}-${String(settlement.month).padStart(2, '0')}`;

    return this.prisma.$transaction(async (tx) => {
      const salaryPayableAccountId = await this.getOrCreateCompanyAccountByName(
        tx,
        {
          tenantId: company.tenantId,
          companyId,
          group: AccountGroupType.SUNDRY_CREDITORS,
          accountName: 'Salary Payable',
        },
      );
      const cashOrBankAccountId = await this.getOrCreateCashOrBankAccountId(
        tx,
        {
          tenantId: company.tenantId,
          companyId,
        },
      );
      const paymentTag = `[PAYROLL_PAYMENT][SSET:${settlement.id}]`;

      await tx.ledgerEntry.deleteMany({
        where: {
          companyId,
          narration: { contains: paymentTag },
        },
      });

      if (paidAmount > 0) {
        await tx.ledgerEntry.create({
          data: {
            tenantId: company.tenantId,
            companyId,
            accountId: salaryPayableAccountId,
            date: paidDate,
            debit: paidAmount,
            credit: 0,
            narration: `${paymentTag}[SIDE:DR][MONTH:${monthKey}] settlement payment`,
          },
        });
        await tx.ledgerEntry.create({
          data: {
            tenantId: company.tenantId,
            companyId,
            accountId: cashOrBankAccountId,
            date: paidDate,
            debit: 0,
            credit: paidAmount,
            narration: `${paymentTag}[SIDE:CR][MONTH:${monthKey}] settlement payment`,
          },
        });
      }

      return tx.salarySettlement.update({
        where: { id: settlementId },
        data: {
          paidAmount,
          paidDate,
        },
        include: { person: { select: PERSON_SELECT } },
      });
    });
  }
}
