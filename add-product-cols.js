const { Client } = require('pg');
require('dotenv').config();

async function addProductColumns() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    console.log('📝 Adding missing columns to Product...\n');

    try {
      await client.query(`ALTER TABLE "Product" ADD COLUMN "version" integer DEFAULT 1`);
      console.log(`  ✅ Added version column`);
    } catch (e) {
      if (e.code === '42701') {
        console.log(`  ℹ️  version column already exists`);
      } else {
        throw e;
      }
    }

    console.log('\n✨ Product schema update complete!');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

addProductColumns();
