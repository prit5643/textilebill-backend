-- CreateEnum
CREATE TYPE "PersonType" AS ENUM ('PARTNER', 'MANAGER', 'WORKER', 'ACCOUNTANT', 'OTHER');

-- CreateEnum
CREATE TYPE "ExpenseSourceType" AS ENUM ('COMPANY_CASH', 'COMPANY_BANK', 'PERSONAL', 'PERSONAL_OUT_OF_POCKET');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'SETTLED');

-- CreateEnum
CREATE TYPE "SalaryAdvanceStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PARTIALLY_ADJUSTED', 'SETTLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReimbursementStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'SETTLED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReimbursementSettlementMode" AS ENUM ('DIRECT_PAYMENT', 'SALARY_ADDITION', 'CARRY_FORWARD');

-- CreateEnum
CREATE TYPE "ExpenseAttachmentType" AS ENUM ('BILL_IMAGE', 'INVOICE_PDF', 'PAYSLIP', 'OTHER');

-- CreateEnum
CREATE TYPE "CostCenterType" AS ENUM ('MONTHLY_POOL', 'PRODUCTION_LOT', 'ORDER', 'DEPARTMENT', 'MACHINE', 'LOT', 'MONTH');

-- DropForeignKey
ALTER TABLE "InvoiceItem" DROP CONSTRAINT "InvoiceItem_invoiceId_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "LedgerEntry" DROP CONSTRAINT "LedgerEntry_invoiceId_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "StockMovement" DROP CONSTRAINT "StockMovement_invoiceId_tenantId_fkey";

-- DropIndex
DROP INDEX "LedgerEntry_tenantId_invoiceId_idx";

-- DropIndex
DROP INDEX "StockMovement_tenantId_invoiceId_idx";

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "costCenterId" TEXT,
ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "VoucherSequence" DROP COLUMN "createdAt",
DROP COLUMN "updatedAt";

-- CreateTable
CREATE TABLE "CompanyPerson" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "linkedUserId" TEXT,
    "name" TEXT NOT NULL,
    "personType" "PersonType" NOT NULL,
    "phone" TEXT,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "joinedAt" DATE,
    "leftAt" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CompanyPerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "requiresPerson" BOOLEAN NOT NULL DEFAULT false,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "personId" TEXT,
    "costCenterId" TEXT,
    "referenceId" TEXT,
    "expenseDate" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "sourceType" "ExpenseSourceType" NOT NULL DEFAULT 'COMPANY_CASH',
    "status" "ExpenseStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "isBackdated" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ExpenseEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseAttachment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "expenseEntryId" TEXT,
    "reimbursementClaimId" TEXT,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "attachmentType" "ExpenseAttachmentType" NOT NULL DEFAULT 'OTHER',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenseAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryProfile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "monthlyGross" DECIMAL(14,2) NOT NULL,
    "effectiveFrom" DATE,
    "effectiveTo" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SalaryProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryAdvance" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "advanceDate" DATE NOT NULL,
    "reason" TEXT,
    "status" "SalaryAdvanceStatus" NOT NULL DEFAULT 'ACTIVE',
    "remainingAmount" DECIMAL(14,2) NOT NULL,
    "settledAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SalaryAdvance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalarySettlement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "grossSalary" DECIMAL(14,2) NOT NULL,
    "advanceDeduction" DECIMAL(14,2) NOT NULL,
    "reimbursementAddition" DECIMAL(14,2) NOT NULL,
    "otherAdjustments" DECIMAL(14,2) NOT NULL,
    "netPayable" DECIMAL(14,2) NOT NULL,
    "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paidDate" DATE,
    "carryForwardAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalarySettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReimbursementClaim" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "claimDate" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "ReimbursementStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "settlementMode" "ReimbursementSettlementMode",
    "settledAt" DATE,
    "settledInSalarySettlementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ReimbursementClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostCenter" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "scopeType" "CostCenterType" NOT NULL,
    "scopeReference" TEXT,
    "startDate" DATE,
    "endDate" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CostCenter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostAllocation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "expenseEntryId" TEXT NOT NULL,
    "costCenterId" TEXT NOT NULL,
    "allocatedAmount" DECIMAL(14,2) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyPerson_tenantId_companyId_idx" ON "CompanyPerson"("tenantId", "companyId");

-- CreateIndex
CREATE INDEX "CompanyPerson_companyId_status_idx" ON "CompanyPerson"("companyId", "status");

-- CreateIndex
CREATE INDEX "CompanyPerson_deletedAt_idx" ON "CompanyPerson"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyPerson_id_tenantId_key" ON "CompanyPerson"("id", "tenantId");

-- CreateIndex
CREATE INDEX "ExpenseCategory_tenantId_companyId_idx" ON "ExpenseCategory"("tenantId", "companyId");

-- CreateIndex
CREATE INDEX "ExpenseCategory_companyId_isActive_idx" ON "ExpenseCategory"("companyId", "isActive");

-- CreateIndex
CREATE INDEX "ExpenseCategory_deletedAt_idx" ON "ExpenseCategory"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_id_tenantId_key" ON "ExpenseCategory"("id", "tenantId");

