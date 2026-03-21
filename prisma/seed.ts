import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { encryptSecret } from '../src/common/utils/secret-crypto.util';

const prisma = new PrismaClient();

const BOOTSTRAP_LOCK_ID = 2026031101;

const REQUIRED_ACCOUNT_GROUPS = [
  'Cash-in-Hand',
  'Bank Accounts',
  'Sundry Debtors',
  'Sundry Creditors',
];

const DEMO_DATA_PREFIX = 'bootstrap-demo';
const DEMO_ACCOUNT_COUNT = 50;
const PRODUCT_COUNT_MIN = 15;
const PRODUCT_COUNT_MAX = 15;
const INVOICE_COUNT_MIN = 0;
const INVOICE_COUNT_MAX = 0;
const DEMO_DATA_FABRICS = [
  'Cotton Shirting',
  'Linen Blend',
  'Rayon Print',
  'Silk Satin',
  'Denim Twill',
  'Poplin Dyed',
  'Viscose Weave',
  'Georgette Flow',
  'Poly Knit',
  'Khadi Texture',
  'Chiffon Stripe',
];

function hasEnvVar(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(process.env, name);
}

function getSeedSecretKey(): string {
  return (
    process.env.APP_SECRET_KEY ||
    process.env.JWT_SECRET ||
    'textilebill-default-secret-key'
  );
}

function getCurrentFinancialYear() {
  const now = new Date();
  const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const endYear = startYear + 1;

  return {
    name: `${startYear}-${String(endYear).slice(2)}`,
    startDate: new Date(startYear, 3, 1),
    endDate: new Date(endYear, 2, 31),
  };
}

function padNumber(value: number, size = 2): string {
  return String(value).padStart(size, '0');
}

function toMoney(value: number): string {
  return value.toFixed(2);
}

function toQuantity(value: number): string {
  return value.toFixed(3);
}

function getProductsPerAccount(accountIndex: number): number {
  // Produces values between 10 and 20 (inclusive), deterministic per account.
  return PRODUCT_COUNT_MIN + ((accountIndex * 3 + 8) % (PRODUCT_COUNT_MAX - PRODUCT_COUNT_MIN + 1));
}

function getInvoicesPerAccount(accountIndex: number): number {
  // We only want ~15 invoices TOTAL across all 50 accounts.
  // So distribute 5-10 invoices to the first two accounts, and 0 to the rest.
  if (accountIndex <= 2) {
      return 5 + ((accountIndex * 5 + 1) % 6); // returns 5 to 10
  }
  return 0;
}

function shouldSeedTransactionalDemoData(): boolean {
  const explicit = process.env.BOOTSTRAP_DEMO_TRANSACTION_DATA;
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}

async function acquireLock(): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ locked: boolean }>>(
    `SELECT pg_try_advisory_lock(${BOOTSTRAP_LOCK_ID}) AS locked`,
  );
  return Boolean(rows[0]?.locked);
}

async function releaseLock(): Promise<void> {
  await prisma.$queryRawUnsafe(
    `SELECT pg_advisory_unlock(${BOOTSTRAP_LOCK_ID})`,
  );
}

async function ensureAccountGroups() {
  await prisma.accountGroup.createMany({
    data: REQUIRED_ACCOUNT_GROUPS.map((name) => ({ name, isDefault: true })),
    skipDuplicates: true,
  });
}

async function backfillLegacyUserVerification() {
  await prisma.user.updateMany({
    where: {
      isActive: true,
      passwordChangedAt: { not: null },
      emailVerifiedAt: null,
      phoneVerifiedAt: null,
    },
    data: {
      emailVerifiedAt: new Date(),
    },
  });
}

