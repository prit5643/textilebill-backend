const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

const FIXTURES = {
  tenant: {
    id: 'auth-live-tenant',
    slug: 'auth-live-demo',
    name: 'Auth Live Demo',
    email: 'live-owner@textilebill.local',
    city: 'Surat',
    state: 'Gujarat',
  },
  subscriptionId: 'auth-live-subscription',
  companies: {
    primary: {
      id: 'auth-live-company-primary',
      name: 'Auth Live Primary',
      city: 'Surat',
      state: 'Gujarat',
      email: 'primary@textilebill.local',
      productId: 'auth-live-product-primary',
      productName: 'Auth Primary Fabric',
      accountId: 'auth-live-account-primary',
      accountName: 'Auth Primary Debtor',
    },
    secondary: {
      id: 'auth-live-company-secondary',
      name: 'Auth Live Secondary',
      city: 'Ahmedabad',
      state: 'Gujarat',
      email: 'secondary@textilebill.local',
      productId: 'auth-live-product-secondary',
      productName: 'Auth Secondary Fabric',
      accountId: 'auth-live-account-secondary',
      accountName: 'Auth Secondary Debtor',
    },
  },
  users: {
    superAdmin: {
      username: 'live-superadmin',
      email: 'live-superadmin@textilebill.local',
      password: 'Admin@123',
      role: 'SUPER_ADMIN',
      firstName: 'Live',
      lastName: 'Admin',
    },
    owner: {
      username: 'live-owner',
      email: 'live-owner@textilebill.local',
      password: 'Owner@123',
      role: 'TENANT_ADMIN',
      firstName: 'Live',
      lastName: 'Owner',
    },
    staff: {
      username: 'live-staff',
      email: 'live-staff@textilebill.local',
      password: 'User@123',
      role: 'STAFF',
      firstName: 'Live',
      lastName: 'Staff',
    },
  },
};

function getCurrentFinancialYear() {
  const now = new Date();
  const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const endYear = startYear + 1;

  return {
    name: `${startYear}-${String(endYear).slice(2)}`,
    startDate: new Date(startYear, 3, 1),
    endDate: new Date(endYear, 2, 31, 23, 59, 59, 999),
  };
}

async function ensurePlan() {
  return prisma.plan.upsert({
    where: { name: 'monthly' },
    update: {
      displayName: 'Monthly',
      durationDays: 30,
      price: '999.00',
      maxUsers: 10,
      maxCompanies: 5,
      isActive: true,
    },
    create: {
      name: 'monthly',
      displayName: 'Monthly',
      durationDays: 30,
      price: '999.00',
      maxUsers: 10,
      maxCompanies: 5,
      isActive: true,
    },
  });
}

async function ensureTenant() {
  return prisma.tenant.upsert({
    where: { slug: FIXTURES.tenant.slug },
    update: {
      name: FIXTURES.tenant.name,
      email: FIXTURES.tenant.email,
      city: FIXTURES.tenant.city,
      state: FIXTURES.tenant.state,
      isActive: true,
    },
    create: {
      id: FIXTURES.tenant.id,
      name: FIXTURES.tenant.name,
      slug: FIXTURES.tenant.slug,
      email: FIXTURES.tenant.email,
      city: FIXTURES.tenant.city,
      state: FIXTURES.tenant.state,
      isActive: true,
    },
  });
}

async function ensureSubscription(tenantId, planId) {
  const now = new Date();
  const nextYear = new Date(now);
  nextYear.setFullYear(now.getFullYear() + 1);

  return prisma.subscription.upsert({
    where: { id: FIXTURES.subscriptionId },
    update: {
      tenantId,
      planId,
      status: 'ACTIVE',
      startDate: now,
      endDate: nextYear,
      amount: '999.00',
      currency: 'INR',
    },
    create: {
      id: FIXTURES.subscriptionId,
      tenantId,
      planId,
      status: 'ACTIVE',
      startDate: now,
      endDate: nextYear,
      amount: '999.00',
      currency: 'INR',
    },
  });
}

