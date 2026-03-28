const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function createAdminUser(email, password) {
  console.log(`\n📝 Creating admin user...\n`);
  console.log(`   Email: ${email}`);
  console.log(`   Password: ${password.substring(0, 3)}***`);

  try {
    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      console.log(`\n⚠️  User with email ${email} already exists!`);
      console.log(`   ID: ${existingUser.id}`);
      console.log(`   Role: ${existingUser.role}`);
      console.log(`   Verified: ${existingUser.emailVerifiedAt ? '✅' : '❌'}`);
      return;
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);
    const now = new Date();

    // Create or get default tenant (Demo)
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

    // Create plan if not exists
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

    // Create active subscription if not exists for tenant
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

    // Create admin user
    const adminUser = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: email,
        username: email.split('@')[0],
        passwordHash: passwordHash,
        role: 'SUPER_ADMIN',
        firstName: 'Admin',
        lastName: 'User',
        isActive: true,
        emailVerifiedAt: now,
        passwordChangedAt: now,
      },
    });

    console.log(`\n✅ SUCCESS! Admin user created:\n`);
    console.log(`   ID: ${adminUser.id}`);
    console.log(`   Email: ${adminUser.email}`);
    console.log(`   Username: ${adminUser.username}`);
    console.log(`   Role: ${adminUser.role} 👑`);
    console.log(`   Verified: ✅`);
    console.log(`   Active: ✅`);
    console.log(`   Tenant: ${tenant.name}\n`);
    console.log(`✨ User can now login with:`);
    console.log(`   Email: ${email}`);
    console.log(`   Password: ${password}\n`);

  } catch (error) {
    console.error(`\n❌ Error creating admin user:`, error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Get email and password from command line or use defaults
const email = process.argv[2] || 'pritpp188@gmail.com';
const password = process.argv[3] || 'Prit@2005';

createAdminUser(email, password);
