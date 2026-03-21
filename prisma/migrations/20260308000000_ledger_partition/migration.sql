-- 1. Rename the existing Prisma-managed LedgerEntry table
ALTER TABLE "LedgerEntry" RENAME TO "LedgerEntry_old";

-- 2. Prevent active inserts during the migration (locks the old table safely)
LOCK TABLE "LedgerEntry_old" IN ACCESS EXCLUSIVE MODE;

-- 3. Create the new explicitly Partitioned table matching Prisma's exact schema
-- NOTE: PostgreSQL requires the partition key to be part of the primary key or unique constraints
CREATE TABLE "LedgerEntry" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "invoiceId" TEXT,
  "voucherType" TEXT NOT NULL,
  "voucherNumber" TEXT,
  "date" TIMESTAMP(3) NOT NULL,
  "debit" DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  "credit" DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  "narration" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- We must include the partition key ("date") in the PK 
  CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id", "date")
) PARTITION BY RANGE ("date");

-- 4. Create Financial Year Partitions (April 1 to March 31)
CREATE TABLE "LedgerEntry_fy23_24" PARTITION OF "LedgerEntry" FOR VALUES FROM ('2023-04-01') TO ('2024-04-01');
CREATE TABLE "LedgerEntry_fy24_25" PARTITION OF "LedgerEntry" FOR VALUES FROM ('2024-04-01') TO ('2025-04-01');
CREATE TABLE "LedgerEntry_fy25_26" PARTITION OF "LedgerEntry" FOR VALUES FROM ('2025-04-01') TO ('2026-04-01');
CREATE TABLE "LedgerEntry_fy26_27" PARTITION OF "LedgerEntry" FOR VALUES FROM ('2026-04-01') TO ('2027-04-01');

-- 5. Fallback Partition for out-of-bound dates
CREATE TABLE "LedgerEntry_default" PARTITION OF "LedgerEntry" DEFAULT;

-- 6. Migrate existing data from the old unpartitioned table
INSERT INTO "LedgerEntry" SELECT * FROM "LedgerEntry_old";

-- 7. Drop the old table entirely
DROP TABLE "LedgerEntry_old";

-- 8. Rebuild Indexes as declared in Prisma
CREATE INDEX "LedgerEntry_companyId_idx" ON "LedgerEntry"("companyId");
CREATE INDEX "LedgerEntry_accountId_idx" ON "LedgerEntry"("accountId");
CREATE INDEX "LedgerEntry_date_idx" ON "LedgerEntry"("date");
CREATE INDEX "LedgerEntry_voucherType_idx" ON "LedgerEntry"("voucherType");
CREATE INDEX "LedgerEntry_companyId_accountId_date_idx" ON "LedgerEntry"("companyId", "accountId", "date");
