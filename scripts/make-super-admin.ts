import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function makeSuperAdmin(email: string) {
  console.log(`\n🔍 Finding user with email: ${email}\n`);

  const user = await prisma.user.findUnique({
    where: { email },
    include: { tenant: true },
  });

  if (!user) {
    console.log(`❌ User with email ${email} not found!`);
    return;
  }

  console.log('✅ User found:');
  console.log(`   ID: ${user.id}`);
  console.log(`   Email: ${user.email}`);
  console.log(`   Username: ${user.username}`);
  console.log(`   Current Role: ${user.role}`);
  console.log(`   Tenant: ${user.tenant.name}`);

  console.log(`\n⚡ Upgrading to SUPER_ADMIN...`);

  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: { 
      role: 'SUPER_ADMIN',
      emailVerifiedAt: user.emailVerifiedAt || new Date(),
    },
  });

  console.log(`\n🎉 SUCCESS! User is now a SUPER_ADMIN:`);
  console.log(`   ID: ${updatedUser.id}`);
  console.log(`   Email: ${updatedUser.email}`);
  console.log(`   Username: ${updatedUser.username}`);
  console.log(`   Role: ${updatedUser.role} 👑`);
  console.log(`   Email Verified: ${updatedUser.emailVerifiedAt ? '✅' : '❌'}`);
  console.log(`   Active: ${updatedUser.isActive ? '✅' : '❌'}`);
  console.log(`\n✨ User has full system access!\n`);
}

const email = process.argv[2] || 'pritdharsandiya123@gmail.com';

makeSuperAdmin(email)
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
