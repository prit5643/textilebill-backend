import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

function getCurrentFinancialYear() {
  const now = new Date();
  const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const endYear = startYear + 1;
  return {
    startDate: new Date(startYear, 3, 1),
    endDate: new Date(endYear, 2, 31),
  };
}

async function createOrUpgradeOwnerUser() {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL ?? 'pritpp188@gmail.com';
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? 'Prit@2005';
  const userName = process.env.BOOTSTRAP_ADMIN_NAME ?? 'Admin User';
  const tenantName = process.env.BOOTSTRAP_TENANT_NAME ?? 'Textile Demo';
  const tenantSlug = process.env.BOOTSTRAP_TENANT_SLUG ?? 'textile-demo';
  const companyName = process.env.BOOTSTRAP_COMPANY_NAME ?? 'Textile Demo Company';

  const passwordHash = await bcrypt.hash(password, 12);

  const tenant =
    (await prisma.tenant.findUnique({
      where: { slug: tenantSlug },
    })) ??
    (await prisma.tenant.create({
      data: {
        name: tenantName,
        slug: tenantSlug,
      },
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

  const existingUser = await prisma.user.findFirst({
    where: {
      tenantId: tenant.id,
      email,
      deletedAt: null,
    },
    orderBy: { createdAt: 'asc' },
  });

  const user =
    (existingUser &&
      (await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          name: userName,
          passwordHash,
          status: 'ACTIVE',
          deletedAt: null,
        },
      }))) ||
    (await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email,
        name: userName,
        passwordHash,
        status: 'ACTIVE',
      },
    }));

  await prisma.userCompany.upsert({
    where: {
      userId_companyId: {
        userId: user.id,
        companyId: company.id,
      },
    },
    update: {
      role: UserRole.OWNER,
    },
    create: {
      tenantId: tenant.id,
      userId: user.id,
      companyId: company.id,
      role: UserRole.OWNER,
    },
  });

  const fy = getCurrentFinancialYear();
  await prisma.financialYear.upsert({
    where: {
      companyId_startDate_endDate: {
        companyId: company.id,
        startDate: fy.startDate,
        endDate: fy.endDate,
      },
    },
    update: {},
    create: {
      tenantId: tenant.id,
      companyId: company.id,
      startDate: fy.startDate,
      endDate: fy.endDate,
      isLocked: false,
    },
  });

  console.log('\nOwner user is ready');
  console.log(`Tenant: ${tenant.name} (${tenant.id})`);
  console.log(`Company: ${company.name} (${company.id})`);
  console.log(`User: ${email}`);
}

createOrUpgradeOwnerUser()
  .catch((error) => {
    console.error('Failed to create owner user:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
