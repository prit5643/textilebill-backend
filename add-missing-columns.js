const { Client } = require('pg');
require('dotenv').config();

async function addMissingColumns() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    const columns = [
      { name: 'inviteToken', type: 'text' },
      { name: 'inviteTokenExpiresAt', type: 'timestamp' },
      { name: 'refreshTokens', type: 'jsonb DEFAULT \'[]\'::jsonb' },
    ];

    for (const col of columns) {
      try {
        await client.query(
          `ALTER TABLE "User" ADD COLUMN "${col.name}" ${col.type}`
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

    console.log('\n✨ Schema update complete!');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

addMissingColumns();
