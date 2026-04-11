# Database Schema Reference

Primary source of truth: `prisma/schema.prisma`

Last updated: `2026-03-30`

## Active Enums

- `UserRole`: `OWNER`, `ADMIN`, `MANAGER`, `ACCOUNTANT`, `VIEWER`
- `InvoiceStatus`: `DRAFT`, `ACTIVE`, `CANCELLED`
- `InvoiceType`: `SALE`, `PURCHASE`, `SALE_RETURN`, `PURCHASE_RETURN`
- `EntityStatus`: `ACTIVE`, `INACTIVE`
- `MovementType`: `IN`, `OUT`
- `AccountGroupType`: `SUNDRY_DEBTORS`, `SUNDRY_CREDITORS`, `BANK`, `CASH`, `CAPITAL`, `EXPENSE`
- `VoucherType`: `SALE`, `PURCHASE`, `SALE_RETURN`, `PURCHASE_RETURN`, `PAYMENT`, `RECEIPT`, `JOURNAL`
- `OtpPurpose`: `LOGIN`, `RESET_PASSWORD`, `VERIFY_EMAIL`
- `SubscriptionStatus`: `ACTIVE`, `EXPIRED`, `CANCELLED`, `PENDING`
- `PaymentStatus`: `PENDING`, `PAID`, `FAILED`, `REFUNDED`

## Active Models

### Identity and tenancy

- `Tenant`
- `Company`
- `User`
- `UserCompany`
- `RefreshToken`
- `OtpChallenge`

### Master data

- `Party`
- `Account`
- `Product`
- `FinancialYear`
- `VoucherSequence`

### Transactions

- `Invoice`
- `InvoiceItem`
- `LedgerEntry`
- `StockMovement`

### SaaS billing

- `Plan`
- `Subscription`

## Core Relationship Shape

- `Tenant` is the top isolation boundary.
- `Company` belongs to one `Tenant`.
- `User` belongs to one `Tenant`.
- `UserCompany` holds per-company role assignments.
- `Account` is company-scoped and backed by `Party`.
- `Product` is company-scoped.
- `Invoice` belongs to `Company`, `Account`, and `FinancialYear`.
- `InvoiceItem` links `Invoice` to `Product`.
- `LedgerEntry` and `StockMovement` are the durable accounting and inventory ledgers.
- `Plan` and `Subscription` remain part of the active schema and are used by admin/subscription flows.

## Key Field Conventions

### User

- Identity is email-first.
- Passwords are stored as `passwordHash`.
- Activity state uses `status` plus `deletedAt`.
- Display name is stored in `name`.

### Company

- Settings-like fields now live directly on `Company`.
- There is no separate `CompanySettings` model.

### Account

- Grouping is enum-based through `Account.group`.
- Party details such as `name`, `gstin`, `phone`, `email`, `address` live on `Party`.

### Product

- Core fields are `name`, `sku`, `unit`, `price`, `taxRate`, `hsnCode`.
- Soft deletion uses `deletedAt`.

### Invoice

- Immutable versioning uses `version`, `originalId`, and `isLatest`.
- Totals are stored as `subTotal`, `taxAmount`, `discountAmount`, `totalAmount`.

### Ledger and stock

- `LedgerEntry` is one-sided per row using `debit` or `credit`.
- `StockMovement` uses `type` (`IN` or `OUT`) plus positive `quantity`.

## Removed Legacy Models

These models are not part of the current schema and must not be treated as active persistence:

- `UserCompanyAccess`
- `PasswordLifecycleToken`
- `CompanySettings`
- `ModulePermission`
- `AuditLog`
- `AccountGroup`
- `Broker`
- `ProductCategory`
- `Brand`
- `UnitOfMeasurement`
- `InvoicePayment`
- `InvoiceNumberConfig`
- `CashBookEntry`
- `BankBookEntry`
- `JournalEntry`
- `OpeningStock`
- `StockAdjustment`

Some routes still exist as compatibility surfaces, but they are implemented on top of current models or return explicit deprecation responses.

## Readiness Expectations

Readiness checks validate the presence of the current tables and required bootstrap data:

- `Tenant`, `Company`, `User`, `UserCompany`, `RefreshToken`, `OtpChallenge`
- `Party`, `Account`, `Product`
- `FinancialYear`, `VoucherSequence`
- `Invoice`, `InvoiceItem`, `LedgerEntry`, `StockMovement`

## Required Post-Change Validation

After any schema edit:

```bash
npx prisma validate --schema prisma/schema.prisma
npx prisma generate --schema prisma/schema.prisma
npx tsc --noEmit
```
