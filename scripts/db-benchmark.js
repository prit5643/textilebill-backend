const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const QUERIES = [
  [
    'refresh_expiry',
    'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM "RefreshToken" WHERE "expiresAt" < NOW() ORDER BY "expiresAt" DESC LIMIT 1000',
  ],
  [
    'audit_company_entity',
    'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM "AuditLog" WHERE "companyId" IS NOT NULL AND "entity" = \'Invoice\' ORDER BY "createdAt" DESC LIMIT 200',
  ],
  [
    'subscription_active_window',
    'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM "Subscription" WHERE "status" = \'ACTIVE\' AND "endDate" > NOW() ORDER BY "endDate" ASC LIMIT 200',
  ],
];

async function run() {
  for (const [name, sql] of QUERIES) {
    const rows = await prisma.$queryRawUnsafe(sql);
    const plan = rows[0]['QUERY PLAN'][0].Plan;
    console.log(
      `${name}:${JSON.stringify({
        executionMs: plan['Actual Total Time'],
        startupMs: plan['Actual Startup Time'],
        node: plan['Node Type'],
        planRows: plan['Plan Rows'],
      })}`,
    );
  }
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
