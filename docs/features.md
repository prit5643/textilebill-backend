# Application Features And Roadmap

## Implemented Features

## Authentication & Access

- Login, refresh, logout, password change/reset
- JWT authentication
- Role-based authorization
- Subscription enforcement for tenant users
- Route-level abuse throttling for login/forgot-password/reset-password
- Standardized 429 response contract for auth rate limits

Code:

- `src/modules/auth/*`
- `src/common/guards/*`

## Multi-Tenant Admin

- Tenant creation and management
- Plan and subscription operations
- User activation/deactivation and session management

Code:

- `src/modules/admin/*`
- `src/modules/users/*`
- `src/modules/tenant/*`

## Company Management

- Company create/update/list
- Company settings
- Financial year management and active FY switching
- Lightweight header payload view for company switchers

Code:

- `src/modules/company/*`

## Product & Master Data

- Product CRUD
- Category CRUD
- Brand CRUD
- UOM CRUD
- Lightweight selector payload view for product pickers

Code:

- `src/modules/product/*`

## Accounts & Parties

- Account CRUD
- Broker CRUD
- Account group lookup APIs
- Lightweight selector payload view for account pickers

Code:

- `src/modules/account/*`

## Invoicing

- Invoice create/update/cancel/delete
- Auto/manual invoice numbering
- Tax calculation support
- Invoice conversion support
- Payment recording against invoices
- PDF generation

Code:

- `src/modules/invoice/*`

## Accounting

- Cash book and bank book entries
- Journal entries
- Opening stock and stock adjustments
- Ledger entries
- Transaction-safe voucher number allocation per company/FY/series
- Deterministic voucher format with FY rollover (`<SERIES>-<FY>-<NNNN>`)
- Ledger running-balance pagination carry-forward and deterministic ordering

Code:

- `src/modules/accounting/*`

## Reporting

- Dashboard summary reports
- Outstanding debtors/creditors
- Day book
- Stock report
- Product profit analysis

Code:

- `src/modules/report/*`

## Platform Reliability

- Request ID tracing
- Global exception sanitization
- Readiness/liveness endpoints
- Deployment-safe readiness gate
- Request-path observability with route-aware logging context
- `x-response-time-ms` response header and slow-request warning path
- Production-safe Swagger gating (`ENABLE_SWAGGER`)

Code:

- `src/common/filters/*`
- `src/common/middleware/*`
- `src/modules/system/*`

This file intentionally contains implemented features only.
For pending work, see `../future/README.md`.
