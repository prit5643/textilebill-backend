-- Phase 1 hardening migration
-- Aligns SQL-level production safeguards with schema comments.

-- 1) USER EMAIL UNIQUENESS: tenant-scoped + case-insensitive + active rows only
DROP INDEX IF EXISTS "User_email_deletedAt_key";
CREATE UNIQUE INDEX IF NOT EXISTS "User_tenantId_lower_email_deletedAt_key"
  ON "User" ("tenantId", LOWER("email"))
  WHERE "deletedAt" IS NULL;

-- 2) REFRESH TOKEN: partial index for active tokens by expiry
CREATE INDEX IF NOT EXISTS "RefreshToken_expiresAt_active_idx"
  ON "RefreshToken" ("expiresAt")
  WHERE "revokedAt" IS NULL;

-- 3) OTP CHALLENGE: one active challenge per user + purpose and max attempts guard
DROP INDEX IF EXISTS "OtpChallenge_userId_purpose_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "OtpChallenge_userId_purpose_active_key"
  ON "OtpChallenge" ("userId", "purpose")
  WHERE "usedAt" IS NULL;

DO $$
BEGIN
  ALTER TABLE "OtpChallenge"
    ADD CONSTRAINT "chk_attempts" CHECK (attempts <= 5);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 4) PARTY GSTIN: company-scoped + case-insensitive + active rows only
CREATE UNIQUE INDEX IF NOT EXISTS "Party_companyId_lower_gstin_active_key"
  ON "Party" ("companyId", LOWER("gstin"))
  WHERE "gstin" IS NOT NULL AND "deletedAt" IS NULL;

-- 5) ACCOUNT: prevent duplicate party account mapping in active rows
CREATE UNIQUE INDEX IF NOT EXISTS "Account_companyId_partyId_active_key"
  ON "Account" ("companyId", "partyId")
  WHERE "deletedAt" IS NULL;

-- 6) PRODUCT SKU: company-scoped + case-insensitive + active rows only
DROP INDEX IF EXISTS "Product_sku_deletedAt_companyId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "Product_companyId_lower_sku_active_key"
  ON "Product" ("companyId", LOWER("sku"))
  WHERE "sku" IS NOT NULL AND "deletedAt" IS NULL;

-- 7) FINANCIAL YEAR: enforce valid date ranges
DO $$
BEGIN
  ALTER TABLE "FinancialYear"
    ADD CONSTRAINT "chk_fy_dates" CHECK ("endDate" > "startDate");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 8) VOUCHER SEQUENCE: no negative counter values
DO $$
BEGIN
  ALTER TABLE "VoucherSequence"
    ADD CONSTRAINT "chk_seq" CHECK ("currentValue" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 9) INVOICE: enforce version uniqueness and latest-chain invariant
CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_company_fy_number_version_active_key"
  ON "Invoice" ("companyId", "financialYearId", "invoiceNumber", "version")
  WHERE "deletedAt" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_original_latest_unique_key"
  ON "Invoice" ("originalId")
  WHERE "isLatest" = true AND "originalId" IS NOT NULL;

-- 10) STOCK: positive movement quantity
DO $$
BEGIN
  ALTER TABLE "StockMovement"
    ADD CONSTRAINT "chk_stock_qty" CHECK (quantity > 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
