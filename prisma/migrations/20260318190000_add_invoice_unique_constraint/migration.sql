-- AddUniqueConstraint to ensure no duplicate (companyId, invoiceType, invoiceNumber)
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_companyId_invoiceType_invoiceNumber_key" UNIQUE ("companyId", "invoiceType", "invoiceNumber");
