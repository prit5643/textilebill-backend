# TextileBill API Contract

Version: `2.2.0`  
Last updated: `2026-04-12`  
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
- subscription expiry reminder dispatch
- subscription invoice generation (INR, GST extra)

New billing-oriented admin routes:

- `POST /admin/subscriptions/reminders/send-due`
  - body: `{ "daysBefore": 7, "dryRun": false }`
  - sends reminder emails for active subscriptions expiring in exactly N days
  - deduplicated per subscription/day via Redis key

- `POST /admin/subscriptions/:id/invoice`
  - body: `{ "gstPercent": 5, "sendEmail": true }`
  - generates a subscription invoice payload in INR
  - GST is calculated as **extra** (base + GST)
  - optionally emails invoice summary to tenant's primary company email

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

- types: `SALE`, `PURCHASE`, `QUOTATION`, `CHALLAN`, `PROFORMA`, `SALE_RETURN`, `PURCHASE_RETURN`, `JOB_IN`, `JOB_OUT`
- statuses: `DRAFT`, `ACTIVE`, `CANCELLED` (API also accepts `PAID` and `PARTIALLY_PAID`, normalized to `ACTIVE`)
- invoice number is optional; if provided it must be numeric only (no prefixes)
- numbering is backed by `VoucherSequence`
- payments are compatibility behavior layered on top of `LedgerEntry`

## Invoice Number Config Compatibility

- `GET /invoice-number-configs`
- `POST /invoice-number-configs`
- `PUT /invoice-number-configs/:id`

These are compatibility routes over voucher-sequence-backed behavior.

## Expenses & Reimbursements

- `POST /expenses`
- `GET /expenses`
- `GET /expenses/:id`
- `PATCH /expenses/:id`
- `POST /expenses/:id/attachments`
- `GET /expenses/:id/attachments`
- `GET /reimbursements/claims`
- `POST /reimbursements/claims`
- `PATCH /reimbursements/claims/:id`
- `POST /reimbursements/claims/:id/settle`

## Work Orders

- `POST /work-orders`
- `GET /work-orders`
- `GET /work-orders/:id`
- `POST /work-orders/:id/split`
- `POST /work-orders/:id/link-invoice`
- `POST /work-orders/:id/loss-incidents`
- `POST /work-orders/loss-incidents/:incidentId/retry`
- `POST /work-orders/loss-incidents/:incidentId/reverse`
- `PATCH /work-orders/:id/close`
- `GET /work-orders/:id/profitability`

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

Work-order profitability report routes:

- `GET /reports/monthly-profit-summary`
- `GET /reports/vendor-margin-risk`

## Expenses

Main routes:

- `POST /expenses`
- `GET /expenses`
- `GET /expenses/:id`
- `PATCH /expenses/:id`
- `POST /expenses/:id/submit`

People and categories:

- `POST /expenses/people`
- `GET /expenses/people`
- `PATCH /expenses/people/:id`
- `POST /expenses/categories`
- `GET /expenses/categories`

Attachments (local-only storage):

- `POST /expenses/:id/attachments` (multipart, authenticated)
- `GET /expenses/:id/attachments`
- `DELETE /expenses/attachments/:attachmentId`
- `GET /uploads/expenses/:filename` (served from local `uploads/expenses`)

Notes:

- No presign endpoint is active for this module.
- Attachment files are local server files in v1.

## Reimbursements

- `GET /reimbursements/claims`
- `POST /reimbursements/claims`
- `POST /reimbursements/claims/:id/settle`
- `POST /reimbursements/claims/:id/attachments`
- `GET /reimbursements/claims/:id/attachments`
- `DELETE /reimbursements/attachments/:attachmentId`

## Payroll

- `POST /payroll/salary-profiles`
- `GET /payroll/salary-profiles`
- `POST /payroll/advances`
- `GET /payroll/advances`
- `POST /payroll/settlements/run`
- `GET /payroll/settlements`
- `POST /payroll/settlements/:id/mark-paid`

## Cost Centers and Profitability

- `POST /cost-centers`
- `GET /cost-centers`
- `GET /cost-centers/:id`
- `POST /cost-centers/:id/allocations`
- `GET /cost-centers/:id/allocations`
- `GET /reports/profitability/cost-centers`
- `GET /reports/profitability/cost-centers/:id`

## AI Insights

- `GET /ai/insights/expense-anomalies`
- `GET /ai/insights/cost-hotspots`
- `GET /ai/insights/salary-advance-risk`
- `GET /ai/insights/margin-leakage`

## Work Orders

- `POST /work-orders`
- `GET /work-orders`
- `GET /work-orders/:id`
- `POST /work-orders/:id/split`
- `POST /work-orders/:id/link-sale-invoice`
- `POST /work-orders/:id/link-purchase-invoice`
- `POST /work-orders/:id/loss-incidents`
- `POST /work-orders/loss-incidents/:incidentId/retry`
- `POST /work-orders/loss-incidents/:incidentId/reverse`
- `PATCH /work-orders/:id/close`
- `GET /work-orders/:id/profitability`

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

Last full-system verification snapshot from `2026-03-30`:

- `npx prisma validate --schema prisma/schema.prisma` -> pass
- `npx tsc --noEmit` -> pass
- `npm run build` -> pass
- `npm test -- --runInBand` -> pass (`57/57` suites, `252/252` tests)
- `npm run test:e2e -- --runInBand` -> pass (`11` suites passed, `1` skipped)