-- CreateIndex
CREATE INDEX "ExpenseEntry_tenantId_companyId_expenseDate_idx" ON "ExpenseEntry"("tenantId", "companyId", "expenseDate");

-- CreateIndex
CREATE INDEX "ExpenseEntry_companyId_status_idx" ON "ExpenseEntry"("companyId", "status");

-- CreateIndex
CREATE INDEX "ExpenseEntry_categoryId_idx" ON "ExpenseEntry"("categoryId");

-- CreateIndex
CREATE INDEX "ExpenseEntry_personId_idx" ON "ExpenseEntry"("personId");

-- CreateIndex
CREATE INDEX "ExpenseEntry_costCenterId_idx" ON "ExpenseEntry"("costCenterId");

-- CreateIndex
CREATE INDEX "ExpenseEntry_companyId_expenseDate_status_categoryId_idx" ON "ExpenseEntry"("companyId", "expenseDate", "status", "categoryId");

-- CreateIndex
CREATE INDEX "ExpenseEntry_deletedAt_idx" ON "ExpenseEntry"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseEntry_id_tenantId_key" ON "ExpenseEntry"("id", "tenantId");

-- CreateIndex
CREATE INDEX "ExpenseAttachment_tenantId_companyId_idx" ON "ExpenseAttachment"("tenantId", "companyId");

-- CreateIndex
CREATE INDEX "ExpenseAttachment_expenseEntryId_idx" ON "ExpenseAttachment"("expenseEntryId");