async function ensureSuperAdmin() {
  const tenantSlug = process.env.BOOTSTRAP_TENANT_SLUG || 'tv-root';
  const tenantName = process.env.BOOTSTRAP_TENANT_NAME || 'TextileBill Root';
  const tenantEmail = process.env.BOOTSTRAP_TENANT_EMAIL || 'root@textilebill.local';

  let superAdmin = await prisma.user.findFirst({
    where: { role: 'SUPER_ADMIN' },
    orderBy: { createdAt: 'asc' },
  });

  if (!superAdmin) {
    const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL;
    const adminUsername = process.env.BOOTSTRAP_ADMIN_USERNAME;
    const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;

    if (!adminEmail || !adminUsername || !adminPassword) {
      throw new Error(
        'SUPER_ADMIN does not exist. Set BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD to bootstrap securely.',
      );
    }

    const tenant =
      (await prisma.tenant.findUnique({
        where: { slug: tenantSlug },
      })) ??
      (await prisma.tenant.create({
        data: {
          name: tenantName,
          slug: tenantSlug,
          email: tenantEmail,
          isActive: true,
        },
      }));

    const emailConflict = await prisma.user.findUnique({
      where: { email: adminEmail },
      select: { id: true, role: true },
    });
    if (emailConflict) {
      throw new Error(
        `Cannot create SUPER_ADMIN. Email already exists (${adminEmail}).`,
      );
    }

    const usernameConflict = await prisma.user.findUnique({
      where: { username: adminUsername },
      select: { id: true, role: true },
    });
    if (usernameConflict) {
      throw new Error(
        `Cannot create SUPER_ADMIN. Username already exists (${adminUsername}).`,
      );
    }

    const passwordHash = await bcrypt.hash(adminPassword, 12);
    superAdmin = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: adminEmail,
        username: adminUsername,
        passwordHash,
        role: 'SUPER_ADMIN',
        firstName: 'System',
        lastName: 'Admin',
        emailVerifiedAt: new Date(),
        isActive: true,
      },
    });
  }

  if (!superAdmin.emailVerifiedAt) {
    superAdmin = await prisma.user.update({
      where: { id: superAdmin.id },
      data: { emailVerifiedAt: new Date() },
    });
  }

  const companyName =
    process.env.BOOTSTRAP_COMPANY_NAME || 'TextileBill Default Company';
  const company = await prisma.company.findFirst({
    where: { tenantId: superAdmin.tenantId },
    orderBy: { createdAt: 'asc' },
  });

  const ensuredCompany =
    company ??
    (await prisma.company.create({
      data: {
        tenantId: superAdmin.tenantId,
        name: companyName,
        state: 'Gujarat',
      },
    }));

  await prisma.userCompanyAccess.createMany({
    data: [
      {
        userId: superAdmin.id,
        companyId: ensuredCompany.id,
      },
    ],
    skipDuplicates: true,
  });

  const financialYear = await prisma.financialYear.findFirst({
    where: { companyId: ensuredCompany.id, isActive: true },
    orderBy: { startDate: 'desc' },
  });

  const ensuredFinancialYear =
    financialYear ??
    (await prisma.financialYear.create({
      data: {
        companyId: ensuredCompany.id,
        ...getCurrentFinancialYear(),
        isActive: true,
      },
    }));

  const existingSettings = await prisma.companySettings.findUnique({
    where: { companyId: ensuredCompany.id },
    select: {
      id: true,
      defaultFinancialYearId: true,
      ewayBillUsername: true,
      ewayBillPassword: true,
      ewayBillPasswordEnc: true,
      einvoiceUsername: true,
      einvoicePassword: true,
      einvoicePasswordEnc: true,
    },
  });

  const secret = getSeedSecretKey();
  const ewayUsernameProvided = hasEnvVar('BOOTSTRAP_EWAYBILL_USERNAME');
  const ewayPasswordProvided = hasEnvVar('BOOTSTRAP_EWAYBILL_PASSWORD');
  const einvoiceUsernameProvided = hasEnvVar('BOOTSTRAP_EINVOICE_USERNAME');
  const einvoicePasswordProvided = hasEnvVar('BOOTSTRAP_EINVOICE_PASSWORD');

  const settingsPatch: Record<string, unknown> = {};

  if (!existingSettings?.defaultFinancialYearId) {
    settingsPatch.defaultFinancialYearId = ensuredFinancialYear.id;
  }

  if (ewayUsernameProvided) {
    const username = process.env.BOOTSTRAP_EWAYBILL_USERNAME?.trim();
    settingsPatch.ewayBillUsername = username || null;
  }

  if (ewayPasswordProvided) {
    const password = process.env.BOOTSTRAP_EWAYBILL_PASSWORD || '';
    settingsPatch.ewayBillPassword = null;
    settingsPatch.ewayBillPasswordEnc = password
      ? encryptSecret(password, secret)
      : null;
  } else if (
    existingSettings?.ewayBillPassword &&
    !existingSettings.ewayBillPasswordEnc
  ) {
    // Backfill legacy plaintext storage into encrypted column during bootstrap.
    settingsPatch.ewayBillPassword = null;
    settingsPatch.ewayBillPasswordEnc = encryptSecret(
      existingSettings.ewayBillPassword,
      secret,
    );
  }

  if (einvoiceUsernameProvided) {
    const username = process.env.BOOTSTRAP_EINVOICE_USERNAME?.trim();
    settingsPatch.einvoiceUsername = username || null;
  }

  if (einvoicePasswordProvided) {
    const password = process.env.BOOTSTRAP_EINVOICE_PASSWORD || '';
    settingsPatch.einvoicePassword = null;
    settingsPatch.einvoicePasswordEnc = password
      ? encryptSecret(password, secret)
      : null;
  } else if (
    existingSettings?.einvoicePassword &&
    !existingSettings.einvoicePasswordEnc
  ) {
    settingsPatch.einvoicePassword = null;
    settingsPatch.einvoicePasswordEnc = encryptSecret(
      existingSettings.einvoicePassword,
      secret,
    );
  }

  if (!existingSettings) {
    await prisma.companySettings.create({
      data: {
        companyId: ensuredCompany.id,
        ...settingsPatch,
      },
    });
  } else if (Object.keys(settingsPatch).length > 0) {
    await prisma.companySettings.update({
      where: { companyId: ensuredCompany.id },
      data: settingsPatch,
    });
  }
}

