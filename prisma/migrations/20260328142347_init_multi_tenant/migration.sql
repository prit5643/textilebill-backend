-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'ADMIN', 'MANAGER', 'ACCOUNTANT', 'VIEWER');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('SALE', 'PURCHASE', 'SALE_RETURN', 'PURCHASE_RETURN');

-- CreateEnum
CREATE TYPE "EntityStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "AccountGroupType" AS ENUM ('SUNDRY_DEBTORS', 'SUNDRY_CREDITORS', 'BANK', 'CASH', 'CAPITAL', 'EXPENSE');

-- CreateEnum
CREATE TYPE "VoucherType" AS ENUM ('SALE', 'PURCHASE', 'SALE_RETURN', 'PURCHASE_RETURN', 'PAYMENT', 'RECEIPT', 'JOURNAL');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('LOGIN', 'RESET_PASSWORD', 'VERIFY_EMAIL');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gstin" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "logoUrl" TEXT,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserCompany" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "deviceId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpChallenge" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "otpHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Party" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gstin" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Party_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "group" "AccountGroupType" NOT NULL,
    "openingBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'MTR',
    "price" DECIMAL(14,2) NOT NULL,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "hsnCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialYear" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoucherSequence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "financialYearId" TEXT NOT NULL,
    "type" "VoucherType" NOT NULL,
    "prefix" TEXT NOT NULL,
    "currentValue" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoucherSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "financialYearId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceDate" DATE NOT NULL,
    "dueDate" DATE,
    "type" "InvoiceType" NOT NULL DEFAULT 'SALE',
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "originalId" TEXT,
    "isLatest" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "subTotal" DECIMAL(14,2) NOT NULL,
    "taxAmount" DECIMAL(14,2) NOT NULL,
    "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "date" DATE NOT NULL,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "narration" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "type" "MovementType" NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "date" DATE NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Tenant_deletedAt_idx" ON "Tenant"("deletedAt");

-- CreateIndex
CREATE INDEX "Company_tenantId_status_idx" ON "Company"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Company_deletedAt_idx" ON "Company"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Company_id_tenantId_key" ON "Company"("id", "tenantId");

-- CreateIndex
CREATE INDEX "User_tenantId_email_idx" ON "User"("tenantId", "email");

-- CreateIndex
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_id_tenantId_key" ON "User"("id", "tenantId");

