-- Migration: Per-type invoice numbering
-- Previously the unique index on Invoice was:
--   (companyId, financialYearId, invoiceNumber, version)
-- This meant PURCHASE #1 and SALE #1 could NOT coexist.
-- Now each invoice type has its own independent number sequence.

-- Step 1: Drop the old cross-type unique index
DROP INDEX IF EXISTS "Invoice_company_fy_number_version_active_key";

-- Step 2: Create the new per-type unique index (includes "type")
CREATE UNIQUE INDEX "Invoice_company_fy_type_number_version_active_key"
  ON "Invoice" ("companyId", "financialYearId", "type", "invoiceNumber", "version")
  WHERE "deletedAt" IS NULL;

-- Step 3: Renumber existing invoices per type (1, 2, 3... per type bucket)
-- Uses a CTE to assign sequential row numbers within each (companyId, financialYearId, type) group.
-- Ordered by invoiceDate ASC, createdAt ASC to preserve chronological order.

-- First, clear any leftover TEMP- prefixed numbers from prior failed migration attempts
UPDATE "Invoice"
SET "invoiceNumber" = REGEXP_REPLACE("invoiceNumber", '^(TEMP-|RENUMBER-)', '', 'g')
WHERE "invoiceNumber" ~ '^(TEMP-|RENUMBER-)' AND "deletedAt" IS NULL;

-- Now renumber: two-step to avoid unique conflicts during update.
-- Step 3a: Assign a temporary large offset so no two final numbers collide with existing ones
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "companyId", "financialYearId", "type"
      ORDER BY "invoiceDate" ASC, "createdAt" ASC
    ) AS rn
  FROM "Invoice"
  WHERE "deletedAt" IS NULL
    AND "invoiceNumber" ~ '^[0-9]+$'  -- only touch numeric invoice numbers
)
UPDATE "Invoice" i
SET "invoiceNumber" = CAST(1000000 + r.rn AS TEXT)
FROM ranked r
WHERE i.id = r.id;

-- Step 3b: Remove the offset — set to final sequential numbers
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "companyId", "financialYearId", "type"
      ORDER BY "invoiceDate" ASC, "createdAt" ASC
    ) AS rn
  FROM "Invoice"
  WHERE "deletedAt" IS NULL
    AND "invoiceNumber" ~ '^[0-9]+$'
)
UPDATE "Invoice" i
SET "invoiceNumber" = CAST(r.rn AS TEXT)
FROM ranked r
WHERE i.id = r.id;

-- Step 4: Sync VoucherSequence counters to match the new max per type+FY+company
-- SALE
UPDATE "VoucherSequence" vs
SET "currentValue" = subq.max_num
FROM (
  SELECT "companyId", "financialYearId", MAX(CAST("invoiceNumber" AS INTEGER)) AS max_num
  FROM "Invoice"
  WHERE "deletedAt" IS NULL AND "type" = 'SALE' AND "invoiceNumber" ~ '^[0-9]+$'
  GROUP BY "companyId", "financialYearId"
) subq
WHERE vs."companyId" = subq."companyId"
  AND vs."financialYearId" = subq."financialYearId"
  AND vs."type" = 'SALE';

-- PURCHASE
INSERT INTO "VoucherSequence" ("id", "tenantId", "companyId", "financialYearId", "type", "prefix", "currentValue")
SELECT
  gen_random_uuid(),
  i."tenantId",
  i."companyId",
  i."financialYearId",
  'PURCHASE'::"VoucherType",
  '',
  MAX(CAST(i."invoiceNumber" AS INTEGER))
FROM "Invoice" i
WHERE i."deletedAt" IS NULL AND i."type" = 'PURCHASE' AND i."invoiceNumber" ~ '^[0-9]+$'
GROUP BY i."tenantId", i."companyId", i."financialYearId"
ON CONFLICT ("companyId", "financialYearId", "type")
DO UPDATE SET "currentValue" = EXCLUDED."currentValue";

-- SALE_RETURN
INSERT INTO "VoucherSequence" ("id", "tenantId", "companyId", "financialYearId", "type", "prefix", "currentValue")
SELECT
  gen_random_uuid(),
  i."tenantId",
  i."companyId",
  i."financialYearId",
  'SALE_RETURN'::"VoucherType",
  '',
  MAX(CAST(i."invoiceNumber" AS INTEGER))
FROM "Invoice" i
WHERE i."deletedAt" IS NULL AND i."type" = 'SALE_RETURN' AND i."invoiceNumber" ~ '^[0-9]+$'
GROUP BY i."tenantId", i."companyId", i."financialYearId"
ON CONFLICT ("companyId", "financialYearId", "type")
DO UPDATE SET "currentValue" = EXCLUDED."currentValue";

-- PURCHASE_RETURN
INSERT INTO "VoucherSequence" ("id", "tenantId", "companyId", "financialYearId", "type", "prefix", "currentValue")
SELECT
  gen_random_uuid(),
  i."tenantId",
  i."companyId",
  i."financialYearId",
  'PURCHASE_RETURN'::"VoucherType",
  '',
  MAX(CAST(i."invoiceNumber" AS INTEGER))
FROM "Invoice" i
WHERE i."deletedAt" IS NULL AND i."type" = 'PURCHASE_RETURN' AND i."invoiceNumber" ~ '^[0-9]+$'
GROUP BY i."tenantId", i."companyId", i."financialYearId"
ON CONFLICT ("companyId", "financialYearId", "type")
DO UPDATE SET "currentValue" = EXCLUDED."currentValue";
