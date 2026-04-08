CREATE TYPE "ProductType" AS ENUM ('GOODS', 'SERVICES');
CREATE TYPE "GstConsiderAs" AS ENUM (
    'TAXABLE',
    'NIL_RATED',
    'EXEMPTED',
    'ZERO_RATED',
    'NON_GST',
    'REVERSE_CHARGE'
);
CREATE TYPE "ProductOptionKind" AS ENUM ('CATEGORY', 'BRAND', 'UOM');

ALTER TABLE "Product"
ADD COLUMN "description" TEXT,
ADD COLUMN "buyingPrice" DECIMAL(14,2),
ADD COLUMN "mrp" DECIMAL(14,2),
ADD COLUMN "wholesalerPrice" DECIMAL(14,2),
ADD COLUMN "distributorPrice" DECIMAL(14,2),
ADD COLUMN "type" "ProductType" NOT NULL DEFAULT 'GOODS',
ADD COLUMN "gstConsiderAs" "GstConsiderAs" NOT NULL DEFAULT 'TAXABLE',
ADD COLUMN "categoryId" TEXT,
ADD COLUMN "brandId" TEXT,
ADD COLUMN "uomId" TEXT,
ADD COLUMN "defaultQty" DECIMAL(14,3),
ADD COLUMN "defaultDiscount" DECIMAL(5,2),
ADD COLUMN "minimumQty" DECIMAL(14,3);

CREATE TABLE "ProductOption" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "ProductOptionKind" NOT NULL,
    "name" TEXT NOT NULL,
    "fullName" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ProductOption_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductOption_id_tenantId_key" ON "ProductOption"("id", "tenantId");
CREATE INDEX "Product_categoryId_idx" ON "Product"("companyId", "categoryId");
CREATE INDEX "Product_brandId_idx" ON "Product"("companyId", "brandId");
CREATE INDEX "Product_uomId_idx" ON "Product"("companyId", "uomId");
CREATE INDEX "ProductOption_tenantId_companyId_kind_idx" ON "ProductOption"("tenantId", "companyId", "kind");
CREATE INDEX "ProductOption_deletedAt_idx" ON "ProductOption"("deletedAt");

ALTER TABLE "ProductOption"
ADD CONSTRAINT "ProductOption_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "ProductOption_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Product"
ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProductOption"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "ProductOption"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "Product_uomId_fkey" FOREIGN KEY ("uomId") REFERENCES "ProductOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;
