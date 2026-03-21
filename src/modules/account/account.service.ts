import {
  Injectable,
  NotFoundException,
  Logger,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
  companyId: true,
  name: true,
  gstin: true,
  city: true,
  phone: true,
  openingBalance: true,
  openingBalanceType: true,
  isActive: true,
  group: {
    select: {
      id: true,
      name: true,
    },
  },
} satisfies Prisma.AccountSelect;

const ACCOUNT_LIST_SELECTOR_SELECT = {
  id: true,
  name: true,
  city: true,
  isActive: true,
} satisfies Prisma.AccountSelect;

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════
  // ACCOUNTS (parties — customers / suppliers)
  // ═══════════════════════════════════════════════════

  private getListSelect(view: AccountListView): Prisma.AccountSelect {
    return view === 'selector'
      ? ACCOUNT_LIST_SELECTOR_SELECT
      : ACCOUNT_LIST_DEFAULT_SELECT;
  }

  async createAccount(companyId: string, dto: CreateAccountDto) {
    const account = await this.prisma.account.create({
      data: {
        companyId,
        name: dto.name,
        searchCode: dto.searchCode,
        groupId: dto.groupId,
        gstin: dto.gstin,
        gstType: dto.gstType as any,
        priceSelection: dto.priceSelection,
        address: dto.address,
        city: dto.city,
        state: dto.state ?? 'Gujarat',
        country: dto.country ?? 'India',
        pincode: dto.pincode,
        shippingAddress: dto.shippingAddress,
        shippingCity: dto.shippingCity,
        shippingState: dto.shippingState,
        shippingPincode: dto.shippingPincode,
        contactPerson: dto.contactPerson,
        phone: dto.phone,
        email: dto.email,
        pan: dto.pan,
        aadhar: dto.aadhar,
        brokerId: dto.brokerId,
        openingBalance: dto.openingBalance,
        openingBalanceType: dto.openingBalanceType ?? 'DR',
        openingBalanceRemark: dto.openingBalanceRemark,
        creditLimit: dto.creditLimit,
        paymentDays: dto.paymentDays,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
        marriageAnniversary: dto.marriageAnniversary
          ? new Date(dto.marriageAnniversary)
          : undefined,
        bankName: dto.bankName,
        bankAccountNo: dto.bankAccountNo,
        bankAccountType: dto.bankAccountType,
        bankIfsc: dto.bankIfsc,
        bankBranch: dto.bankBranch,
        defaultInvoiceType: dto.defaultInvoiceType,
        partyDiscountRate: dto.partyDiscountRate,
      },
      include: { group: true, broker: true },
    });

    this.logger.log(`Account created: ${account.name} (${account.id})`);
    return account;
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

    const where: any = { companyId };
    if (options?.search) {
      where.OR = [
        { name: { contains: options.search, mode: 'insensitive' } },
        { searchCode: { contains: options.search, mode: 'insensitive' } },
        { gstin: { contains: options.search, mode: 'insensitive' } },
        { phone: { contains: options.search, mode: 'insensitive' } },
        { city: { contains: options.search, mode: 'insensitive' } },
      ];
    }
    if (options?.groupId) where.groupId = options.groupId;
    if (options?.isActive !== undefined) where.isActive = options.isActive;

    const [data, total] = await Promise.all([
      this.prisma.account.findMany({
        where,
        skip,
        take,
        orderBy: { name: 'asc' },
        select: this.getListSelect(options?.view ?? 'default'),
      }),
      this.prisma.account.count({ where }),
    ]);

    return createPaginatedResult(data, total, page, limit);
  }

  async findAccountById(id: string, companyId: string) {
    const account = await this.prisma.account.findFirst({
      where: { id, companyId },
      include: { group: true, broker: true },
    });
    if (!account) throw new NotFoundException('Account not found');
    return account;
  }

  async updateAccount(id: string, companyId: string, dto: UpdateAccountDto) {
    await this.findAccountById(id, companyId);

    const data: any = { ...dto };
    if (dto.dateOfBirth) data.dateOfBirth = new Date(dto.dateOfBirth);
    if (dto.marriageAnniversary)
      data.marriageAnniversary = new Date(dto.marriageAnniversary);

    return this.prisma.account.update({
      where: { id },
      data,
      include: { group: true, broker: true },
    });
  }

  async removeAccount(id: string, companyId: string) {
    await this.findAccountById(id, companyId);
    return this.prisma.account.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async removeAccountPermanently(id: string, companyId: string) {
    await this.findAccountById(id, companyId);

    try {
      return await this.prisma.account.delete({
        where: { id },
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

  // ═══════════════════════════════════════════════════
  // BROKERS
  // ═══════════════════════════════════════════════════

  async createBroker(companyId: string, dto: CreateBrokerDto) {
    return this.prisma.broker.create({
      data: {
        companyId,
        name: dto.name,
        phone: dto.phone,
        email: dto.email,
        marginRate: dto.marginRate,
      },
    });
  }

  async findAllBrokers(companyId: string) {
    return this.prisma.broker.findMany({
      where: { companyId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { accounts: true, invoices: true } } },
    });
  }

  async findBrokerById(id: string, companyId: string) {
    const broker = await this.prisma.broker.findFirst({
      where: { id, companyId },
    });
    if (!broker) throw new NotFoundException('Broker not found');
    return broker;
  }

  async updateBroker(id: string, companyId: string, dto: UpdateBrokerDto) {
    await this.findBrokerById(id, companyId);
    return this.prisma.broker.update({
      where: { id },
      data: dto as any,
    });
  }

  async removeBroker(id: string, companyId: string) {
    await this.findBrokerById(id, companyId);
    return this.prisma.broker.update({
      where: { id },
      data: { isActive: false },
    });
  }

  // ═══════════════════════════════════════════════════
  // ACCOUNT GROUPS (read-only tree from seed)
  // ═══════════════════════════════════════════════════

  async findAllGroups() {
    return this.prisma.accountGroup.findMany({
      where: { parentId: null },
      orderBy: { name: 'asc' },
      include: {
        children: {
          orderBy: { name: 'asc' },
          include: {
            children: { orderBy: { name: 'asc' } },
          },
        },
      },
    });
  }

  async findGroupById(id: string) {
    const group = await this.prisma.accountGroup.findUnique({
      where: { id },
      include: {
        children: { orderBy: { name: 'asc' } },
        accounts: { take: 10, orderBy: { name: 'asc' } },
      },
    });
    if (!group) throw new NotFoundException('Account group not found');
    return group;
  }
}