async function ensureDemoTransactionData() {
  if (!shouldSeedTransactionalDemoData()) {
    console.log(
      '[bootstrap] Skipping transactional demo data (set BOOTSTRAP_DEMO_TRANSACTION_DATA=true to enable).',
    );
    return;
  }

  const superAdmin = await prisma.user.findFirst({
    where: { role: 'SUPER_ADMIN', isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true, tenantId: true },
  });

  if (!superAdmin) {
    console.warn(
      '[bootstrap] Skipping transactional demo data because SUPER_ADMIN was not found.',
    );
    return;
  }

  const company = await prisma.company.findFirst({
    where: { tenantId: superAdmin.tenantId, isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true },
  });

  if (!company) {
    console.warn(
      '[bootstrap] Skipping transactional demo data because no active company was found.',
    );
    return;
  }

  let financialYear = await prisma.financialYear.findFirst({
    where: { companyId: company.id, isActive: true },
    orderBy: { startDate: 'desc' },
    select: { id: true },
  });

  if (!financialYear) {
    financialYear = await prisma.financialYear.create({
      data: {
        companyId: company.id,
        ...getCurrentFinancialYear(),
        isActive: true,
      },
      select: { id: true },
    });
  }

  const debtorGroup = await prisma.accountGroup.findUnique({
    where: { name: 'Sundry Debtors' },
    select: { id: true },
  });

  let totalProducts = 0;
  let totalInvoices = 0;
  let totalInvoiceItems = 0;

  for (let accountIndex = 1; accountIndex <= DEMO_ACCOUNT_COUNT; accountIndex += 1) {
    const accountNo = padNumber(accountIndex);
    const accountId = `${DEMO_DATA_PREFIX}-account-${accountNo}`;
    const accountName = `Demo Account ${accountNo}`;

    const seededAccount = await prisma.account.upsert({
      where: { id: accountId },
      update: {
        companyId: company.id,
        groupId: debtorGroup?.id ?? null,
        name: accountName,
        searchCode: `DA${accountNo}`,
        city: 'Surat',
        state: 'Gujarat',
        country: 'India',
        phone: `+91990000${accountNo}${accountNo}`,
        email: `demo.account${accountNo}@textilebill.local`,
        gstType: 'REGULAR',
        isActive: true,
      },
      create: {
        id: accountId,
        companyId: company.id,
        groupId: debtorGroup?.id ?? null,
        name: accountName,
        searchCode: `DA${accountNo}`,
        city: 'Surat',
        state: 'Gujarat',
        country: 'India',
        phone: `+91990000${accountNo}${accountNo}`,
        email: `demo.account${accountNo}@textilebill.local`,
        gstType: 'REGULAR',
        isActive: true,
      },
    });

    const accountProducts: Array<{ id: string; rate: number; gstRate: number }> = [];
    const productsPerAccount = getProductsPerAccount(accountIndex);

    for (let productIndex = 1; productIndex <= productsPerAccount; productIndex += 1) {
      const productNo = padNumber(productIndex);
      const productId = `${DEMO_DATA_PREFIX}-product-a${accountNo}-p${productNo}`;
      const fabric = DEMO_DATA_FABRICS[(accountIndex + productIndex) % DEMO_DATA_FABRICS.length];
      const baseRate = 220 + accountIndex * 18 + productIndex * 11;
      const gstRate = [5, 12, 18][(accountIndex + productIndex) % 3];

      await prisma.product.upsert({
        where: { id: productId },
        update: {
          companyId: company.id,
          name: `${fabric} A${accountNo}-P${productNo}`,
          searchCode: `PRD-A${accountNo}-P${productNo}`,
          hsnCode: `52${String((accountIndex * 41 + productIndex * 17) % 10000).padStart(4, '0')}`,
          description: `Seeded demo product for ${accountName}`,
          buyingPrice: toMoney(baseRate * 0.82),
          retailPrice: toMoney(baseRate),
          gstRate: toMoney(gstRate),
          type: 'GOODS',
          isActive: true,
        },
        create: {
          id: productId,
          companyId: company.id,
          name: `${fabric} A${accountNo}-P${productNo}`,
          searchCode: `PRD-A${accountNo}-P${productNo}`,
          hsnCode: `52${String((accountIndex * 41 + productIndex * 17) % 10000).padStart(4, '0')}`,
          description: `Seeded demo product for ${accountName}`,
          buyingPrice: toMoney(baseRate * 0.82),
          retailPrice: toMoney(baseRate),
          gstRate: toMoney(gstRate),
          type: 'GOODS',
          isActive: true,
        },
      });

      accountProducts.push({
        id: productId,
        rate: Number(toMoney(baseRate)),
        gstRate,
      });
    }

    totalProducts += productsPerAccount;

    const invoicesPerAccount = getInvoicesPerAccount(accountIndex);

    for (let invoiceIndex = 1; invoiceIndex <= invoicesPerAccount; invoiceIndex += 1) {
      const invoiceNo = padNumber(invoiceIndex, 3);
      const invoiceId = `${DEMO_DATA_PREFIX}-invoice-a${accountNo}-i${invoiceNo}`;
      const invoiceNumber = `SD-A${accountNo}-${invoiceNo}`;
      const invoiceDate = new Date();
      invoiceDate.setDate(
        invoiceDate.getDate() - ((accountIndex * 9 + invoiceIndex * 4) % 120),
      );

      const lineItemCount = 2 + ((accountIndex + invoiceIndex) % 4); // 2..5
      const lineItems: Array<{
        id: string;
        invoiceId: string;
        productId: string;
        description: string;
        quantity: string;
        rate: string;
        amount: string;
        discountAmount: string;
        discountPercent: string;
        taxableAmount: string;
        gstRate: string;
        cgstAmount: string;
        sgstAmount: string;
        igstAmount: string;
        totalAmount: string;
        sortOrder: number;
      }> = [];

      let subtotal = 0;
      let totalDiscount = 0;
      let taxableAmount = 0;
      let totalCgst = 0;
      let totalSgst = 0;
      let totalIgst = 0;

      for (let itemIndex = 0; itemIndex < lineItemCount; itemIndex += 1) {
        const product = accountProducts[
          (accountIndex + invoiceIndex + itemIndex * 2) % accountProducts.length
        ];
        const quantityValue = 1 + ((accountIndex + invoiceIndex + itemIndex) % 6);
        const amountValue = quantityValue * product.rate;
        const discountPercentValue = ((accountIndex + itemIndex) % 3) * 2.5;
        const discountAmountValue = (amountValue * discountPercentValue) / 100;
        const taxableValue = amountValue - discountAmountValue;
        const taxValue = (taxableValue * product.gstRate) / 100;
        const cgstValue = taxValue / 2;
        const sgstValue = taxValue / 2;
        const igstValue = 0;
        const totalValue = taxableValue + taxValue;

        subtotal += amountValue;
        totalDiscount += discountAmountValue;
        taxableAmount += taxableValue;
        totalCgst += cgstValue;
        totalSgst += sgstValue;
        totalIgst += igstValue;

        lineItems.push({
          id: `${invoiceId}-item-${itemIndex + 1}`,
          invoiceId,
          productId: product.id,
          description: `Seeded line item ${itemIndex + 1}`,
          quantity: toQuantity(quantityValue),
          rate: toMoney(product.rate),
          amount: toMoney(amountValue),
          discountAmount: toMoney(discountAmountValue),
          discountPercent: toMoney(discountPercentValue),
          taxableAmount: toMoney(taxableValue),
          gstRate: toMoney(product.gstRate),
          cgstAmount: toMoney(cgstValue),
          sgstAmount: toMoney(sgstValue),
          igstAmount: toMoney(igstValue),
          totalAmount: toMoney(totalValue),
          sortOrder: itemIndex + 1,
        });
      }

      const totalTax = totalCgst + totalSgst + totalIgst;
      const grandBeforeRound = taxableAmount + totalTax;
      const roundedGrandTotal = Math.round(grandBeforeRound);
      const roundOff = roundedGrandTotal - grandBeforeRound;
      const grandTotal = roundedGrandTotal;

      await prisma.$transaction(async (tx) => {
        await tx.invoice.upsert({
          where: { id: invoiceId },
          update: {
            companyId: company.id,
            financialYearId: financialYear.id,
            invoiceType: 'SALE',
            invoiceNumber,
            invoiceDate,
            accountId: seededAccount.id,
            subtotal: toMoney(subtotal),
            totalDiscount: toMoney(totalDiscount),
            taxableAmount: toMoney(taxableAmount),
            totalCgst: toMoney(totalCgst),
            totalSgst: toMoney(totalSgst),
            totalIgst: toMoney(totalIgst),
            totalTax: toMoney(totalTax),
            roundOff: toMoney(roundOff),
            grandTotal: toMoney(grandTotal),
            paidAmount: toMoney(0),
            remainingAmount: toMoney(grandTotal),
            status: 'ACTIVE',
            narration: `Seeded demo sale invoice for ${accountName}`,
            createdById: superAdmin.id,
          },
          create: {
            id: invoiceId,
            companyId: company.id,
            financialYearId: financialYear.id,
            invoiceType: 'SALE',
            invoiceNumber,
            invoiceDate,
            accountId: seededAccount.id,
            subtotal: toMoney(subtotal),
            totalDiscount: toMoney(totalDiscount),
            taxableAmount: toMoney(taxableAmount),
            totalCgst: toMoney(totalCgst),
            totalSgst: toMoney(totalSgst),
            totalIgst: toMoney(totalIgst),
            totalTax: toMoney(totalTax),
            roundOff: toMoney(roundOff),
            grandTotal: toMoney(grandTotal),
            paidAmount: toMoney(0),
            remainingAmount: toMoney(grandTotal),
            status: 'ACTIVE',
            narration: `Seeded demo sale invoice for ${accountName}`,
            createdById: superAdmin.id,
          },
        });

        await tx.invoiceItem.deleteMany({
          where: { invoiceId },
        });

        if (lineItems.length > 0) {
          await tx.invoiceItem.createMany({
            data: lineItems,
          });
        }
      });

      totalInvoices += 1;
      totalInvoiceItems += lineItems.length;
    }
  }

  console.log(
    `[bootstrap] Transactional demo data ready: ${DEMO_ACCOUNT_COUNT} accounts, ${totalProducts} products, ${totalInvoices} invoices, ${totalInvoiceItems} invoice items.`,
  );
}

async function main() {
  const lockAcquired = await acquireLock();
  if (!lockAcquired) {
    console.log(
      '[bootstrap] Another bootstrap process is already running. Skipping this run.',
    );
    return;
  }

  try {
    await ensureAccountGroups();
    await ensureSuperAdmin();
    await backfillLegacyUserVerification();
    await ensureDemoTransactionData();
    console.log('[bootstrap] Default data bootstrap completed successfully.');
  } finally {
    await releaseLock();
  }
}

main()
  .catch((error) => {
    console.error('[bootstrap] Default data bootstrap failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
