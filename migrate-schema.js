const { Client } = require('pg');
require('dotenv').config();

async function migrateSchema() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    // Add missing columns to User table
    console.log('📝 Adding missing columns to User table...\n');

    // Check and add emailVerifiedAt
    try {
      await client.query(`
        ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" timestamp
      `);
      console.log('  ✅ Added emailVerifiedAt column');
    } catch (e) {
      if (e.code === '42701') {
        console.log('  ℹ️  emailVerifiedAt column already exists');
      } else {
        throw e;
      }
    }

    // Check and add phoneVerifiedAt
    try {
      await client.query(`
        ALTER TABLE "User" ADD COLUMN "phoneVerifiedAt" timestamp
      `);
      console.log('  ✅ Added phoneVerifiedAt column');
    } catch (e) {
      if (e.code === '42701') {
        console.log('  ℹ️  phoneVerifiedAt column already exists');
      } else {
        throw e;
      }
    }

    // Check and add avatarUrl
    try {
      await client.query(`
        ALTER TABLE "User" ADD COLUMN "avatarUrl" text
      `);
      console.log('  ✅ Added avatarUrl column');
    } catch (e) {
      if (e.code === '42701') {
        console.log('  ℹ️  avatarUrl column already exists');
      } else {
        throw e;
      }
    }

    console.log('\n✨ Schema migration complete!');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

migrateSchema();
