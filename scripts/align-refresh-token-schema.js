const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  const columns = [
    ['token', 'text'],
    ['tokenHash', 'text'],
    ['deviceId', 'text'],
    ['userAgent', 'text'],
    ['ipAddress', 'text'],
    ['lastUsedAt', 'timestamp'],
    ['expiresAt', 'timestamp'],
    ['createdAt', 'timestamp DEFAULT NOW()'],
    ['revokedAt', 'timestamp'],
  ];

  try {
    await client.connect();

    for (const [columnName, columnType] of columns) {
      try {
        await client.query(
          'ALTER TABLE "RefreshToken" ADD COLUMN "' + columnName + '" ' + columnType,
        );
        console.log('Added column:', columnName);
      } catch (error) {
        if (error.code !== '42701') {
          throw error;
        }
      }
    }

    console.log('RefreshToken schema aligned.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('Failed:', error.message);
  process.exit(1);
});
