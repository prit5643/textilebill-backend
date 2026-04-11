# Database Schema Reference

Primary source of truth: `prisma/schema.prisma`

Last updated: `2026-04-11`

## Active Enums

- `UserRole`: `OWNER`, `ADMIN`, `MANAGER`, `ACCOUNTANT`, `VIEWER`
- `InvoiceStatus`: `DRAFT`, `ACTIVE`, `CANCELLED`
- `InvoiceType`: `SALE`, `PURCHASE`, `QUOTATION`, `CHALLAN`, `PROFORMA`, `SALE_RETURN`, `PURCHASE_RETURN`, `JOB_IN`, `JOB_OUT`
- `EntityStatus`: `ACTIVE`, `INACTIVE`
- `MovementType`: `IN`, `OUT`
- `AccountGroupType`: `SUNDRY_DEBTORS`, `SUNDRY_CREDITORS`, `BANK`, `CASH`, `CAPITAL`, `EXPENSE`
- `VoucherType`: `SALE`, `PURCHASE`, `QUOTATION`, `CHALLAN`, `PROFORMA`, `SALE_RETURN`, `PURCHASE_RETURN`, `JOB_IN`, `JOB_OUT`, `PAYMENT`, `RECEIPT`, `JOURNAL`
- `OtpPurpose`: `LOGIN`, `RESET_PASSWORD`, `VERIFY_EMAIL`
- `SubscriptionStatus`: `ACTIVE`, `EXPIRED`, `CANCELLED`, `PENDING`
- `PaymentStatus`: `PENDING`, `PAID`, `FAILED`, `REFUNDED`
- `WorkOrderStatus`: `DRAFT`, `PLANNED`, `IN_PROGRESS`, `READY_TO_BILL`, `CLOSED`, `CANCELLED`
- `WorkOrderLotType`: `IN_HOUSE`, `OUTSOURCED`
- `WorkOrderLotStatus`: `PLANNED`, `IN_PROGRESS`, `RECEIVED`, `CLOSED`
- `WorkOrderInvoiceLinkType`: `SALE`, `PURCHASE`
- `WorkOrderLossReasonCode`: `QUALITY_DEFECT`, `SHORTAGE`, `REWORK`, `DAMAGE`, `OTHER`
- `WorkOrderLossChargeTo`: `OUR_COMPANY`, `VENDOR`, `CUSTOMER`
- `WorkOrderAutoAdjustMode`: `DIRECT_LOSS`, `PAYABLE_REDUCTION`, `RECEIVABLE_REDUCTION`
- `WorkOrderLossIncidentStatus`: `RECORDED`, `ADJUSTED`, `FAILED_ADJUSTMENT`, `REVERSED`
- `WorkOrderAdjustmentType`: `PURCHASE_RETURN`, `SALE_RETURN`, `LOSS_EXPENSE_NOTE`
- `WorkOrderAdjustmentStatus`: `PENDING`, `POSTED`, `FAILED`, `REVERSED`

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
- `WorkOrder`
- `WorkOrderLot`
- `WorkOrderInvoiceLink`
- `WorkOrderLossIncident`
- `WorkOrderAutoAdjustment`

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
- `WorkOrder` belongs to `Company` and customer `Account`.
- `WorkOrderLot` belongs to `WorkOrder` and optionally vendor `Account`.
- `WorkOrderInvoiceLink` binds invoices to work-order economics with one sale per work order and one purchase per outsourced lot enforced in service rules.
- `WorkOrderLossIncident` captures quality/shortage/rework loss events.
- `WorkOrderAutoAdjustment` tracks payable/receivable/loss accounting adjustments derived from incidents.
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

### Work-order profitability

- Work-order profitability is computed from linked invoice amounts and posted work-order adjustments.
- Direct in-house processing cost is intentionally out of scope for v1.

## Removed Legacy Models

These models are not part of the current schema and must not be treated as active persistence:

- `UserCompanyAccess`
- `PasswordLifecycleToken`
- `CompanySettings`
- `ModulePermission`
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
- `WorkOrder`, `WorkOrderLot`, `WorkOrderInvoiceLink`, `WorkOrderLossIncident`, `WorkOrderAutoAdjustment`

## Required Post-Change Validation

After any schema edit:

```bash
npx prisma validate --schema prisma/schema.prisma
npx prisma generate --schema prisma/schema.prisma
npx tsc --noEmit
```
