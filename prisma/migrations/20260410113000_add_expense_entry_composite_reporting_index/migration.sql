DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'ExpenseEntry'
  ) THEN
    CREATE INDEX IF NOT EXISTS "ExpenseEntry_companyId_expenseDate_status_categoryId_idx"
      ON "ExpenseEntry"("companyId", "expenseDate", "status", "categoryId");
  END IF;
END $$;
