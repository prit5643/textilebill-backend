const { Client } = require('pg');
require('dotenv').config();

const REQUIRED_ACCOUNT_GROUPS = [
  'Cash-in-Hand',
  'Bank Accounts',
  'Sundry Debtors',
  'Sundry Creditors',
];

const KEEP_TABLES = new Set(['_prisma_migrations', 'Tenant', 'User', 'AccountGroup']);

async function main() {
  const email = process.argv[2] || 'pritpp188@gmail.com';
  const client = new Client({ connectionString: process.env.DATABASE_URL });

  try {
    await client.connect();
    console.log('Connected to database.');

    await client.query('BEGIN');

    const superAdminResult = await client.query(
      'SELECT id, "tenantId" FROM "User" WHERE email = $1 LIMIT 1',
      [email],
    );

    if (superAdminResult.rows.length === 0) {
      throw new Error(`SUPER_ADMIN user not found for email: ${email}`);
    }

    const superAdminId = superAdminResult.rows[0].id;
    const tenantId = superAdminResult.rows[0].tenantId;

    const tablesResult = await client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
    );

    const toTruncate = tablesResult.rows
      .map((r) => r.tablename)
      .filter((t) => !KEEP_TABLES.has(t));

    if (toTruncate.length > 0) {
      const truncateSql = `TRUNCATE TABLE ${toTruncate
        .map((t) => `\"${t}\"`)
        .join(', ')} RESTART IDENTITY CASCADE`;
      await client.query(truncateSql);
      console.log(`Truncated ${toTruncate.length} tables.`);
    }

    await client.query('DELETE FROM "User" WHERE id <> $1', [superAdminId]);
    await client.query('DELETE FROM "Tenant" WHERE id <> $1', [tenantId]);

    await client.query(
      `UPDATE "User"
       SET role = 'SUPER_ADMIN', "isActive" = true, "emailVerifiedAt" = COALESCE("emailVerifiedAt", NOW()), "updatedAt" = NOW()
       WHERE id = $1`,
      [superAdminId],
    );

    await client.query(
      'DELETE FROM "AccountGroup" WHERE name <> ALL($1::text[])',
      [REQUIRED_ACCOUNT_GROUPS],
    );

    for (const groupName of REQUIRED_ACCOUNT_GROUPS) {
      await client.query(
        `INSERT INTO "AccountGroup" (id, name, "isDefault", "createdAt")
         VALUES (gen_random_uuid()::text, $1, true, NOW())
         ON CONFLICT (name) DO NOTHING`,
        [groupName],
      );
    }

    await client.query('COMMIT');

    const summary = await client.query(
      `SELECT
         (SELECT COUNT(*) FROM "Tenant") AS tenants,
         (SELECT COUNT(*) FROM "User") AS users,
         (SELECT COUNT(*) FROM "AccountGroup") AS account_groups`,
    );

    console.log('Cleanup completed.');
    console.log(summary.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Cleanup failed:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
