import {
  AccountGroupType,
  InvoiceStatus,
  InvoiceType,
  MovementType,
  PrismaClient,
  UserRole,
  VoucherType,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();
const BOOTSTRAP_LOCK_ID = 2026032801;

function getCurrentFinancialYearRange() {
  const now = new Date();
  const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const endYear = startYear + 1;
  return {
    startDate: new Date(startYear, 3, 1),
    endDate: new Date(endYear, 2, 31),
  };
}

function isDemoDataEnabled() {
  const explicit = process.env.BOOTSTRAP_DEMO_TRANSACTION_DATA;
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}

async function acquireLock() {
  const rows = await prisma.$queryRawUnsafe<Array<{ locked: boolean }>>(
    `SELECT pg_try_advisory_lock(${BOOTSTRAP_LOCK_ID}) AS locked`,
  );
  return Boolean(rows[0]?.locked);
}

async function releaseLock() {
  await prisma.$queryRawUnsafe(`SELECT pg_advisory_unlock(${BOOTSTRAP_LOCK_ID})`);
}

async function ensureBootstrapTenant() {
  const tenantName = process.env.BOOTSTRAP_TENANT_NAME ?? 'TextileBill Root';
  const tenantSlug = process.env.BOOTSTRAP_TENANT_SLUG ?? 'tv-root';
  const companyName =
    process.env.BOOTSTRAP_COMPANY_NAME ?? 'TextileBill Default Company';

  const tenant =
    (await prisma.tenant.findUnique({
      where: { slug: tenantSlug },
    })) ??
    (await prisma.tenant.create({
      data: { name: tenantName, slug: tenantSlug },
    }));

  const company =
    (await prisma.company.findFirst({
      where: { tenantId: tenant.id, name: companyName, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    })) ??
    (await prisma.company.create({
      data: {
        tenantId: tenant.id,
        name: companyName,
      },
    }));

  return { tenant, company };
}

async function ensureOwnerUser(tenantId: string, companyId: string) {
  const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL ?? 'root@textilebill.local';
  const adminName = process.env.BOOTSTRAP_ADMIN_NAME ?? 'System Owner';
  const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? 'ChangeMe@123';
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  const existing = await prisma.user.findFirst({
    where: {
      tenantId,
      email: adminEmail,
      deletedAt: null,
    },
    orderBy: { createdAt: 'asc' },
  });

  const user =
    (existing &&
      (await prisma.user.update({
        where: { id: existing.id },
        data: {
          name: adminName,
          passwordHash,
          status: 'ACTIVE',
          deletedAt: null,
        },
      }))) ||
    (await prisma.user.create({
      data: {
        tenantId,
        email: adminEmail,
        passwordHash,
        name: adminName,
        status: 'ACTIVE',
      },
    }));

  await prisma.userCompany.upsert({
    where: {
      userId_companyId: {
        userId: user.id,
        companyId,
      },
    },
    update: {
      role: UserRole.OWNER,
    },
    create: {
      tenantId,
      userId: user.id,
      companyId,
      role: UserRole.OWNER,
    },
  });

  return user;
}

async function ensureFinancialYear(tenantId: string, companyId: string) {
  const range = getCurrentFinancialYearRange();
  return prisma.financialYear.upsert({
    where: {
      companyId_startDate_endDate: {
        companyId,
        startDate: range.startDate,
        endDate: range.endDate,
      },
    },
    update: {},
    create: {
      tenantId,
      companyId,
      startDate: range.startDate,
      endDate: range.endDate,
      isLocked: false,
    },
  });
}

async function ensureVoucherSequences(
  tenantId: string,
  companyId: string,
  financialYearId: string,
) {
  for (const type of Object.values(VoucherType)) {
    const prefix = `${type.slice(0, 3).toUpperCase()}-`;
    await prisma.voucherSequence.upsert({
      where: {
        companyId_financialYearId_type: {
          companyId,
          financialYearId,
          type,
        },
      },
      update: {},
      create: {
        tenantId,
        companyId,
        financialYearId,
        type,
        prefix,
        currentValue: 0,
      },
    });
  }
}

async function ensureBaseProducts(tenantId: string, companyId: string) {
  const items = [
    {
      id: 'bootstrap-product-cotton',
      name: 'Cotton Shirting',
      sku: 'COTTON-SHIRT-01',
      unit: 'MTR',
      price: '220.00',
      taxRate: '5.00',
      hsnCode: '5208',
    },
    {
      id: 'bootstrap-product-linen',
      name: 'Linen Blend',
      sku: 'LINEN-BLEND-01',
      unit: 'MTR',
      price: '340.00',
      taxRate: '12.00',
      hsnCode: '5515',
    },
  ];

  for (const item of items) {
    await prisma.product.upsert({
      where: { id: item.id },
      update: {
        tenantId,
        companyId,
        name: item.name,
        sku: item.sku,
        unit: item.unit,
        price: item.price,
        taxRate: item.taxRate,
        hsnCode: item.hsnCode,
        deletedAt: null,
      },
      create: {
        id: item.id,
        tenantId,
        companyId,
        name: item.name,
        sku: item.sku,
        unit: item.unit,
        price: item.price,
        taxRate: item.taxRate,
        hsnCode: item.hsnCode,
      },
    });
  }
}

async function ensureDemoPartyAndAccount(tenantId: string, companyId: string) {
  const party = await prisma.party.upsert({
    where: { id: 'bootstrap-party-customer-1' },
    update: {
      tenantId,
      name: 'Demo Customer',
      gstin: '24ABCDE1234F1Z5',
      phone: '+919999999999',
      email: 'customer.demo@textilebill.local',
      address: 'Ring Road, Surat',
      deletedAt: null,
    },
    create: {
      id: 'bootstrap-party-customer-1',
      tenantId,
      name: 'Demo Customer',
      gstin: '24ABCDE1234F1Z5',
      phone: '+919999999999',
      email: 'customer.demo@textilebill.local',
      address: 'Ring Road, Surat',
    },
  });

  const account = await prisma.account.upsert({
    where: { id: 'bootstrap-account-customer-1' },
    update: {
      tenantId,
      companyId,
      partyId: party.id,
      group: AccountGroupType.SUNDRY_DEBTORS,
      openingBalance: 0,
      deletedAt: null,
    },
    create: {
      id: 'bootstrap-account-customer-1',
      tenantId,
      companyId,
      partyId: party.id,
      group: AccountGroupType.SUNDRY_DEBTORS,
      openingBalance: 0,
    },
  });

  return { party, account };
}

async function ensureDemoInvoiceData(
  tenantId: string,
  companyId: string,
  financialYearId: string,
  accountId: string,
) {
  if (!isDemoDataEnabled()) {
    console.log(
      '[bootstrap] Skipping demo invoice data. Set BOOTSTRAP_DEMO_TRANSACTION_DATA=true to enable.',
    );
    return;
  }

  const cotton = await prisma.product.findUnique({
    where: { id: 'bootstrap-product-cotton' },
    select: { id: true, price: true, taxRate: true },
  });
  const linen = await prisma.product.findUnique({
    where: { id: 'bootstrap-product-linen' },
    select: { id: true, price: true, taxRate: true },
  });

  if (!cotton || !linen) {
    console.log('[bootstrap] Demo products missing, skipping invoice bootstrap.');
    return;
  }

  const lineItems = [
    { id: 'bootstrap-inv-item-1', product: cotton, quantity: 10 },
    { id: 'bootstrap-inv-item-2', product: linen, quantity: 5 },
  ];

  const computed = lineItems.map((item) => {
    const amount = Number(item.product.price) * item.quantity;
    const taxAmount = (amount * Number(item.product.taxRate)) / 100;
    return {
      ...item,
      amount,
      taxAmount,
    };
  });

  const subTotal = computed.reduce((sum, item) => sum + item.amount, 0);
  const totalTax = computed.reduce((sum, item) => sum + item.taxAmount, 0);
  const totalAmount = subTotal + totalTax;
  const invoiceDate = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.invoice.upsert({
      where: { id: 'bootstrap-invoice-sale-1' },
      update: {
        tenantId,
        companyId,
        accountId,
        financialYearId,
        invoiceNumber: 'SALE-0001',
        invoiceDate,
        type: InvoiceType.SALE,
        status: InvoiceStatus.ACTIVE,
        version: 1,
        isLatest: true,
        subTotal,
        taxAmount: totalTax,
        discountAmount: 0,
        totalAmount,
        deletedAt: null,
      },
      create: {
        id: 'bootstrap-invoice-sale-1',
        tenantId,
        companyId,
        accountId,
        financialYearId,
        invoiceNumber: 'SALE-0001',
        invoiceDate,
        type: InvoiceType.SALE,
        status: InvoiceStatus.ACTIVE,
        version: 1,
        isLatest: true,
        subTotal,
        taxAmount: totalTax,
        discountAmount: 0,
        totalAmount,
      },
    });

    await tx.invoiceItem.deleteMany({
      where: { invoiceId: 'bootstrap-invoice-sale-1' },
    });

    await tx.invoiceItem.createMany({
      data: computed.map((item) => ({
        id: item.id,
        tenantId,
        companyId,
        invoiceId: 'bootstrap-invoice-sale-1',
        productId: item.product.id,
        quantity: item.quantity,
        rate: item.product.price,
        taxRate: item.product.taxRate,
        taxAmount: item.taxAmount,
        amount: item.amount,
      })),
    });

    await tx.stockMovement.deleteMany({
      where: { invoiceId: 'bootstrap-invoice-sale-1' },
    });

    await tx.stockMovement.createMany({
      data: computed.map((item, index) => ({
        id: `bootstrap-stock-move-${index + 1}`,
        tenantId,
        companyId,
        productId: item.product.id,
        invoiceId: 'bootstrap-invoice-sale-1',
        type: MovementType.OUT,
        quantity: item.quantity,
        date: invoiceDate,
        notes: 'Bootstrap seeded sale movement',
      })),
    });
  });

  console.log('[bootstrap] Demo invoice + invoice items + stock movements ready.');
}

async function main() {
  const lockAcquired = await acquireLock();
  if (!lockAcquired) {
    console.log('[bootstrap] Another bootstrap process is running. Skipping.');
    return;
  }

  try {
    const { tenant, company } = await ensureBootstrapTenant();
    const user = await ensureOwnerUser(tenant.id, company.id);
    const financialYear = await ensureFinancialYear(tenant.id, company.id);
    await ensureVoucherSequences(tenant.id, company.id, financialYear.id);
    await ensureBaseProducts(tenant.id, company.id);
    const { account } = await ensureDemoPartyAndAccount(tenant.id, company.id);
    await ensureDemoInvoiceData(
      tenant.id,
      company.id,
      financialYear.id,
      account.id,
    );

    console.log('[bootstrap] Bootstrap completed successfully.');
    console.log(`[bootstrap] tenant=${tenant.id} company=${company.id} user=${user.id}`);
  } finally {
    await releaseLock();
  }
}

main()
  .catch((error) => {
    console.error('[bootstrap] Failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
