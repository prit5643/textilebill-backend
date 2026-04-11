ALTER TABLE "InvoiceItem"
ADD COLUMN "productName" TEXT,
ADD COLUMN "productHsnCode" TEXT,
ADD COLUMN "productUnit" TEXT;

UPDATE "InvoiceItem" AS ii
SET
  "productName" = p."name",
  "productHsnCode" = p."hsnCode",
  "productUnit" = p."unit"
FROM "Product" AS p
WHERE ii."productId" = p."id"
  AND ii."tenantId" = p."tenantId"
  AND (ii."productName" IS NULL OR ii."productUnit" IS NULL);
