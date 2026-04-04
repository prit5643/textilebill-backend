# TextileBill API Contract

Version: `2.1.0`  
Last updated: `2026-03-30`  
Base URL: `/api`

This contract is aligned to the current Prisma schema in `prisma/schema.prisma`.

## Global Rules

- Auth is cookie-based.
- Scoped business routes require `X-Company-Id`.
- List endpoints use paginated `{ data, meta }` responses unless explicitly documented otherwise.
- Compatibility endpoints may remain available for frontend stability even where the old persistence model was removed.

Pagination shape:

```json
{
  "data": [],
  "meta": {
    "total": 0,
    "page": 1,
    "limit": 25,
    "totalPages": 0,
    "hasNext": false,
    "hasPrev": false
  }
}
```

## Auth

Main routes:

- `POST /auth/login`
- `GET /auth/me`
- `POST /auth/refresh`
- `POST /auth/logout`
- `POST /auth/change-password`
- `POST /auth/forgot-password`
- `POST /auth/reset-password`
- `POST /auth/password-reset/request`
- `GET /auth/password-reset/validate`
- `POST /auth/password-reset/complete`
- `POST /auth/otp/request`
- `POST /auth/otp/verify`
- `POST /auth/otp/resend`
- `GET /auth/verification-status`
- `POST /auth/verify-contact/request`
- `POST /auth/verify-contact/confirm`
- `GET /auth/invite/validate`
- `GET /auth/password-setup/validate`
- `POST /auth/accept-invite`
- `POST /auth/password-setup`
- `POST /auth/password-setup/resend`
- `GET /auth/sessions`
- `DELETE /auth/sessions/:tokenId`

Auth/session payloads are based on:

- `User`
- `UserCompany`
- `RefreshToken`

## Tenant

- `GET /tenant/profile`
- `PATCH /tenant/profile`

## Admin

Active routes include:

- dashboard
- tenant CRUD/toggle
- user admin and resend setup/reset link
- plan CRUD
- subscription create/update/list

Compatibility routes remain exposed for legacy UI paths:

- audit log endpoints
- module permission endpoints

These return compatibility or explicit deprecation behavior because the old persistence tables are no longer part of the active schema.

## Companies

- `GET /companies/usage/limits`
- `POST /companies`
- `GET /companies`
- `GET /companies/:id`
- `PATCH /companies/:id`
- `DELETE /companies/:id`
- `GET /companies/:id/settings`
- `PATCH /companies/:id/settings`
- `GET /companies/:id/financial-years`
- `POST /companies/:id/financial-years`
- `PATCH /companies/:id/financial-years/:fyId/activate`

Notes:

- settings endpoints are compatibility surfaces over the current company model
- `CompanySettings` is not an active Prisma model

## Accounts

- `POST /accounts`
- `GET /accounts`
- `GET /accounts/:id`
- `PATCH /accounts/:id`
- `DELETE /accounts/:id`
- `DELETE /accounts/:id/permanent`

Notes:

- persistence is `Account + Party`
- grouping is enum-based with `AccountGroupType`
- broker/account-group routes remain as compatibility helpers where needed

## Products

- `POST /products`
- `GET /products`
- `GET /products/:id`
- `PATCH /products/:id`
- `DELETE /products/:id`
- `DELETE /products/:id/permanent`

Current product fields:

- `name`
- `sku`
- `unit`
- `price`
- `taxRate`
- `hsnCode`
- `deletedAt`

## Invoices

- `POST /invoices`
- `GET /invoices`
- `GET /invoices/summary`
- `GET /invoices/:id`
- `GET /invoices/:id/pdf`
- `PUT /invoices/:id`
- `DELETE /invoices/:id`
- `POST /invoices/:id/payments`
- `GET /invoices/:id/payments`
- `DELETE /invoices/:id/payments/:paymentId`
- `POST /invoices/:id/convert`

Current invoice rules:

- types: `SALE`, `PURCHASE`, `SALE_RETURN`, `PURCHASE_RETURN`
- statuses: `DRAFT`, `ACTIVE`, `CANCELLED`
- numbering is backed by `VoucherSequence`
- payments are compatibility behavior layered on top of `LedgerEntry`

## Invoice Number Config Compatibility

- `GET /invoice-number-configs`
- `POST /invoice-number-configs`
- `PUT /invoice-number-configs/:id`

These are compatibility routes over voucher-sequence-backed behavior.

## Accounting

Current accounting/reporting surfaces remain available for:

- cash book
- bank book
- journal
- opening balances
- stock adjustments
- ledger
- ledger summary
- outstanding invoices

Implementation is based on current durable models:

- `LedgerEntry`
- `StockMovement`
- `VoucherSequence`

## Reports

Available routes include:

- dashboard
- monthly chart
- outstanding debtors
- outstanding creditors
- day book
- stock
- profit FIFO
- product details
- product details by customer
- `gstr1`
- `gstr3b`
- GST slab-wise
- trial balance
- profit/loss
- balance sheet

## Removed Legacy Persistence

The following are not active Prisma models and must not be documented as live persistence:

- `UserCompanyAccess`
- `PasswordLifecycleToken`
- `CompanySettings`
- `ModulePermission`
- `AuditLog`
- `InvoicePayment`
- `InvoiceNumberConfig`
- `Brand`
- `ProductCategory`
- `UnitOfMeasurement`
- `CashBookEntry`
- `BankBookEntry`
- `JournalEntry`
- `OpeningStock`
- `StockAdjustment`

## Verification Snapshot

Validated on `2026-03-30`:

- `npx prisma validate --schema prisma/schema.prisma` -> pass
- `npx tsc --noEmit` -> pass
- `npm run build` -> pass
- `npm test -- --runInBand` -> pass (`57/57` suites, `252/252` tests)
- `npm run test:e2e -- --runInBand` -> pass (`11` suites passed, `1` skipped)
