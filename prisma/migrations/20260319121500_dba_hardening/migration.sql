-- DBA hardening: security fields, index coverage, and referential safety

-- RefreshToken: support hashed token storage and expiry cleanup index.
ALTER TABLE "RefreshToken"
  ALTER COLUMN "token" DROP NOT NULL,
  ADD COLUMN "tokenHash" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "RefreshToken_tokenHash_key"
  ON "RefreshToken"("tokenHash");

CREATE INDEX IF NOT EXISTS "RefreshToken_expiresAt_idx"
  ON "RefreshToken"("expiresAt");

-- CompanySettings: encrypted credential storage columns.
ALTER TABLE "CompanySettings"
  ADD COLUMN "ewayBillPasswordEnc" TEXT,
  ADD COLUMN "einvoicePasswordEnc" TEXT;

-- AuditLog: tenant-aware filtering and reporting indexes.
ALTER TABLE "AuditLog"
  ADD COLUMN "tenantId" TEXT;

CREATE INDEX IF NOT EXISTS "AuditLog_tenantId_createdAt_idx"
  ON "AuditLog"("tenantId", "createdAt");

CREATE INDEX IF NOT EXISTS "AuditLog_companyId_entity_createdAt_idx"
  ON "AuditLog"("companyId", "entity", "createdAt");

CREATE INDEX IF NOT EXISTS "AuditLog_entityId_entity_idx"
  ON "AuditLog"("entityId", "entity");

-- Lookup/index coverage recommended by DBA review.
CREATE INDEX IF NOT EXISTS "UserCompanyAccess_companyId_userId_idx"
  ON "UserCompanyAccess"("companyId", "userId");

CREATE INDEX IF NOT EXISTS "FinancialYear_companyId_isActive_idx"
  ON "FinancialYear"("companyId", "isActive")
  WHERE "isActive" = true;

CREATE INDEX IF NOT EXISTS "Subscription_tenantId_endDate_status_idx"
  ON "Subscription"("tenantId", "endDate", "status")
  WHERE "status" = 'ACTIVE';

-- Preserve ledger history while avoiding dangling FK references.
ALTER TABLE "LedgerEntry" DROP CONSTRAINT IF EXISTS "LedgerEntry_invoiceId_fkey";
ALTER TABLE "LedgerEntry"
  ADD CONSTRAINT "LedgerEntry_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
