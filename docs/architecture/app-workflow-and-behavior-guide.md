# TextileBill App Workflow and Behavior Guide

Last updated: `2026-03-30`

## What The App Does

TextileBill is a multi-tenant textile ERP that manages:

- tenants, companies, users, and company-scoped access
- accounts and parties
- products
- financial years and voucher sequences
- invoices, ledger entries, and stock movements
- reports and subscription-aware access

## System Components

### Frontend

- Next.js app for auth, dashboard, admin, reports, and settings

### Backend

- NestJS API under `/api`
- validation, auth, rate limiting, business logic, reporting

### Database

- PostgreSQL through Prisma
- source of truth in `prisma/schema.prisma`

### Redis

- rate limiting
- idempotency support
- resilience/caching helpers where configured

## Startup Sequence

On backend boot:

1. load config
2. configure API prefix
3. configure security middleware and CORS
4. register validation, filters, interceptors, and guards
5. conditionally expose Swagger
6. connect Prisma and startup services
7. expose readiness and health routes

## Runtime Request Lifecycle

1. request reaches controller route
2. rate limiting and validation run
3. auth and authorization guards run
4. idempotency and logging interceptors run
5. service executes business logic
6. Prisma reads or writes current schema models
7. response is transformed and sanitized

## Auth Behavior

- login resolves identifier input and sets auth cookies
- refresh rotates cookies and session state
- logout clears cookies and revokes refresh state
- OTP uses `OtpChallenge`
- company access is resolved through `UserCompany`

## Business Flow

### Setup

- bootstrap or admin creates tenant/company/user defaults
- financial year and voucher sequences are prepared
- master data is created

### Invoice lifecycle

- invoice validates account, company, FY, and items
- invoice items are persisted
- ledger and stock effects are written through current durable models
- invoice summary and report endpoints reflect those writes

### Reporting

- reports aggregate from `Invoice`, `InvoiceItem`, `LedgerEntry`, and `StockMovement`

## Notes On Removed Legacy Persistence

The app no longer depends on direct persistence in removed tables such as:

- `AuditLog`
- `InvoicePayment`
- `InvoiceNumberConfig`
- `CompanySettings`

Compatibility endpoints may still exist where the frontend still expects them.
