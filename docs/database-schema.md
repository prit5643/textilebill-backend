# Database Schema Reference

Primary schema file: `prisma/schema.prisma`

DBA deep-dive reference:
- `docs/USER_DB_RELATIONS_AND_SIMPLE_MIGRATION.md` (relations, index inventory, performance diagnostics, migration safety workflow)

## Domain Areas

1. SaaS Layer
   - `Plan`, `Tenant`, `Subscription`
2. Identity Layer
   - `User`, `RefreshToken`, `UserCompanyAccess`
3. Company Layer
   - `Company`, `CompanySettings`, `FinancialYear`
4. Product & Inventory
   - `Product`, `ProductCategory`, `Brand`, `UnitOfMeasurement`, `StockMovement`, `OpeningStock`, `StockAdjustment`
5. Accounting & Ledger
   - `AccountGroup`, `Account`, `Broker`, `LedgerEntry`, `CashBookEntry`, `BankBookEntry`, `JournalEntry`, `JournalEntryLine`
6. Invoice & Payments
   - `InvoiceNumberConfig`, `Invoice`, `InvoiceItem`, `InvoicePayment`
7. Security/Audit
   - `ModulePermission`, `AuditLog`

## Critical Runtime Schema Requirements

The readiness check currently verifies that these exist:

- Tables:
  - `Plan`
  - `Tenant`
  - `User`
  - `Company`
  - `CompanySettings`
  - `FinancialYear`
  - `Product`
  - `AccountGroup`
- Columns:
  - `Product.version`
  - `Plan.maxCompanies`

Missing any of these should be treated as deployment/migration drift.

## Migration Ownership Rules

- Add/modify tables and columns only through Prisma migrations.
- Do not patch production schema manually except emergency hotfixes.
- After emergency SQL, create a tracked migration to re-align environments.

## Adding New Fields Safely

When adding a new field:

1. Update `prisma/schema.prisma`.
2. Generate migration:
   - `npx prisma migrate dev --name <change_name>` (dev)
3. Commit migration SQL.
4. Deploy with:
   - `npm run db:migrate:deploy`
5. Add or update bootstrap data only if feature requires baseline reference data.
