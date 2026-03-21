import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function manageUserRole(email: string) {
  console.log(`\n🔍 Finding user with email: ${email}\n`);

  // Step 1: Find the user
  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      tenant: true,
    },
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
  console.log(`   Email Verified: ${user.emailVerifiedAt ? '✅' : '❌'}`);
  console.log(`   Phone Verified: ${user.phoneVerifiedAt ? '✅' : '❌'}`);
  console.log(`   Active: ${user.isActive ? '✅' : '❌'}`);

  // Step 2: Change to normal user (STAFF)
  console.log(`\n📝 Step 1: Changing role from ${user.role} to STAFF (normal user)...`);
  
  const updatedToStaff = await prisma.user.update({
    where: { id: user.id },
    data: { role: 'STAFF' },
  });

  console.log(`✅ Role changed to: ${updatedToStaff.role}`);

  // Wait a moment
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Step 3: Change to admin user (TENANT_ADMIN)
  console.log(`\n📝 Step 2: Changing role from STAFF to TENANT_ADMIN (admin user)...`);
  
  const updatedToAdmin = await prisma.user.update({
    where: { id: user.id },
    data: { role: 'TENANT_ADMIN' },
  });

  console.log(`✅ Role changed to: ${updatedToAdmin.role}`);

  // Step 4: Verify email and phone
  console.log(`\n📝 Step 3: Verifying user contacts...`);
  
  const now = new Date();
  const verified = await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerifiedAt: now,
      phoneVerifiedAt: user.phone ? now : null,
    },
  });

  console.log(`✅ Email verified: ${verified.emailVerifiedAt ? '✅' : '❌'}`);
  console.log(`✅ Phone verified: ${verified.phoneVerifiedAt ? '✅' : '❌'}`);

  // Final status
  console.log(`\n🎉 Final User Status:`);
  console.log(`   ID: ${verified.id}`);
  console.log(`   Email: ${verified.email}`);
  console.log(`   Username: ${verified.username}`);
  console.log(`   Role: ${verified.role} (ADMIN)`);
  console.log(`   Email Verified: ${verified.emailVerifiedAt ? '✅ ' + verified.emailVerifiedAt.toISOString() : '❌'}`);
  console.log(`   Phone Verified: ${verified.phoneVerifiedAt ? '✅ ' + verified.phoneVerifiedAt.toISOString() : '❌'}`);
  console.log(`   Active: ${verified.isActive ? '✅' : '❌'}`);
  console.log(`\n✨ All done!\n`);
}

const email = process.argv[2] || 'pritdharsandiya123@gmail.com';

manageUserRole(email)
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
