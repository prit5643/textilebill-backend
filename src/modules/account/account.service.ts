import {
  Injectable,
  NotFoundException,
  Logger,
  ConflictException,
} from '@nestjs/common';
import { AccountGroupType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { CreateBrokerDto, UpdateBrokerDto } from './dto/broker.dto';
import {
  parsePagination,
  createPaginatedResult,
} from '../../common/utils/pagination.util';

type AccountListView = 'default' | 'selector';

const ACCOUNT_LIST_DEFAULT_SELECT = {
  id: true,
  tenantId: true,
  companyId: true,
  group: true,
  openingBalance: true,
  openingBalanceType: true,
  deletedAt: true,
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
} satisfies Prisma.AccountSelect;

const ACCOUNT_LIST_SELECTOR_SELECT = {
  id: true,
  group: true,
  deletedAt: true,
  party: {
    select: {
      id: true,
      name: true,
      city: true,
      bankName: true,
      bankAccountNo: true,
      bankIfsc: true,
    },
  },
} satisfies Prisma.AccountSelect;

const ACCOUNT_DETAIL_SELECT = {
  id: true,
  tenantId: true,
  companyId: true,
  partyId: true,
  searchCode: true,
  group: true,
  gstType: true,
  priceSelection: true,
  openingBalance: true,
  openingBalanceType: true,
  creditLimit: true,
  paymentDays: true,
  partyDiscountRate: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
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
      createdAt: true,
      updatedAt: true,
      deletedAt: true,
    },
  },
} satisfies Prisma.AccountSelect;

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(private readonly prisma: PrismaService) {}

  private getListSelect(view: AccountListView): Prisma.AccountSelect {
    return view === 'selector'
      ? ACCOUNT_LIST_SELECTOR_SELECT
      : ACCOUNT_LIST_DEFAULT_SELECT;
  }

  private resolveAccountGroup(
    rawGroup?: string,
    fallback: AccountGroupType = AccountGroupType.SUNDRY_DEBTORS,
  ): AccountGroupType {
    const normalized = rawGroup?.trim().toUpperCase();
    if (!normalized) {
      return fallback;
    }

    if (
      Object.values(AccountGroupType).includes(normalized as AccountGroupType)
    ) {
      return normalized as AccountGroupType;
    }

    return fallback;
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

  async createAccount(companyId: string, dto: CreateAccountDto) {
    const company = await this.getCompanyContext(companyId);
    const group = this.resolveAccountGroup(dto.groupId);

    const created = await this.prisma.$transaction(async (tx) => {
      const party = await tx.party.create({
        data: {
          tenantId: company.tenantId,
          name: dto.name.trim(),
          gstin: dto.gstin?.trim().toUpperCase(),
          phone: dto.phone?.trim(),
          email: dto.email?.trim().toLowerCase(),
          address: dto.address?.trim(),
          city: dto.city?.trim(),
          state: dto.state?.trim(),
          pincode: dto.pincode?.trim(),
          contactPerson: dto.contactPerson?.trim(),
          bankName: dto.bankName?.trim(),
          bankAccountNo: dto.bankAccountNo?.trim(),
          bankIfsc: dto.bankIfsc?.trim().toUpperCase(),
        },
      });

      return tx.account.create({
        data: {
          tenantId: company.tenantId,
          companyId: company.id,
          partyId: party.id,
          searchCode: dto.searchCode?.trim(),
          group,
          gstType: dto.gstType,
          priceSelection: dto.priceSelection?.trim(),
          openingBalance: dto.openingBalance ?? 0,
          openingBalanceType: dto.openingBalanceType?.trim(),
          creditLimit: dto.creditLimit,
          paymentDays: dto.paymentDays,
          partyDiscountRate: dto.partyDiscountRate,
        },
        select: ACCOUNT_DETAIL_SELECT,
      });
    });

    this.logger.log(`Account created: ${created.id} (${created.party.name})`);
    return created;
  }

  async findAllAccounts(
    companyId: string,
    options?: {
      page?: number;
      limit?: number;
      search?: string;
      groupId?: string;
      isActive?: boolean;
      view?: AccountListView;
    },
  ) {
    const { skip, take, page, limit } = parsePagination({
      page: options?.page,
      limit: options?.limit,
    });

    const where: Prisma.AccountWhereInput = { companyId };

    if (options?.search) {
      where.OR = [
        {
          party: {
            name: { contains: options.search, mode: 'insensitive' },
          },
        },
        {
          party: {
            gstin: { contains: options.search, mode: 'insensitive' },
          },
        },
        {
          party: {
            phone: { contains: options.search, mode: 'insensitive' },
          },
        },
      ];
    }

    if (options?.groupId) {
      where.group = this.resolveAccountGroup(options.groupId);
    }

    if (options?.isActive === true) {
      where.deletedAt = null;
    } else if (options?.isActive === false) {
      where.deletedAt = { not: null };
    } else {
      where.deletedAt = null;
    }

    const [data, total] = await Promise.all([
      this.prisma.account.findMany({
        where,
        skip,
        take,
        orderBy: {
          party: {
            name: 'asc',
          },
        },
        select: this.getListSelect(options?.view ?? 'default'),
      }),
      this.prisma.account.count({ where }),
    ]);

    return createPaginatedResult(data, total, page, limit);
  }

  async findAccountById(id: string, companyId: string) {
    const account = await this.prisma.account.findFirst({
      where: { id, companyId },
      select: ACCOUNT_DETAIL_SELECT,
    });
    if (!account) throw new NotFoundException('Account not found');
    return account;
  }

  async updateAccount(id: string, companyId: string, dto: UpdateAccountDto) {
    const account = await this.findAccountById(id, companyId);

    const partyPatch: Prisma.PartyUpdateInput = {};
    if (typeof dto.name === 'string') partyPatch.name = dto.name.trim();
    if (typeof dto.gstin === 'string')
      partyPatch.gstin = dto.gstin.trim().toUpperCase();
    if (typeof dto.phone === 'string') partyPatch.phone = dto.phone.trim();
    if (typeof dto.email === 'string')
      partyPatch.email = dto.email.trim().toLowerCase();
    if (typeof dto.address === 'string')
      partyPatch.address = dto.address.trim();
    if (typeof dto.city === 'string') partyPatch.city = dto.city.trim();
    if (typeof dto.state === 'string') partyPatch.state = dto.state.trim();
    if (typeof dto.pincode === 'string')
      partyPatch.pincode = dto.pincode.trim();
    if (typeof dto.contactPerson === 'string') {
      partyPatch.contactPerson = dto.contactPerson.trim();
    }
    if (typeof dto.bankName === 'string')
      partyPatch.bankName = dto.bankName.trim();
    if (typeof dto.bankAccountNo === 'string') {
      partyPatch.bankAccountNo = dto.bankAccountNo.trim();
    }
    if (typeof dto.bankIfsc === 'string') {
      partyPatch.bankIfsc = dto.bankIfsc.trim().toUpperCase();
    }

    const accountPatch: Prisma.AccountUpdateInput = {};
    if (dto.groupId) {
      accountPatch.group = this.resolveAccountGroup(dto.groupId, account.group);
    }
    if (typeof dto.searchCode === 'string') {
      accountPatch.searchCode = dto.searchCode.trim();
    }
    if (typeof dto.gstType === 'string') {
      accountPatch.gstType = dto.gstType.trim();
    }
    if (typeof dto.priceSelection === 'string') {
      accountPatch.priceSelection = dto.priceSelection.trim();
    }
    if (typeof dto.openingBalance === 'number') {
      accountPatch.openingBalance = dto.openingBalance;
    }
    if (typeof dto.openingBalanceType === 'string') {
      accountPatch.openingBalanceType = dto.openingBalanceType.trim();
    }
    if (typeof dto.creditLimit === 'number') {
      accountPatch.creditLimit = dto.creditLimit;
    }
    if (typeof dto.paymentDays === 'number') {
      accountPatch.paymentDays = dto.paymentDays;
    }
    if (typeof dto.partyDiscountRate === 'number') {
      accountPatch.partyDiscountRate = dto.partyDiscountRate;
    }
    if (dto.isActive === true) {
      accountPatch.deletedAt = null;
    }
    if (dto.isActive === false) {
      accountPatch.deletedAt = new Date();
    }

    return this.prisma.$transaction(async (tx) => {
      if (Object.keys(partyPatch).length > 0) {
        await tx.party.update({
          where: { id: account.partyId },
          data: partyPatch,
        });
      }

      if (Object.keys(accountPatch).length > 0) {
        await tx.account.update({
          where: { id: account.id },
          data: accountPatch,
        });
      }

      const refreshed = await tx.account.findUnique({
        where: { id: account.id },
        select: ACCOUNT_DETAIL_SELECT,
      });
      if (!refreshed) {
        throw new NotFoundException('Account not found');
      }

      return refreshed;
    });
  }

  async removeAccount(id: string, companyId: string) {
    await this.findAccountById(id, companyId);
    return this.prisma.account.update({
      where: { id },
      data: { deletedAt: new Date() },
      select: ACCOUNT_DETAIL_SELECT,
    });
  }

  async removeAccountPermanently(id: string, companyId: string) {
    const account = await this.prisma.account.findFirst({
      where: { id, companyId },
      select: { id: true, partyId: true },
    });
    if (!account) {
      throw new NotFoundException('Account not found');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const deleted = await tx.account.delete({
          where: { id: account.id },
        });

        const remainingAccounts = await tx.account.count({
          where: { partyId: account.partyId },
        });

        if (remainingAccounts === 0) {
          await tx.party.delete({
            where: { id: account.partyId },
          });
        }

        return deleted;
      });
    } catch (err: any) {
      if (err?.code === 'P2003') {
        throw new ConflictException(
          'This account is linked to existing transactions and cannot be permanently deleted.',
        );
      }
      throw err;
    }
  }

  // Broker model was removed in schema v2; keep endpoints explicit and safe.
  async createBroker(companyId: string, dto: CreateBrokerDto) {
    void companyId;
    void dto;
    throw new ConflictException(
      'Broker APIs are deprecated. Use parties/accounts with account groups instead.',
    );
  }

  async findAllBrokers(companyId: string) {
    void companyId;
    return [];
  }

  async findBrokerById(id: string, companyId: string) {
    void id;
    void companyId;
    throw new NotFoundException('Broker not found');
  }

  async updateBroker(id: string, companyId: string, dto: UpdateBrokerDto) {
    void id;
    void companyId;
    void dto;
    throw new ConflictException(
      'Broker APIs are deprecated. Use parties/accounts with account groups instead.',
    );
  }

  async removeBroker(id: string, companyId: string) {
    void id;
    void companyId;
    throw new ConflictException(
      'Broker APIs are deprecated. Use parties/accounts with account groups instead.',
    );
  }

  async findAllGroups() {
    return Object.values(AccountGroupType).map((group) => ({
      id: group,
      name: group.replace(/_/g, ' '),
      value: group,
    }));
  }

  async findGroupById(id: string) {
    const group = Object.values(AccountGroupType).find((value) => value === id);
    if (!group) throw new NotFoundException('Account group not found');
    return {
      id: group,
      name: group.replace(/_/g, ' '),
      value: group,
    };
  }
}