async function ensureCompany(companyFixture, tenantId) {
  const company = await prisma.company.upsert({
    where: { id: companyFixture.id },
    update: {
      tenantId,
      name: companyFixture.name,
      city: companyFixture.city,
      state: companyFixture.state,
      email: companyFixture.email,
      isActive: true,
    },
    create: {
      id: companyFixture.id,
      tenantId,
      name: companyFixture.name,
      city: companyFixture.city,
      state: companyFixture.state,
      email: companyFixture.email,
      isActive: true,
    },
  });

  const financialYearData = getCurrentFinancialYear();
  const financialYear = await prisma.financialYear.upsert({
    where: {
      companyId_name: {
        companyId: company.id,
        name: financialYearData.name,
      },
    },
    update: {
      startDate: financialYearData.startDate,
      endDate: financialYearData.endDate,
      isActive: true,
    },
    create: {
      companyId: company.id,
      name: financialYearData.name,
      startDate: financialYearData.startDate,
      endDate: financialYearData.endDate,
      isActive: true,
    },
  });

  await prisma.companySettings.upsert({
    where: { companyId: company.id },
    update: {
      defaultFinancialYearId: financialYear.id,
      currency: 'INR',
      currencySymbol: '₹',
    },
    create: {
      companyId: company.id,
      defaultFinancialYearId: financialYear.id,
      currency: 'INR',
      currencySymbol: '₹',
    },
  });

  await prisma.product.upsert({
    where: { id: companyFixture.productId },
    update: {
      companyId: company.id,
      name: companyFixture.productName,
      retailPrice: '1200.00',
      buyingPrice: '900.00',
      gstRate: '5.00',
      type: 'GOODS',
      gstConsiderAs: 'TAXABLE',
      isActive: true,
    },
    create: {
      id: companyFixture.productId,
      companyId: company.id,
      name: companyFixture.productName,
      retailPrice: '1200.00',
      buyingPrice: '900.00',
      gstRate: '5.00',
      type: 'GOODS',
      gstConsiderAs: 'TAXABLE',
      isActive: true,
    },
  });

  await prisma.account.upsert({
    where: { id: companyFixture.accountId },
    update: {
      companyId: company.id,
      name: companyFixture.accountName,
      city: companyFixture.city,
      state: companyFixture.state,
      isActive: true,
    },
    create: {
      id: companyFixture.accountId,
      companyId: company.id,
      name: companyFixture.accountName,
      city: companyFixture.city,
      state: companyFixture.state,
      isActive: true,
    },
  });

  return company;
}

async function ensureUser(userFixture, tenantId) {
  const passwordHash = await bcrypt.hash(userFixture.password, 12);
  const now = new Date();

  return prisma.user.upsert({
    where: { username: userFixture.username },
    update: {
      tenantId,
      email: userFixture.email,
      passwordHash,
      role: userFixture.role,
      firstName: userFixture.firstName,
      lastName: userFixture.lastName,
      isActive: true,
      emailVerifiedAt: now,
      passwordChangedAt: now,
    },
    create: {
      tenantId,
      email: userFixture.email,
      username: userFixture.username,
      passwordHash,
      role: userFixture.role,
      firstName: userFixture.firstName,
      lastName: userFixture.lastName,
      isActive: true,
      emailVerifiedAt: now,
      passwordChangedAt: now,
    },
  });
}

async function ensureCompanyAccess(userId, companyId) {
  return prisma.userCompanyAccess.upsert({
    where: {
      userId_companyId: {
        userId,
        companyId,
      },
    },
    update: {},
    create: {
      userId,
      companyId,
    },
  });
}

async function main() {
  const plan = await ensurePlan();
  const tenant = await ensureTenant();
  await ensureSubscription(tenant.id, plan.id);

  const primaryCompany = await ensureCompany(FIXTURES.companies.primary, tenant.id);
  const secondaryCompany = await ensureCompany(
    FIXTURES.companies.secondary,
    tenant.id,
  );

  const superAdmin = await ensureUser(FIXTURES.users.superAdmin, tenant.id);
  const owner = await ensureUser(FIXTURES.users.owner, tenant.id);
  const staff = await ensureUser(FIXTURES.users.staff, tenant.id);

  await ensureCompanyAccess(superAdmin.id, primaryCompany.id);
  await ensureCompanyAccess(superAdmin.id, secondaryCompany.id);
  await ensureCompanyAccess(owner.id, primaryCompany.id);
  await ensureCompanyAccess(owner.id, secondaryCompany.id);
  await ensureCompanyAccess(staff.id, primaryCompany.id);

  console.log(
    JSON.stringify(
      {
        tenant: {
          id: tenant.id,
          slug: tenant.slug,
          name: tenant.name,
        },
        companies: {
          primary: {
            id: primaryCompany.id,
            name: primaryCompany.name,
            productName: FIXTURES.companies.primary.productName,
            accountName: FIXTURES.companies.primary.accountName,
          },
          secondary: {
            id: secondaryCompany.id,
            name: secondaryCompany.name,
            productName: FIXTURES.companies.secondary.productName,
            accountName: FIXTURES.companies.secondary.accountName,
          },
        },
        users: {
          superAdmin: {
            username: FIXTURES.users.superAdmin.username,
            password: FIXTURES.users.superAdmin.password,
          },
          owner: {
            username: FIXTURES.users.owner.username,
            password: FIXTURES.users.owner.password,
          },
          staff: {
            username: FIXTURES.users.staff.username,
            password: FIXTURES.users.staff.password,
          },
        },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error('[auth-live-bootstrap] failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
