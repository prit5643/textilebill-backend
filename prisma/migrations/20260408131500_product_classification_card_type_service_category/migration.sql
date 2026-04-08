ALTER TYPE "ProductOptionKind" ADD VALUE IF NOT EXISTS 'CLASSIFICATION';
ALTER TYPE "ProductOptionKind" ADD VALUE IF NOT EXISTS 'CARD_TYPE';
ALTER TYPE "ProductOptionKind" ADD VALUE IF NOT EXISTS 'SERVICE_CATEGORY';

ALTER TABLE "Product"
ADD COLUMN "classificationId" TEXT,
ADD COLUMN "cardTypeId" TEXT,
ADD COLUMN "serviceCategoryId" TEXT;

CREATE INDEX "Product_classificationId_idx" ON "Product"("companyId", "classificationId");
CREATE INDEX "Product_cardTypeId_idx" ON "Product"("companyId", "cardTypeId");
CREATE INDEX "Product_serviceCategoryId_idx" ON "Product"("companyId", "serviceCategoryId");

ALTER TABLE "Product"
ADD CONSTRAINT "Product_classificationId_fkey" FOREIGN KEY ("classificationId") REFERENCES "ProductOption"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "Product_cardTypeId_fkey" FOREIGN KEY ("cardTypeId") REFERENCES "ProductOption"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "Product_serviceCategoryId_fkey" FOREIGN KEY ("serviceCategoryId") REFERENCES "ProductOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;
