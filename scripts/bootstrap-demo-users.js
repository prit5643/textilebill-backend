const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  const now = new Date();
  const nextYear = new Date(now);
  nextYear.setFullYear(now.getFullYear() + 1);

  const fyStart = new Date(
    now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1,
    3,
    1,
  );
  const fyEnd = new Date(fyStart.getFullYear() + 1, 2, 31, 23, 59, 59, 999);
  const fyLabel = `${fyStart.getFullYear()}-${String(
    (fyStart.getFullYear() + 1) % 100,
  ).padStart(2, '0')}`;

  const plan = await prisma.plan.upsert({
    where: { name: 'monthly' },
    update: {
      displayName: 'Monthly',
      durationDays: 30,
      price: '999.00',
      maxUsers: 5,
      maxCompanies: 3,
      isActive: true,
    },
    create: {
      name: 'monthly',
      displayName: 'Monthly',
      durationDays: 30,
      price: '999.00',
      maxUsers: 5,
      maxCompanies: 3,
      isActive: true,
    },
  });

  const tenant = await prisma.tenant.upsert({
    where: { slug: 'textile-demo' },
    update: {
      name: 'Textile Demo',
      isActive: true,
      email: 'owner@textilebill.local',
      city: 'Surat',
      state: 'Gujarat',
    },
    create: {
      name: 'Textile Demo',
      slug: 'textile-demo',
      isActive: true,
      email: 'owner@textilebill.local',
      city: 'Surat',
      state: 'Gujarat',
    },
  });

  await prisma.subscription.upsert({
    where: { id: 'demo-subscription-active' },
    update: {
      tenantId: tenant.id,
      planId: plan.id,
      status: 'ACTIVE',
      startDate: now,
      endDate: nextYear,
      amount: '999.00',
      currency: 'INR',
    },
    create: {
      id: 'demo-subscription-active',
      tenantId: tenant.id,
      planId: plan.id,
      status: 'ACTIVE',
      startDate: now,
      endDate: nextYear,
      amount: '999.00',
      currency: 'INR',
    },
  });

  const company = await prisma.company.upsert({
    where: { id: 'demo-company-main' },
    update: {
      tenantId: tenant.id,
      name: 'Textile Demo Main',
      isActive: true,
      city: 'Surat',
      state: 'Gujarat',
      email: 'accounts@textilebill.local',
    },
    create: {
      id: 'demo-company-main',
      tenantId: tenant.id,
      name: 'Textile Demo Main',
      isActive: true,
      city: 'Surat',
      state: 'Gujarat',
      email: 'accounts@textilebill.local',
    },
  });

  await prisma.financialYear.upsert({
    where: {
      companyId_name: {
        companyId: company.id,
        name: fyLabel,
      },
    },
    update: {
      startDate: fyStart,
      endDate: fyEnd,
      isActive: true,
    },
    create: {
      companyId: company.id,
      name: fyLabel,
      startDate: fyStart,
      endDate: fyEnd,
      isActive: true,
    },
  });

  const adminHash = await bcrypt.hash('Admin@123', 12);
  const userHash = await bcrypt.hash('User@123', 12);

  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {
      tenantId: tenant.id,
      email: 'admin@textilebill.local',
      passwordHash: adminHash,
      role: 'SUPER_ADMIN',
      firstName: 'Admin',
      lastName: 'User',
      isActive: true,
      passwordChangedAt: now,
    },
    create: {
      tenantId: tenant.id,
      email: 'admin@textilebill.local',
      username: 'admin',
      passwordHash: adminHash,
      role: 'SUPER_ADMIN',
      firstName: 'Admin',
      lastName: 'User',
      isActive: true,
      passwordChangedAt: now,
    },
  });

  const staff = await prisma.user.upsert({
    where: { username: 'staff' },
    update: {
      tenantId: tenant.id,
      email: 'staff@textilebill.local',
      passwordHash: userHash,
      role: 'STAFF',
      firstName: 'Normal',
      lastName: 'User',
      isActive: true,
      passwordChangedAt: now,
    },
    create: {
      tenantId: tenant.id,
      email: 'staff@textilebill.local',
      username: 'staff',
      passwordHash: userHash,
      role: 'STAFF',
      firstName: 'Normal',
      lastName: 'User',
      isActive: true,
      passwordChangedAt: now,
    },
  });

  await prisma.userCompanyAccess.upsert({
    where: {
      userId_companyId: {
        userId: admin.id,
        companyId: company.id,
      },
    },
    update: {},
    create: {
      userId: admin.id,
      companyId: company.id,
    },
  });

  await prisma.userCompanyAccess.upsert({
    where: {
      userId_companyId: {
        userId: staff.id,
        companyId: company.id,
      },
    },
    update: {},
    create: {
      userId: staff.id,
      companyId: company.id,
    },
  });

  console.log(
    JSON.stringify(
      {
        tenantId: tenant.id,
        companyId: company.id,
        admin: {
          id: admin.id,
          username: admin.username,
          password: 'Admin@123',
        },
        staff: {
          id: staff.id,
          username: staff.username,
          password: 'User@123',
        },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
