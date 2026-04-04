# User DB Relations and Migration Notes

Historical note refreshed on `2026-03-30`

## Status

This document is retained as a migration-era DBA note. It is no longer the canonical schema reference.

Use these current sources first:

- `prisma/schema.prisma`
- `docs/database-schema.md`
- `docs/database-operations.md`

## Final Migration Outcome

The schema migration is complete in the current workspace state.

Current active relationship model:

- `Tenant` -> `Company`
- `Tenant` -> `User`
- `User` <-> `Company` via `UserCompany`
- `Company` -> `Account`
- `Account` -> `Party`
- `Company` -> `Product`
- `Company` -> `FinancialYear`
- `Company` -> `VoucherSequence`
- `Company` -> `Invoice`
- `Invoice` -> `InvoiceItem`
- `Invoice` -> `LedgerEntry`
- `Invoice` -> `StockMovement`
- `Tenant` -> `Subscription` -> `Plan`

## Legacy Models Removed From Active Persistence

These names may appear in older migration notes, but they are not active Prisma models now:

- `UserCompanyAccess`
- `PasswordLifecycleToken`
- `CompanySettings`
- `ModulePermission`
- `AuditLog`
- `InvoicePayment`
- `InvoiceNumberConfig`
- `AccountGroup`
- `Broker`
- `ProductCategory`
- `Brand`
- `UnitOfMeasurement`
- `CashBookEntry`
- `BankBookEntry`
- `JournalEntry`
- `OpeningStock`
- `StockAdjustment`

## Current Operational Guidance

- treat `UserCompany` as the only active user-to-company access model
- treat `LedgerEntry` and `StockMovement` as the durable accounting and inventory ledgers
- treat `VoucherSequence` as the active numbering primitive
- treat this file as historical context only
