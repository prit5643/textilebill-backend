const { Client } = require('pg');
require('dotenv').config();

async function addCompanySettingsColumns() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    const columns = [
      { name: 'ewayBillPasswordEnc', type: 'text' },
      { name: 'einvoicePasswordEnc', type: 'text' },
    ];

    console.log('📝 Adding missing columns to CompanySettings...\n');

    for (const col of columns) {
      try {
        await client.query(
          `ALTER TABLE "CompanySettings" ADD COLUMN "${col.name}" ${col.type}`
        );
        console.log(`  ✅ Added ${col.name} column`);
      } catch (e) {
        if (e.code === '42701') {
          console.log(`  ℹ️  ${col.name} column already exists`);
        } else if (e.code === '42P07') {
          console.log(`  ℹ️  ${col.name} constraint already exists`);
        } else {
          throw e;
        }
      }
    }

    console.log('\n✨ CompanySettings schema update complete!');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

addCompanySettingsColumns();
