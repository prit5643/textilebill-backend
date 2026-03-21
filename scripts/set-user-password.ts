import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function setUserPassword(email: string, newPassword: string) {
  console.log(`\n🔍 Finding user with email: ${email}\n`);

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      username: true,
      role: true,
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
  console.log(`   Role: ${user.role}`);

  console.log(`\n🔐 Hashing password...`);
  const passwordHash = await bcrypt.hash(newPassword, 12);

  console.log(`📝 Updating password in database...`);
  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      passwordChangedAt: new Date(),
    },
  });

  console.log(`\n✅ Password updated successfully!`);
  console.log(`   User: ${updatedUser.email}`);
  console.log(`   Username: ${updatedUser.username}`);
  console.log(`   Password Changed At: ${updatedUser.passwordChangedAt?.toISOString()}`);
  console.log(`\n✨ User can now log in with the new password!\n`);
}

const email = process.argv[2];
const password = process.argv[3];

if (!email || !password) {
  console.error('❌ Usage: ts-node scripts/set-user-password.ts <email> <password>');
  process.exit(1);
}

setUserPassword(email, password)
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
