import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function createUser() {
  console.log('\n📝 Creating admin user...\n');
  console.log(`   Email: pritpp188@gmail.com`);
  console.log(`   Password: Pri***`);

  try {
    const email = 'pritpp188@gmail.com';
    const password = 'Prit@2005';
    const username = email.split('@')[0];
    const passwordHash = await bcrypt.hash(password, 12);
    const now = new Date();

    // Create tenant
    const tenant = await prisma.tenant.upsert({
      where: { slug: 'textile-demo' },
      update: {},
      create: {
        slug: 'textile-demo',
        name: 'Textile Demo',
        email: 'admin@textilebill.local',
        isActive: true,
      },
    });

    console.log(`\n✅ Tenant ready: ${tenant.id}`);

    // Create plan
    const plan = await prisma.plan.upsert({
      where: { name: 'monthly' },
      update: {},
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

    console.log(`✅ Plan ready: ${plan.id}`);

    // Create subscription
    const existingSubscription = await prisma.subscription.findFirst({
      where: { tenantId: tenant.id, status: 'ACTIVE' },
    });

    if (!existingSubscription) {
      const nextYear = new Date(now);
      nextYear.setFullYear(now.getFullYear() + 1);
      
      await prisma.subscription.create({
        data: {
          tenantId: tenant.id,
          planId: plan.id,
          status: 'ACTIVE',
          startDate: now,
          endDate: nextYear,
          amount: '999.00',
          currency: 'INR',
        },
      });
    }

    console.log(`✅ Subscription ready`);

    // Check if user exists
    const existingUser = await prisma.$queryRawUnsafe(
      `SELECT id FROM "User" WHERE email = $1`,
      email
    ) as any[];

    if (existingUser && existingUser.length > 0) {
      console.log(`\n⚠️  User already exists!`);
      console.log(`   ID: ${existingUser[0].id}`);
      
      // Update to SUPER_ADMIN
      await prisma.user.update({
        where: { email },
        data: {
          role: 'SUPER_ADMIN',
          isActive: true,
        },
      });
    } else {
      // Create user
      const user = await prisma.user.create({
        data: {
          tenantId: tenant.id,
          email: email,
          username: username,
          passwordHash: passwordHash,
          role: 'SUPER_ADMIN',
          firstName: 'Admin',
          lastName: 'User',
          isActive: true,
        },
      });

      console.log(`\n✅ User created: ${user.id}`);
    }

    console.log(`\n🎉 SUCCESS! Superadmin user ready:`);
    console.log(`   Email: ${email}`);
    console.log(`   Password: ${password}`);
    console.log(`   Role: SUPER_ADMIN 👑`);
    console.log(`\n✨ User can now login!\n`);

  } catch (error) {
    console.error(`\n❌ Error:`, error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

createUser();
