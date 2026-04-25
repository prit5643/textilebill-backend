import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: 'tv-root' } });
  if (!tenant) throw new Error('Tenant tv-root not found!');

  const company = await prisma.company.findFirst({
    where: { tenantId: tenant.id, name: 'TextileBill Default Company' },
  });
  if (!company) throw new Error('Company not found!');

  const rolesToCreate = [
    { email: 'admin@test.local', name: 'Test Admin', role: UserRole.ADMIN },
    { email: 'manager@test.local', name: 'Test Manager', role: UserRole.MANAGER },
    { email: 'viewer@test.local', name: 'Test Viewer', role: UserRole.VIEWER },
  ];

  const passwordHash = await bcrypt.hash('password123', 12);

  console.log('--- Creating Test Users ---');
  for (const { email, name, role } of rolesToCreate) {
    const existing = await prisma.user.findFirst({
      where: { email, tenantId: tenant.id },
    });

    let user;
    if (existing) {
      user = await prisma.user.update({
        where: { id: existing.id },
        data: { name, passwordHash, status: 'ACTIVE', deletedAt: null },
      });
    } else {
      user = await prisma.user.create({
        data: {
          tenantId: tenant.id,
          email,
          passwordHash,
          name,
          status: 'ACTIVE',
        },
      });
    }

    const existingCompany = await prisma.userCompany.findFirst({
      where: { userId: user.id, companyId: company.id },
    });

    if (existingCompany) {
      await prisma.userCompany.update({
        where: { id: existingCompany.id },
        data: { role },
      });
    } else {
      await prisma.userCompany.create({
        data: {
          tenantId: tenant.id,
          userId: user.id,
          companyId: company.id,
          role,
        },
      });
    }
    console.log(`Created [${role}] - Email: ${email} | Password: password123`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
