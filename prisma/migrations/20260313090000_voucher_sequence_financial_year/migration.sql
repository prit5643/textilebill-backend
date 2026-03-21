-- CreateEnum
CREATE TYPE "VoucherSeries" AS ENUM ('CB', 'BB', 'JV', 'OB');

-- CreateTable
CREATE TABLE "VoucherSequence" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "financialYearId" TEXT NOT NULL,
    "series" "VoucherSeries" NOT NULL,
    "currentNumber" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoucherSequence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VoucherSequence_companyId_financialYearId_series_key" ON "VoucherSequence"("companyId", "financialYearId", "series");
CREATE INDEX "VoucherSequence_companyId_financialYearId_idx" ON "VoucherSequence"("companyId", "financialYearId");

-- AddForeignKey
ALTER TABLE "VoucherSequence"
ADD CONSTRAINT "VoucherSequence_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VoucherSequence"
ADD CONSTRAINT "VoucherSequence_financialYearId_fkey"
FOREIGN KEY ("financialYearId") REFERENCES "FinancialYear"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
