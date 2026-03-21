CREATE INDEX IF NOT EXISTS "Account_companyId_name_idx"
ON "Account"("companyId", "name");

CREATE INDEX IF NOT EXISTS "Invoice_companyId_accountId_invoiceDate_idx"
ON "Invoice"("companyId", "accountId", "invoiceDate");

CREATE INDEX IF NOT EXISTS "Invoice_companyId_invoiceType_status_invoiceDate_idx"
ON "Invoice"("companyId", "invoiceType", "status", "invoiceDate");

CREATE INDEX IF NOT EXISTS "LedgerEntry_companyId_date_idx"
ON "LedgerEntry"("companyId", "date");

CREATE INDEX IF NOT EXISTS "LedgerEntry_companyId_voucherType_voucherNumber_idx"
ON "LedgerEntry"("companyId", "voucherType", "voucherNumber");

CREATE INDEX IF NOT EXISTS "CashBookEntry_companyId_date_idx"
ON "CashBookEntry"("companyId", "date");

CREATE INDEX IF NOT EXISTS "CashBookEntry_companyId_bookName_date_idx"
ON "CashBookEntry"("companyId", "bookName", "date");

CREATE INDEX IF NOT EXISTS "BankBookEntry_companyId_date_idx"
ON "BankBookEntry"("companyId", "date");

CREATE INDEX IF NOT EXISTS "BankBookEntry_companyId_bookName_date_idx"
ON "BankBookEntry"("companyId", "bookName", "date");

CREATE INDEX IF NOT EXISTS "JournalEntry_companyId_date_idx"
ON "JournalEntry"("companyId", "date");

CREATE INDEX IF NOT EXISTS "OpeningStock_companyId_createdAt_idx"
ON "OpeningStock"("companyId", "createdAt");

CREATE INDEX IF NOT EXISTS "StockAdjustment_companyId_date_idx"
ON "StockAdjustment"("companyId", "date");
