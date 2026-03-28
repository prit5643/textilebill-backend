const { Client } = require('pg');
const bcrypt = require('bcrypt');
require('dotenv').config();

async function createUser() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    console.log('✅ Connected to database');

    const email = 'pritpp188@gmail.com';
    const password = 'Prit@2005';
    const username = email.split('@')[0];
    const passwordHash = await bcrypt.hash(password, 12);
    const now = new Date();

    // First, create or get tenant
    const tenantResult = await client.query(
      `INSERT INTO "Tenant" (id, name, slug, "isActive", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, true, $4, $5)
       ON CONFLICT(slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [
        'textile-demo-tenant',
        'Textile Demo',
        'textile-demo',
        now,
        now,
      ]
    );
    const tenantId = tenantResult.rows[0].id;
    console.log(`✅ Tenant ready: ${tenantId}`);

    // Create or get plan
    const planResult = await client.query(
      `INSERT INTO "Plan" (id, name, "displayName", "durationDays", price, "maxUsers", "maxCompanies", "isActive", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT(name) DO UPDATE SET "displayName" = EXCLUDED."displayName"
       RETURNING id`,
      ['plan-' + Date.now(), 'monthly', 'Monthly', 30, 999.00, 5, 3, true, now, now]
    );
    const planId = planResult.rows[0].id;
    console.log(`✅ Plan ready: ${planId}`);

    // Create or get subscription
    const subResult = await client.query(
      `INSERT INTO "Subscription" (id, "tenantId", "planId", status, "startDate", "endDate", amount, "createdAt", "updatedAt")
       SELECT $1, $2, $3, 'ACTIVE', $4, $5, 999.00, $6, $7
       WHERE NOT EXISTS (SELECT 1 FROM "Subscription" WHERE "tenantId" = $2 AND status = 'ACTIVE')`,
      [
        'subscription-' + Date.now(),
        tenantId,
        planId,
        now,
        new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
        now,
        now,
      ]
    );
    console.log(`✅ Subscription ready`);

    // Check if user exists
    const existingUser = await client.query(
      `SELECT id FROM "User" WHERE email = $1`,
      [email]
    );

    if (existingUser.rows.length > 0) {
      console.log(`⚠️  User already exists: ${existingUser.rows[0].id}`);
      // Update to SUPER_ADMIN
      await client.query(
        `UPDATE "User" SET role = 'SUPER_ADMIN', "emailVerifiedAt" = $2, "isActive" = true WHERE email = $1`,
        [email, now]
      );
      console.log(`✅ Updated to SUPER_ADMIN`);
    } else {
      // Create user
      const userResult = await client.query(
        `INSERT INTO "User" (id, "tenantId", email, username, "passwordHash", role, "firstName", "lastName", "isActive", "emailVerifiedAt", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, 'SUPER_ADMIN', 'Admin', 'User', true, $6, $7, $8)
         RETURNING id`,
        [
          'user-' + Date.now(),
          tenantId,
          email,
          username,
          passwordHash,
          now,
          now,
          now,
        ]
      );
      console.log(`✅ User created: ${userResult.rows[0].id}`);
    }

    console.log(`\n✨ SUCCESS! Superadmin user ready:`);
    console.log(`   Email: ${email}`);
    console.log(`   Password: ${password}`);
    console.log(`   Role: SUPER_ADMIN 👑`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

createUser();