-- CreateIndex
CREATE INDEX "UserCompany_tenantId_companyId_idx" ON "UserCompany"("tenantId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "UserCompany_tenantId_userId_companyId_key" ON "UserCompany"("tenantId", "userId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_revokedAt_idx" ON "RefreshToken"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "OtpChallenge_userId_purpose_idx" ON "OtpChallenge"("userId", "purpose");

-- CreateIndex
CREATE INDEX "Party_tenantId_companyId_idx" ON "Party"("tenantId", "companyId");

-- CreateIndex
CREATE INDEX "Party_tenantId_name_idx" ON "Party"("tenantId", "name");

-- CreateIndex
CREATE INDEX "Party_deletedAt_idx" ON "Party"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Party_id_tenantId_key" ON "Party"("id", "tenantId");

-- CreateIndex
CREATE INDEX "Account_tenantId_companyId_idx" ON "Account"("tenantId", "companyId");

-- CreateIndex
CREATE INDEX "Account_deletedAt_idx" ON "Account"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Account_id_tenantId_key" ON "Account"("id", "tenantId");

-- CreateIndex
CREATE INDEX "Product_tenantId_companyId_idx" ON "Product"("tenantId", "companyId");

-- CreateIndex
CREATE INDEX "Product_deletedAt_idx" ON "Product"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Product_id_tenantId_key" ON "Product"("id", "tenantId");

-- CreateIndex
CREATE INDEX "FinancialYear_tenantId_idx" ON "FinancialYear"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialYear_id_tenantId_key" ON "FinancialYear"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialYear_companyId_startDate_endDate_key" ON "FinancialYear"("companyId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "VoucherSequence_tenantId_idx" ON "VoucherSequence"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "VoucherSequence_companyId_financialYearId_type_key" ON "VoucherSequence"("companyId", "financialYearId", "type");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_companyId_invoiceDate_idx" ON "Invoice"("tenantId", "companyId", "invoiceDate");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_companyId_accountId_idx" ON "Invoice"("tenantId", "companyId", "accountId");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_status_isLatest_idx" ON "Invoice"("tenantId", "status", "isLatest");

-- CreateIndex
CREATE INDEX "Invoice_originalId_idx" ON "Invoice"("originalId");

-- CreateIndex
CREATE INDEX "Invoice_deletedAt_idx" ON "Invoice"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_id_tenantId_key" ON "Invoice"("id", "tenantId");

-- CreateIndex
CREATE INDEX "InvoiceItem_tenantId_invoiceId_idx" ON "InvoiceItem"("tenantId", "invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceItem_tenantId_productId_idx" ON "InvoiceItem"("tenantId", "productId");

-- CreateIndex
CREATE INDEX "LedgerEntry_tenantId_accountId_date_idx" ON "LedgerEntry"("tenantId", "accountId", "date");

-- CreateIndex
CREATE INDEX "LedgerEntry_tenantId_companyId_date_idx" ON "LedgerEntry"("tenantId", "companyId", "date");

-- CreateIndex
CREATE INDEX "LedgerEntry_tenantId_invoiceId_idx" ON "LedgerEntry"("tenantId", "invoiceId");

-- CreateIndex
CREATE INDEX "LedgerEntry_deletedAt_idx" ON "LedgerEntry"("deletedAt");

-- CreateIndex
CREATE INDEX "StockMovement_tenantId_companyId_productId_date_idx" ON "StockMovement"("tenantId", "companyId", "productId", "date");

-- CreateIndex
CREATE INDEX "StockMovement_tenantId_invoiceId_idx" ON "StockMovement"("tenantId", "invoiceId");

-- CreateIndex
CREATE INDEX "StockMovement_deletedAt_idx" ON "StockMovement"("deletedAt");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCompany" ADD CONSTRAINT "UserCompany_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCompany" ADD CONSTRAINT "UserCompany_userId_tenantId_fkey" FOREIGN KEY ("userId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCompany" ADD CONSTRAINT "UserCompany_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_tenantId_fkey" FOREIGN KEY ("userId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtpChallenge" ADD CONSTRAINT "OtpChallenge_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtpChallenge" ADD CONSTRAINT "OtpChallenge_userId_tenantId_fkey" FOREIGN KEY ("userId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Party" ADD CONSTRAINT "Party_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Party" ADD CONSTRAINT "Party_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_partyId_tenantId_fkey" FOREIGN KEY ("partyId", "tenantId") REFERENCES "Party"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialYear" ADD CONSTRAINT "FinancialYear_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialYear" ADD CONSTRAINT "FinancialYear_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherSequence" ADD CONSTRAINT "VoucherSequence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherSequence" ADD CONSTRAINT "VoucherSequence_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherSequence" ADD CONSTRAINT "VoucherSequence_financialYearId_tenantId_fkey" FOREIGN KEY ("financialYearId", "tenantId") REFERENCES "FinancialYear"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_accountId_tenantId_fkey" FOREIGN KEY ("accountId", "tenantId") REFERENCES "Account"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_financialYearId_tenantId_fkey" FOREIGN KEY ("financialYearId", "tenantId") REFERENCES "FinancialYear"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_originalId_fkey" FOREIGN KEY ("originalId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_invoiceId_tenantId_fkey" FOREIGN KEY ("invoiceId", "tenantId") REFERENCES "Invoice"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_productId_tenantId_fkey" FOREIGN KEY ("productId", "tenantId") REFERENCES "Product"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_accountId_tenantId_fkey" FOREIGN KEY ("accountId", "tenantId") REFERENCES "Account"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_invoiceId_tenantId_fkey" FOREIGN KEY ("invoiceId", "tenantId") REFERENCES "Invoice"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_tenantId_fkey" FOREIGN KEY ("productId", "tenantId") REFERENCES "Product"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_invoiceId_tenantId_fkey" FOREIGN KEY ("invoiceId", "tenantId") REFERENCES "Invoice"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ==========================================
-- CUSTOM CONSTRAINTS: PARTIAL INDEXES & CHECKS
-- ==========================================

-- 1. PREVENT DUPLICATES FOR ACTIVE RECORDS ONLY
CREATE UNIQUE INDEX "User_email_deletedAt_key" ON "User"("email") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "User_phone_deletedAt_key" ON "User"("phone") WHERE "phone" IS NOT NULL AND "deletedAt" IS NULL;

CREATE UNIQUE INDEX "Company_gstin_deletedAt_key" ON "Company"("gstin") WHERE "gstin" IS NOT NULL AND "deletedAt" IS NULL;

CREATE UNIQUE INDEX "Party_email_deletedAt_companyId_key" ON "Party"("companyId", "email") WHERE "email" IS NOT NULL AND "deletedAt" IS NULL;
CREATE UNIQUE INDEX "Party_phone_deletedAt_companyId_key" ON "Party"("companyId", "phone") WHERE "phone" IS NOT NULL AND "deletedAt" IS NULL;

CREATE UNIQUE INDEX "Product_sku_deletedAt_companyId_key" ON "Product"("companyId", "sku") WHERE "sku" IS NOT NULL AND "deletedAt" IS NULL;

-- 2. ENFORCE POSITIVE BALANCES & AMOUNTS (CHECK CONSTRAINTS)
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_debit_check" CHECK (debit >= 0);
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_credit_check" CHECK (credit >= 0);
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "chk_ledger_sides" CHECK (debit >= 0 AND credit >= 0 AND (debit > 0 OR credit > 0));
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "chk_no_mixed_entry" CHECK (NOT (debit > 0 AND credit > 0));

ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_quantity_check" CHECK (quantity > 0);
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_rate_check" CHECK (rate >= 0);
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_amount_check" CHECK (amount >= 0);
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_taxAmount_check" CHECK ("taxAmount" >= 0);

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_subTotal_check" CHECK ("subTotal" >= 0);
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_taxAmount_check" CHECK ("taxAmount" >= 0);
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_totalAmount_check" CHECK ("totalAmount" >= 0);
ALTER TABLE "Invoice" ADD CONSTRAINT "chk_invoice_amounts" CHECK ("subTotal" >= 0 AND "taxAmount" >= 0 AND "discountAmount" >= 0 AND "totalAmount" >= 0);
ALTER TABLE "Invoice" ADD CONSTRAINT "chk_invoice_total" CHECK ("totalAmount" = "subTotal" + "taxAmount" - "discountAmount");
ALTER TABLE "Invoice" ADD CONSTRAINT "chk_invoice_version" CHECK (version >= 1);
