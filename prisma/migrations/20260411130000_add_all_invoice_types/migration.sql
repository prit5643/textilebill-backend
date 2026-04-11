-- Add new invoice types: QUOTATION, CHALLAN, PROFORMA, JOB_IN, JOB_OUT
-- to both InvoiceType and VoucherType enums.
-- Also add partyChallanNo field to Invoice.

-- Step 1: Add new values to InvoiceType enum
ALTER TYPE "InvoiceType" ADD VALUE IF NOT EXISTS 'QUOTATION';
ALTER TYPE "InvoiceType" ADD VALUE IF NOT EXISTS 'CHALLAN';
ALTER TYPE "InvoiceType" ADD VALUE IF NOT EXISTS 'PROFORMA';
ALTER TYPE "InvoiceType" ADD VALUE IF NOT EXISTS 'JOB_IN';
ALTER TYPE "InvoiceType" ADD VALUE IF NOT EXISTS 'JOB_OUT';

-- Step 2: Add new values to VoucherType enum
ALTER TYPE "VoucherType" ADD VALUE IF NOT EXISTS 'QUOTATION';
ALTER TYPE "VoucherType" ADD VALUE IF NOT EXISTS 'CHALLAN';
ALTER TYPE "VoucherType" ADD VALUE IF NOT EXISTS 'PROFORMA';
ALTER TYPE "VoucherType" ADD VALUE IF NOT EXISTS 'JOB_IN';
ALTER TYPE "VoucherType" ADD VALUE IF NOT EXISTS 'JOB_OUT';

-- Step 3: Add partyChallanNo column to Invoice
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "partyChallanNo" TEXT;

-- Step 4: Fix any leftover PURCHASE_RETURN invoices that have wrong numbers.
-- Renumber PURCHASE_RETURN invoices so they start at 1 within their type bucket.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "companyId", "financialYearId", "type"
      ORDER BY "invoiceDate" ASC, "createdAt" ASC
    ) AS rn
  FROM "Invoice"
  WHERE "deletedAt" IS NULL
    AND "type" = 'PURCHASE_RETURN'
)
UPDATE "Invoice" i
SET "invoiceNumber" = CAST(1000000 + r.rn AS TEXT)
FROM ranked r
WHERE i.id = r.id;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "companyId", "financialYearId", "type"
      ORDER BY "invoiceDate" ASC, "createdAt" ASC
    ) AS rn
  FROM "Invoice"
  WHERE "deletedAt" IS NULL
    AND "type" = 'PURCHASE_RETURN'
)
UPDATE "Invoice" i
SET "invoiceNumber" = CAST(r.rn AS TEXT)
FROM ranked r
WHERE i.id = r.id;

-- Step 5: Ensure VoucherSequence for PURCHASE_RETURN is correct
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

-- Also ensure SALE_RETURN sequence is correct
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