-- CreateIndex
CREATE INDEX "ExpenseAttachment_reimbursementClaimId_idx" ON "ExpenseAttachment"("reimbursementClaimId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseAttachment_id_tenantId_key" ON "ExpenseAttachment"("id", "tenantId");

-- CreateIndex
CREATE INDEX "SalaryProfile_tenantId_companyId_idx" ON "SalaryProfile"("tenantId", "companyId");

-- CreateIndex
CREATE INDEX "SalaryProfile_personId_idx" ON "SalaryProfile"("personId");

-- CreateIndex
CREATE INDEX "SalaryProfile_companyId_isActive_idx" ON "SalaryProfile"("companyId", "isActive");

-- CreateIndex
CREATE INDEX "SalaryProfile_deletedAt_idx" ON "SalaryProfile"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryProfile_id_tenantId_key" ON "SalaryProfile"("id", "tenantId");

-- CreateIndex
CREATE INDEX "SalaryAdvance_tenantId_companyId_idx" ON "SalaryAdvance"("tenantId", "companyId");

-- CreateIndex
CREATE INDEX "SalaryAdvance_personId_idx" ON "SalaryAdvance"("personId");

-- CreateIndex
CREATE INDEX "SalaryAdvance_companyId_status_idx" ON "SalaryAdvance"("companyId", "status");

-- CreateIndex
CREATE INDEX "SalaryAdvance_deletedAt_idx" ON "SalaryAdvance"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryAdvance_id_tenantId_key" ON "SalaryAdvance"("id", "tenantId");

-- CreateIndex
CREATE INDEX "SalarySettlement_tenantId_companyId_idx" ON "SalarySettlement"("tenantId", "companyId");

-- CreateIndex
CREATE INDEX "SalarySettlement_personId_idx" ON "SalarySettlement"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "SalarySettlement_companyId_personId_year_month_key" ON "SalarySettlement"("companyId", "personId", "year", "month");

-- CreateIndex
CREATE INDEX "ReimbursementClaim_tenantId_companyId_idx" ON "ReimbursementClaim"("tenantId", "companyId");

-- CreateIndex
CREATE INDEX "ReimbursementClaim_personId_idx" ON "ReimbursementClaim"("personId");

-- CreateIndex
CREATE INDEX "ReimbursementClaim_status_idx" ON "ReimbursementClaim"("status");

-- CreateIndex
CREATE INDEX "ReimbursementClaim_deletedAt_idx" ON "ReimbursementClaim"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReimbursementClaim_id_tenantId_key" ON "ReimbursementClaim"("id", "tenantId");

-- CreateIndex
CREATE INDEX "CostCenter_tenantId_companyId_idx" ON "CostCenter"("tenantId", "companyId");

-- CreateIndex
CREATE INDEX "CostCenter_companyId_isActive_idx" ON "CostCenter"("companyId", "isActive");

-- CreateIndex
CREATE INDEX "CostCenter_deletedAt_idx" ON "CostCenter"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CostCenter_id_tenantId_key" ON "CostCenter"("id", "tenantId");

-- CreateIndex
CREATE INDEX "CostAllocation_tenantId_companyId_idx" ON "CostAllocation"("tenantId", "companyId");

-- CreateIndex
CREATE INDEX "CostAllocation_expenseEntryId_idx" ON "CostAllocation"("expenseEntryId");

-- CreateIndex
CREATE INDEX "CostAllocation_costCenterId_idx" ON "CostAllocation"("costCenterId");

-- CreateIndex
CREATE UNIQUE INDEX "CostAllocation_id_tenantId_key" ON "CostAllocation"("id", "tenantId");

-- CreateIndex
CREATE INDEX "Invoice_costCenterId_idx" ON "Invoice"("costCenterId");

-- CreateIndex
CREATE INDEX "LedgerEntry_invoiceId_idx" ON "LedgerEntry"("invoiceId");

-- CreateIndex
CREATE INDEX "OtpChallenge_userId_purpose_idx" ON "OtpChallenge"("userId", "purpose");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE INDEX "StockMovement_invoiceId_idx" ON "StockMovement"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyPerson" ADD CONSTRAINT "CompanyPerson_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyPerson" ADD CONSTRAINT "CompanyPerson_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyPerson" ADD CONSTRAINT "CompanyPerson_linkedUserId_tenantId_fkey" FOREIGN KEY ("linkedUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseCategory" ADD CONSTRAINT "ExpenseCategory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseCategory" ADD CONSTRAINT "ExpenseCategory_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseEntry" ADD CONSTRAINT "ExpenseEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseEntry" ADD CONSTRAINT "ExpenseEntry_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseEntry" ADD CONSTRAINT "ExpenseEntry_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseEntry" ADD CONSTRAINT "ExpenseEntry_personId_fkey" FOREIGN KEY ("personId") REFERENCES "CompanyPerson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseEntry" ADD CONSTRAINT "ExpenseEntry_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseEntry" ADD CONSTRAINT "ExpenseEntry_createdById_tenantId_fkey" FOREIGN KEY ("createdById", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseEntry" ADD CONSTRAINT "ExpenseEntry_updatedById_tenantId_fkey" FOREIGN KEY ("updatedById", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseAttachment" ADD CONSTRAINT "ExpenseAttachment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseAttachment" ADD CONSTRAINT "ExpenseAttachment_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseAttachment" ADD CONSTRAINT "ExpenseAttachment_expenseEntryId_fkey" FOREIGN KEY ("expenseEntryId") REFERENCES "ExpenseEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseAttachment" ADD CONSTRAINT "ExpenseAttachment_reimbursementClaimId_fkey" FOREIGN KEY ("reimbursementClaimId") REFERENCES "ReimbursementClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseAttachment" ADD CONSTRAINT "ExpenseAttachment_createdById_tenantId_fkey" FOREIGN KEY ("createdById", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryProfile" ADD CONSTRAINT "SalaryProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryProfile" ADD CONSTRAINT "SalaryProfile_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryProfile" ADD CONSTRAINT "SalaryProfile_personId_fkey" FOREIGN KEY ("personId") REFERENCES "CompanyPerson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryAdvance" ADD CONSTRAINT "SalaryAdvance_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryAdvance" ADD CONSTRAINT "SalaryAdvance_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryAdvance" ADD CONSTRAINT "SalaryAdvance_personId_fkey" FOREIGN KEY ("personId") REFERENCES "CompanyPerson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalarySettlement" ADD CONSTRAINT "SalarySettlement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalarySettlement" ADD CONSTRAINT "SalarySettlement_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalarySettlement" ADD CONSTRAINT "SalarySettlement_personId_fkey" FOREIGN KEY ("personId") REFERENCES "CompanyPerson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReimbursementClaim" ADD CONSTRAINT "ReimbursementClaim_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReimbursementClaim" ADD CONSTRAINT "ReimbursementClaim_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReimbursementClaim" ADD CONSTRAINT "ReimbursementClaim_personId_fkey" FOREIGN KEY ("personId") REFERENCES "CompanyPerson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReimbursementClaim" ADD CONSTRAINT "ReimbursementClaim_settledInSalarySettlementId_fkey" FOREIGN KEY ("settledInSalarySettlementId") REFERENCES "SalarySettlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostCenter" ADD CONSTRAINT "CostCenter_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostCenter" ADD CONSTRAINT "CostCenter_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostAllocation" ADD CONSTRAINT "CostAllocation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostAllocation" ADD CONSTRAINT "CostAllocation_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostAllocation" ADD CONSTRAINT "CostAllocation_expenseEntryId_fkey" FOREIGN KEY ("expenseEntryId") REFERENCES "ExpenseEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostAllocation" ADD CONSTRAINT "CostAllocation_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "Product_brandId_idx" RENAME TO "Product_companyId_brandId_idx";

-- RenameIndex
ALTER INDEX "Product_cardTypeId_idx" RENAME TO "Product_companyId_cardTypeId_idx";

-- RenameIndex
ALTER INDEX "Product_categoryId_idx" RENAME TO "Product_companyId_categoryId_idx";

-- RenameIndex
ALTER INDEX "Product_classificationId_idx" RENAME TO "Product_companyId_classificationId_idx";

-- RenameIndex
ALTER INDEX "Product_serviceCategoryId_idx" RENAME TO "Product_companyId_serviceCategoryId_idx";

-- RenameIndex
ALTER INDEX "Product_uomId_idx" RENAME TO "Product_companyId_uomId_idx";

